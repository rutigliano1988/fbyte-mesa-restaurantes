-- Mesa · Hito 4B · reserva online pública: horas que se ofrecen, día público sin datos personales, alta online,
-- botón «Reservar» y límite de intentos. Todas las públicas son SECURITY DEFINER y solo las ejecuta service_role
-- (la app, desde el servidor, después de Turnstile y del límite de intentos). Anon y authenticated, nada.

/** Ajustes de reserva del restaurante o, si aún no los ha guardado, los valores por defecto de la tabla. */
create or replace function public.booking_settings_of(p_restaurant_id uuid) returns public.booking_settings
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s from public.booking_settings s where s.restaurant_id = p_restaurant_id),
    row(p_restaurant_id, 90, '[]'::jsonb, 60, 60, 8, 2, true, now(), now(), true, true, null)::public.booking_settings)
$$;

/**
 * Servicios de una fecha (igual que servicesForDate de src/lib/reservations/day.ts): los de su día de la semana,
 * salvo cierre (ninguno) u horario especial (los suyos, con la última reserva una hora antes del cierre y cada 15 min).
 */
create or replace function public.day_services(p_restaurant_id uuid, p_date date)
returns table (name text, start_minute integer, end_minute integer, last_minute integer, interval_min integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.schedule_exceptions%rowtype;
begin
  select * into e from public.schedule_exceptions x
   where x.restaurant_id = p_restaurant_id and p_date between x.date_from and x.date_to
   order by x.date_from limit 1;
  if found then
    if e.kind = 'closed' then
      return;
    end if;
    return query
      select c.v ->> 'name', (c.v ->> 'start_minute')::integer, (c.v ->> 'end_minute')::integer,
             greatest((c.v ->> 'start_minute')::integer, (c.v ->> 'end_minute')::integer - 60), 15
        from jsonb_array_elements(e.custom_services) c(v);
    return;
  end if;
  return query
    select s.name, s.start_minute::integer, s.end_minute::integer,
           coalesce(s.last_booking_minute::integer, greatest(s.start_minute::integer, s.end_minute::integer - 60)),
           s.slot_interval_min::integer
      from public.services s
     where s.restaurant_id = p_restaurant_id and s.weekday = extract(isodow from p_date)::integer;
end $$;

/**
 * ¿Se ofrece online esa hora? Es una de las horas de un servicio de su día de servicio (o de la víspera, si el servicio
 * pasa de medianoche), alineada al intervalo y no después de la última reserva, que existe ese día (no cae en el hueco
 * del cambio de hora; si existe dos veces, vale la de la hora de invierno, como en la app) y está dentro de la
 * antelación mínima y máxima. p_now: para las pruebas.
 */
create or replace function public.is_bookable_slot(p_restaurant_id uuid, p_starts_at timestamptz, p_now timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  s public.booking_settings;
  v_wall timestamp;
  v_day date;
begin
  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  if v_tz is null or p_starts_at is null then
    return false;
  end if;
  s := public.booking_settings_of(p_restaurant_id);
  if p_starts_at < p_now + make_interval(mins => s.min_advance_min)
     or p_starts_at > p_now + make_interval(hours => s.max_advance_days * 24) then
    return false;
  end if;
  v_wall := p_starts_at at time zone v_tz;
  foreach v_day in array array[v_wall::date, v_wall::date - 1] loop
    if exists (
      select 1
        from public.day_services(p_restaurant_id, v_day) d,
             generate_series(d.start_minute, d.last_minute, d.interval_min) m
       where v_day::timestamp + make_interval(mins => m) = v_wall
         and (v_day::timestamp + make_interval(mins => m)) at time zone v_tz = p_starts_at
    ) then
      return true;
    end if;
  end loop;
  return false;
end $$;

/** Como pick_reservation_table, pero solo entre las mesas reservables online y, si se pide, de esa zona. */
create or replace function public.pick_online_table(
  p_restaurant_id uuid, p_party integer, p_starts timestamptz, p_ends timestamptz, p_zone_id uuid, p_ignore uuid
) returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
    from public.tables t
    join public.zones z on z.id = t.zone_id and z.restaurant_id = t.restaurant_id
   where t.restaurant_id = p_restaurant_id and t.active and t.online_bookable
     and (p_zone_id is null or t.zone_id = p_zone_id)
     and t.min_capacity <= p_party and t.max_capacity >= p_party
     and not exists (
       select 1 from public.reservation_tables rt
        where rt.table_id = t.id and rt.restaurant_id = p_restaurant_id and rt.active
          and rt.reservation_id is distinct from p_ignore and rt.starts_at < p_ends and rt.ends_at > p_starts)
     and not exists (
       select 1 from public.blocks b
        where b.restaurant_id = p_restaurant_id and (b.table_id = t.id or b.table_id is null)
          and b.starts_at < p_ends and b.ends_at > p_starts)
   order by t.max_capacity, z.position, t.position, t.name collate "C", t.id
   limit 1
$$;

/**
 * Cliente de una reserva online: se busca por email y, si no, por teléfono. No se sobrescriben nombre ni notas; solo
 * se rellenan el email o el teléfono que falten si no son de otro cliente; marketing_opt_in solo pasa a true.
 */
create or replace function public.upsert_online_customer(
  p_restaurant_id uuid, p_name text, p_phone text, p_email text, p_marketing boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  for attempt in 1..2 loop
    select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.email = p_email;
    if v_id is null then
      select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.phone = p_phone;
    end if;
    if v_id is not null then
      update public.customers c
         set phone = coalesce(c.phone, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.phone = p_phone) then p_phone end),
             email = coalesce(c.email, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.email = p_email) then p_email end),
             marketing_opt_in = c.marketing_opt_in or coalesce(p_marketing, false),
             marketing_opt_in_at = case when not c.marketing_opt_in and coalesce(p_marketing, false) then now()
                                        else c.marketing_opt_in_at end
       where c.id = v_id and c.restaurant_id = p_restaurant_id;
      return v_id;
    end if;
    insert into public.customers (restaurant_id, name, phone, email, marketing_opt_in, marketing_opt_in_at)
    values (p_restaurant_id, p_name, p_phone, p_email, coalesce(p_marketing, false),
            case when coalesce(p_marketing, false) then now() end)
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  raise exception 'INVALID_INPUT' using errcode = '22023';
end $$;

/**
 * Todo lo que necesita la página pública para calcular las horas libres de un día, sin ningún dato personal: zona
 * horaria, ajustes, servicios de la semana y excepciones de la ventana de antelación, zonas con mesas online, mesas
 * online activas, y lo que las ocupa (reservas activas y bloqueos) del día de servicio. p_token_hash: al modificar,
 * la propia reserva no cuenta. null si el restaurante no está activo o no tiene la reserva online activada.
 */
create or replace function public.get_public_booking_day(p_slug text, p_date date, p_token_hash text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants%rowtype;
  s public.booking_settings;
  v_from timestamptz;
  v_until timestamptz;
  v_today date;
  v_ignore uuid;
begin
  select * into r from public.restaurants x where x.slug = lower(btrim(coalesce(p_slug, ''))) and x.status = 'active';
  if not found or p_date is null then
    return null;
  end if;
  s := public.booking_settings_of(r.id);
  if not s.online_enabled then
    return null;
  end if;
  v_today := (now() at time zone r.timezone)::date;
  v_from := p_date::timestamp at time zone r.timezone;
  -- Hasta las 06:00 del día siguiente (lo último que se puede reservar) más 12 h de duración máxima.
  v_until := ((p_date + 1)::timestamp + interval '6 hours') at time zone r.timezone + interval '12 hours';
  if p_token_hash is not null then
    select x.id into v_ignore from public.reservations x where x.restaurant_id = r.id and x.manage_token_hash = p_token_hash;
  end if;
  return jsonb_build_object(
    'timezone', r.timezone,
    'settings', jsonb_build_object(
      'default_duration_min', s.default_duration_min, 'duration_rules', s.duration_rules,
      'min_advance_min', s.min_advance_min, 'max_advance_days', s.max_advance_days,
      'max_online_party', s.max_online_party, 'cancel_limit_hours', s.cancel_limit_hours, 'auto_confirm', s.auto_confirm),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'name', x.name, 'weekday', x.weekday, 'start_minute', x.start_minute, 'end_minute', x.end_minute,
               'last_booking_minute', x.last_booking_minute, 'slot_interval_min', x.slot_interval_min
             ) order by x.weekday, x.start_minute)
        from public.services x where x.restaurant_id = r.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date_from', e.date_from, 'date_to', e.date_to, 'kind', e.kind, 'custom_services', e.custom_services
             ) order by e.date_from)
        from public.schedule_exceptions e
       where e.restaurant_id = r.id and e.date_to >= least(v_today, p_date) - 1
         and e.date_from <= greatest(v_today + s.max_advance_days, p_date) + 1
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'position', z.position) order by z.position, z.name collate "C")
        from public.zones z
       where z.restaurant_id = r.id
         and exists (select 1 from public.tables t where t.zone_id = z.id and t.restaurant_id = r.id and t.active and t.online_bookable)
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'zone_id', t.zone_id, 'name', t.name, 'min_capacity', t.min_capacity,
               'max_capacity', t.max_capacity, 'position', t.position
             ) order by t.position, t.name collate "C")
        from public.tables t where t.restaurant_id = r.id and t.active and t.online_bookable
    ), '[]'::jsonb),
    'occupancy', coalesce((
      select jsonb_agg(jsonb_build_object('table_id', rt.table_id, 'starts_at', rt.starts_at, 'ends_at', rt.ends_at)
                       order by rt.starts_at, rt.table_id)
        from public.reservation_tables rt
        join public.tables t on t.id = rt.table_id and t.restaurant_id = rt.restaurant_id and t.active and t.online_bookable
       where rt.restaurant_id = r.id and rt.active and rt.reservation_id is distinct from v_ignore
         and rt.starts_at < v_until and rt.ends_at > v_from
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('table_id', b.table_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at)
                       order by b.starts_at, b.table_id)
        from public.blocks b where b.restaurant_id = r.id and b.starts_at < v_until and b.ends_at > v_from
    ), '[]'::jsonb)
  );
end $$;

/** Botón «Reservar»: restaurante activo, reserva online activada y al menos una mesa online activa. */
create or replace function public.public_booking_enabled(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.restaurants r
     where r.slug = lower(btrim(coalesce(p_slug, ''))) and r.status = 'active'
       and (public.booking_settings_of(r.id)).online_enabled
       and exists (select 1 from public.tables t where t.restaurant_id = r.id and t.active and t.online_bookable)
  )
$$;

/**
 * Alta online. Comprueba restaurante activo con reserva online, datos, hora ofrecida y personas (1–50). Hasta el
 * máximo online: la mesa online más pequeña que sirve (de la zona, si se pide), confirmada o pendiente según
 * auto_confirm; si no queda, SLOT_TAKEN. Por encima del máximo: solicitud pendiente sin mesa. El id y la huella del
 * enlace los pone la app (el token es un HMAC del id). Devuelve {"id", "status", "table_ids"}.
 */
create or replace function public.create_public_reservation(
  p_slug text, p_id uuid, p_token_hash text, p_party integer, p_starts_at timestamptz, p_zone_id uuid,
  p_name text, p_email text, p_phone text, p_notes text, p_locale text, p_marketing_opt_in boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants%rowtype;
  s public.booking_settings;
  v_name text := nullif(btrim(p_name), '');
  v_email text := lower(nullif(btrim(p_email), ''));
  v_phone text := nullif(btrim(p_phone), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_ends timestamptz;
  v_table uuid;
  v_status public.reservation_status;
  v_customer uuid;
begin
  perform set_config('mesa.actor', 'customer', true);
  select * into r from public.restaurants x where x.slug = lower(btrim(coalesce(p_slug, ''))) and x.status = 'active';
  if not found then
    raise exception 'BOOKING_CLOSED' using errcode = 'P0001';
  end if;
  s := public.booking_settings_of(r.id);
  if not s.online_enabled then
    raise exception 'BOOKING_CLOSED' using errcode = 'P0001';
  end if;
  if p_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_party is null or p_party not between 1 and 50 or p_starts_at is null
     or v_name is null or length(v_name) > 120
     or v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$'
     or length(v_notes) > 500 or coalesce(p_locale, '') not in ('es', 'en', 'ca', 'fr', 'de', 'it')
     or (p_zone_id is not null and not exists (select 1 from public.zones z where z.id = p_zone_id and z.restaurant_id = r.id)) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if not public.is_bookable_slot(r.id, p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_ends := p_starts_at + make_interval(mins => public.reservation_duration(r.id, p_party));
  perform public.lock_reservation_days(r.id, array[tstzrange(p_starts_at, v_ends)]);
  if p_party <= s.max_online_party then
    v_table := public.pick_online_table(r.id, p_party, p_starts_at, v_ends, p_zone_id, null);
    if v_table is null then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    end if;
    v_status := case when s.auto_confirm then 'confirmed' else 'pending' end;
  else
    v_status := 'pending';
  end if;
  v_customer := public.upsert_online_customer(r.id, v_name, v_phone, v_email, p_marketing_opt_in);
  begin
    insert into public.reservations (id, restaurant_id, customer_id, party_size, starts_at, ends_at, status, source, notes,
                                     locale, manage_token_hash, privacy_accepted_at, notify_customer)
    values (p_id, r.id, v_customer, p_party, p_starts_at, v_ends, v_status, 'online', v_notes,
            p_locale, p_token_hash, now(), true);
    if v_table is not null then
      insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values (p_id, v_table, r.id);
    end if;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'INVALID_INPUT' using errcode = '22023';
  end;
  return jsonb_build_object('id', p_id, 'status', v_status,
                            'table_ids', case when v_table is null then '[]'::jsonb else jsonb_build_array(v_table) end);
end $$;

/**
 * Límite de intentos por ventanas fijas: suma un intento a la clave en la ventana actual y dice si sigue dentro del
 * límite. La tarea horaria borra las ventanas de más de un día.
 */
create or replace function public.hit_rate_limit(p_key text, p_max_hits integer, p_window_seconds integer)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or length(p_key) not between 1 and 200 or coalesce(p_max_hits, 0) < 1 or coalesce(p_window_seconds, 0) < 1 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as l (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = l.hits + 1
  returning l.hits into v_hits;
  return v_hits <= p_max_hits;
end $$;

-- Privilegios: las auxiliares, para nadie; las públicas, solo service_role.
revoke execute on function public.booking_settings_of(uuid), public.day_services(uuid, date),
  public.is_bookable_slot(uuid, timestamptz, timestamptz),
  public.pick_online_table(uuid, integer, timestamptz, timestamptz, uuid, uuid),
  public.upsert_online_customer(uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_public_booking_day(text, date, text), public.public_booking_enabled(text),
  public.create_public_reservation(text, uuid, text, integer, timestamptz, uuid, text, text, text, text, text, boolean),
  public.hit_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_public_booking_day(text, date, text), public.public_booking_enabled(text),
  public.create_public_reservation(text, uuid, text, integer, timestamptz, uuid, text, text, text, text, text, boolean),
  public.hit_rate_limit(text, integer, integer)
  to service_role;
