-- Mesa · Hito 4A · funciones de reservas del panel: leer el día, crear (teléfono y walk-in), modificar y cambiar
-- de estado. Las que escriben son SECURITY DEFINER (las tablas no tienen INSERT ni UPDATE para nadie): comprueban
-- el rol con has_role, buscan todo por restaurant_id y toman un advisory lock por restaurante y fecha local.

/** Duración por defecto para un grupo: la del tramo que contiene party_size; si ninguno, la de por defecto (90). */
create or replace function public.reservation_duration(p_restaurant_id uuid, p_party integer) returns integer
language sql stable set search_path = '' as $$
  select coalesce(
    (select (e.v ->> 'duration_min')::integer
       from public.booking_settings s, jsonb_array_elements(s.duration_rules) e(v)
      where s.restaurant_id = p_restaurant_id
        and p_party between (e.v ->> 'min_party')::integer and (e.v ->> 'max_party')::integer
      limit 1),
    (select s.default_duration_min::integer from public.booking_settings s where s.restaurant_id = p_restaurant_id),
    90)
$$;

/** Cambios de estado permitidos (igual que src/lib/reservations/transitions.ts). */
create or replace function public.reservation_transition_ok(p_from public.reservation_status, p_to public.reservation_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'pending' then p_to in ('confirmed', 'rejected', 'cancelled_customer', 'cancelled_restaurant')
    when 'confirmed' then p_to in ('seated', 'no_show', 'cancelled_customer', 'cancelled_restaurant')
    when 'seated' then p_to = 'completed'
    else false
  end
$$;

/**
 * Bloqueo por restaurante y fecha local (zona del restaurante) de cada día que tocan los rangos, en orden de fecha
 * para que dos llamadas no se esperen la una a la otra. Se suelta al acabar la transacción.
 */
create or replace function public.lock_reservation_days(p_restaurant_id uuid, p_ranges tstzrange[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text;
  v_day date;
begin
  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  for v_day in
    select distinct d::date as day
      from unnest(p_ranges) x(r),
           generate_series((lower(x.r) at time zone v_tz)::date,
                           ((upper(x.r) - interval '1 microsecond') at time zone v_tz)::date,
                           interval '1 day') d
     order by day
  loop
    perform pg_advisory_xact_lock(hashtextextended('reservations/' || p_restaurant_id::text || '/' || v_day::text, 0));
  end loop;
end $$;

/** La mesa activa más pequeña que sirve (mín ≤ personas ≤ máx) libre y sin bloquear; desempate por posición. */
create or replace function public.pick_reservation_table(
  p_restaurant_id uuid, p_party integer, p_starts timestamptz, p_ends timestamptz, p_ignore uuid
) returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
    from public.tables t
    join public.zones z on z.id = t.zone_id and z.restaurant_id = t.restaurant_id
   where t.restaurant_id = p_restaurant_id and t.active
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
 * Mesas definitivas de una reserva. p_force: ninguna (forzar = sin mesa). Sin mesas elegidas: la propuesta
 * (NO_TABLE_AVAILABLE si no hay). Con mesas elegidas: del restaurante, activas (salvo las que ya tenía, p_keep),
 * con sitio para todos entre todas, sin bloqueos y libres.
 */
create or replace function public.resolve_reservation_tables(
  p_restaurant_id uuid, p_party integer, p_starts timestamptz, p_ends timestamptz,
  p_table_ids uuid[], p_force boolean, p_ignore uuid, p_keep uuid[]
) returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_count integer;
  v_capacity integer;
  v_inactive boolean;
begin
  if coalesce(p_force, false) then
    return '{}';
  end if;
  if p_table_ids is null or cardinality(p_table_ids) = 0 then
    v_id := public.pick_reservation_table(p_restaurant_id, p_party, p_starts, p_ends, p_ignore);
    if v_id is null then
      raise exception 'NO_TABLE_AVAILABLE' using errcode = 'P0001';
    end if;
    return array[v_id];
  end if;
  v_ids := array(select distinct x from unnest(p_table_ids) x where x is not null order by x);
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 10 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(t.max_capacity), 0),
         coalesce(bool_or(not t.active and not (t.id = any (coalesce(p_keep, '{}')))), false)
    into v_count, v_capacity, v_inactive
    from public.tables t
   where t.id = any (v_ids) and t.restaurant_id = p_restaurant_id;
  if v_count <> cardinality(v_ids) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_inactive then
    raise exception 'TABLE_INACTIVE' using errcode = 'P0001';
  end if;
  if v_capacity < p_party then
    raise exception 'TABLE_TOO_SMALL' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.blocks b
     where b.restaurant_id = p_restaurant_id and (b.table_id = any (v_ids) or b.table_id is null)
       and b.starts_at < p_ends and b.ends_at > p_starts
  ) then
    raise exception 'TABLE_BLOCKED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservation_tables rt
     where rt.table_id = any (v_ids) and rt.restaurant_id = p_restaurant_id and rt.active
       and rt.reservation_id is distinct from p_ignore and rt.starts_at < p_ends and rt.ends_at > p_starts
  ) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;
  return v_ids;
end $$;

/**
 * Busca el cliente por teléfono (E.164) y, si no, por email; si existe, actualiza el nombre y completa los datos
 * de contacto que le falten; si no, lo crea. Sin ningún dato (walk-in anónimo), null.
 */
create or replace function public.upsert_customer(p_restaurant_id uuid, p_name text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := lower(nullif(btrim(p_email), ''));
  v_id uuid;
begin
  for attempt in 1..2 loop
    v_id := null;
    if v_phone is not null then
      select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.phone = v_phone;
    end if;
    if v_id is null and v_email is not null then
      select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.email = v_email;
    end if;
    if v_id is not null then
      update public.customers c
         set name = coalesce(v_name, c.name),
             phone = coalesce(c.phone, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.phone = v_phone) then v_phone end),
             email = coalesce(c.email, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.email = v_email) then v_email end)
       where c.id = v_id and c.restaurant_id = p_restaurant_id and c.anonymized_at is null;
      return v_id;
    end if;
    if v_name is null then
      return null;
    end if;
    -- Si otra reserva crea el mismo cliente a la vez, no se inserta y se vuelve a buscar.
    insert into public.customers (restaurant_id, name, phone, email)
    values (p_restaurant_id, v_name, v_phone, v_email)
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  raise exception 'INVALID_INPUT' using errcode = '22023';
end $$;

/**
 * Reserva del panel (por teléfono): nace confirmada. Mesas: p_force → sin mesa; sin p_table_ids → la propuesta;
 * con p_table_ids → esas. p_duration_min null → la del tramo. Devuelve {"id": …, "table_ids": […]}.
 */
create or replace function public.create_panel_reservation(
  p_restaurant_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer,
  p_table_ids uuid[], p_force boolean,
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_notes text, p_internal_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_duration integer;
  v_ends timestamptz;
  v_tables uuid[];
  v_customer uuid;
  v_id uuid;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_starts_at is null or p_party_size is null or p_party_size not between 1 and 50
     or (p_duration_min is not null and (p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0))
     or nullif(btrim(p_customer_name), '') is null
     or (nullif(btrim(p_customer_phone), '') is null and nullif(btrim(p_customer_email), '') is null) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_duration := coalesce(p_duration_min, public.reservation_duration(p_restaurant_id, p_party_size));
  v_ends := p_starts_at + make_interval(mins => v_duration);
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(p_starts_at, v_ends)]);
  v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, p_starts_at, v_ends, p_table_ids, p_force, null, null);
  v_customer := public.upsert_customer(p_restaurant_id, p_customer_name, p_customer_phone, p_customer_email);
  begin
    insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source,
                                     notes, internal_notes, created_by)
    values (p_restaurant_id, v_customer, p_party_size, p_starts_at, v_ends, 'confirmed', 'phone',
            nullif(btrim(p_notes), ''), nullif(btrim(p_internal_notes), ''), auth.uid())
    returning id into v_id;
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select v_id, t, p_restaurant_id from unnest(v_tables) t;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id, 'table_ids', to_jsonb(v_tables));
end $$;

/** Walk-in: se sienta ya (hora actual), en una o varias mesas libres; el nombre es opcional. */
create or replace function public.create_walk_in(
  p_restaurant_id uuid, p_party_size integer, p_table_ids uuid[], p_duration_min integer, p_customer_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_starts timestamptz := date_trunc('minute', now());
  v_ends timestamptz;
  v_tables uuid[];
  v_customer uuid;
  v_id uuid;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_party_size is null or p_party_size not between 1 and 50 or p_table_ids is null or cardinality(p_table_ids) = 0
     or (p_duration_min is not null and (p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0)) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_ends := v_starts + make_interval(mins => coalesce(p_duration_min, public.reservation_duration(p_restaurant_id, p_party_size)));
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(v_starts, v_ends)]);
  v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, v_starts, v_ends, p_table_ids, false, null, null);
  v_customer := public.upsert_customer(p_restaurant_id, p_customer_name, null, null);
  begin
    insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source, created_by)
    values (p_restaurant_id, v_customer, p_party_size, v_starts, v_ends, 'seated', 'walk_in', auth.uid())
    returning id into v_id;
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select v_id, t, p_restaurant_id from unnest(v_tables) t;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id, 'table_ids', to_jsonb(v_tables), 'starts_at', v_starts);
end $$;

/**
 * Cambia hora, personas, duración, mesas y notas de una reserva activa. Si cambian la hora o las mesas, se vuelve a
 * comprobar el hueco (sin contar la propia reserva). Mesas: igual que al crear (p_table_ids = las que quieras dejar; array vacío con p_force = false en una reserva sin mesa: sigue sin mesa).
 */
create or replace function public.update_panel_reservation(
  p_restaurant_id uuid, p_reservation_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer,
  p_table_ids uuid[], p_force boolean, p_notes text, p_internal_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations%rowtype;
  v_ends timestamptz;
  v_current uuid[];
  v_tables uuid[];
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_starts_at is null or p_party_size is null or p_party_size not between 1 and 50 or p_duration_min is null
     or p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into r from public.reservations x where x.id = p_reservation_id and x.restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'confirmed', 'seated') then
    raise exception 'RESERVATION_CLOSED' using errcode = 'P0001';
  end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  v_current := array(select rt.table_id from public.reservation_tables rt
                      where rt.reservation_id = r.id and rt.restaurant_id = p_restaurant_id order by rt.table_id);
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(r.starts_at, r.ends_at), tstzrange(p_starts_at, v_ends)]);
  -- Mismas mesas y misma hora (p. ej., solo cambian las notas): no se vuelve a mirar si están libres o bloqueadas.
  if not coalesce(p_force, false) and cardinality(v_current) > 0 and p_table_ids is not null
     and array(select distinct x from unnest(p_table_ids) x order by x) = v_current
     and p_starts_at = r.starts_at and v_ends = r.ends_at then
    v_tables := v_current;
    if (select coalesce(sum(t.max_capacity), 0) from public.tables t
         where t.id = any (v_current) and t.restaurant_id = p_restaurant_id) < p_party_size then
      raise exception 'TABLE_TOO_SMALL' using errcode = 'P0001';
    end if;
  elsif not coalesce(p_force, false) and p_table_ids is not null and cardinality(p_table_ids) = 0 and cardinality(v_current) = 0 then
    -- Array vacío explícito en una reserva que ya no tiene mesa (p. ej., editar una forzada sin mesa): sigue sin mesa.
    -- Si tiene mesas, no se le quitan en silencio: se resuelve como siempre.
    v_tables := '{}';
  else
    v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, p_starts_at, v_ends, p_table_ids, p_force,
                                                  r.id, v_current);
  end if;
  begin
    -- Primero se sueltan las mesas que se van: si no, el trigger las movería a la hora nueva y chocarían con otras.
    delete from public.reservation_tables rt where rt.reservation_id = r.id and not (rt.table_id = any (v_tables));
    update public.reservations
       set starts_at = p_starts_at, ends_at = v_ends, party_size = p_party_size,
           notes = nullif(btrim(p_notes), ''), internal_notes = nullif(btrim(p_internal_notes), '')
     where id = r.id;
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select r.id, t, p_restaurant_id from unnest(v_tables) t
     where not (t = any (v_current));
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', r.id, 'table_ids', to_jsonb(v_tables));
end $$;

/** Cambia el estado si la transición está permitida; guarda el anterior para poder deshacerlo. */
create or replace function public.set_reservation_status(
  p_restaurant_id uuid, p_reservation_id uuid, p_status public.reservation_status
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.reservation_status;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select x.status into v_status from public.reservations x
   where x.id = p_reservation_id and x.restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status is null or not public.reservation_transition_ok(v_status, p_status) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update public.reservations
     set status = p_status, previous_status = v_status, status_changed_at = now()
   where id = p_reservation_id;
end $$;

/**
 * Deshace el último cambio a no_show, cancelled_*, rejected o completed: vuelve al estado anterior (pending,
 * confirmed o seated) si sus mesas siguen libres y sin bloquear. Devuelve el estado recuperado.
 */
create or replace function public.undo_reservation_status(p_restaurant_id uuid, p_reservation_id uuid)
returns public.reservation_status language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations%rowtype;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.reservations x where x.id = p_reservation_id and x.restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if r.status not in ('no_show', 'cancelled_customer', 'cancelled_restaurant', 'rejected', 'completed')
     or r.previous_status is null or r.previous_status not in ('pending', 'confirmed', 'seated') then
    raise exception 'NOTHING_TO_UNDO' using errcode = 'P0001';
  end if;
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(r.starts_at, r.ends_at)]);
  if exists (
    select 1 from public.reservation_tables mine
      join public.reservation_tables other
        on other.table_id = mine.table_id and other.restaurant_id = mine.restaurant_id and other.active
       and other.reservation_id <> r.id and other.starts_at < r.ends_at and other.ends_at > r.starts_at
     where mine.reservation_id = r.id and mine.restaurant_id = p_restaurant_id
  ) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservation_tables mine
      join public.blocks b on b.restaurant_id = mine.restaurant_id and (b.table_id = mine.table_id or b.table_id is null)
       and b.starts_at < r.ends_at and b.ends_at > r.starts_at
     where mine.reservation_id = r.id and mine.restaurant_id = p_restaurant_id
  ) then
    raise exception 'TABLE_BLOCKED' using errcode = 'P0001';
  end if;
  begin
    update public.reservations
       set status = r.previous_status, previous_status = null, status_changed_at = now()
     where id = r.id;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return r.previous_status;
end $$;

/**
 * Para el panel (RLS del usuario): las reservas que empiezan en [p_from, p_to) con su cliente y sus mesas, y lo que
 * ocupa mesas (reservas activas y bloqueos) en [p_from, p_to + 12 h), que es lo que necesita el cálculo de huecos.
 */
create or replace function public.get_booking_day(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_until timestamptz := p_to + interval '12 hours';
begin
  if not (public.is_member(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '3 days' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'party_size', r.party_size,
               'status', r.status, 'previous_status', r.previous_status, 'source', r.source,
               'notes', r.notes, 'internal_notes', r.internal_notes, 'created_at', r.created_at,
               'table_ids', coalesce((
                 select jsonb_agg(rt.table_id order by rt.table_id)
                   from public.reservation_tables rt where rt.reservation_id = r.id
               ), '[]'::jsonb),
               'customer', case when c.id is null then null else jsonb_build_object(
                 'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'tags', to_jsonb(c.tags),
                 'visits_count', c.visits_count, 'no_show_count', c.no_show_count, 'cancel_count', c.cancel_count
               ) end
             ) order by r.starts_at, r.created_at, r.id)
        from public.reservations r
        left join public.customers c on c.id = r.customer_id and c.restaurant_id = r.restaurant_id
       where r.restaurant_id = p_restaurant_id and r.starts_at >= p_from and r.starts_at < p_to
    ), '[]'::jsonb),
    'occupancy', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reservation_id', rt.reservation_id, 'table_id', rt.table_id, 'starts_at', rt.starts_at, 'ends_at', rt.ends_at
             ) order by rt.starts_at, rt.table_id)
        from public.reservation_tables rt
       where rt.restaurant_id = p_restaurant_id and rt.active and rt.starts_at < v_until and rt.ends_at > p_from
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'table_id', b.table_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason
             ) order by b.starts_at, b.id)
        from public.blocks b
       where b.restaurant_id = p_restaurant_id and b.starts_at < v_until and b.ends_at > p_from
    ), '[]'::jsonb)
  );
end $$;

-- Privilegios: las auxiliares, para nadie; las del panel, solo usuarios autenticados.
revoke execute on function public.reservation_duration(uuid, integer),
  public.reservation_transition_ok(public.reservation_status, public.reservation_status),
  public.lock_reservation_days(uuid, tstzrange[]),
  public.pick_reservation_table(uuid, integer, timestamptz, timestamptz, uuid),
  public.resolve_reservation_tables(uuid, integer, timestamptz, timestamptz, uuid[], boolean, uuid, uuid[]),
  public.upsert_customer(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function
  public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text),
  public.create_walk_in(uuid, integer, uuid[], integer, text),
  public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text),
  public.set_reservation_status(uuid, uuid, public.reservation_status),
  public.undo_reservation_status(uuid, uuid),
  public.get_booking_day(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function
  public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text),
  public.create_walk_in(uuid, integer, uuid[], integer, text),
  public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text),
  public.set_reservation_status(uuid, uuid, public.reservation_status),
  public.undo_reservation_status(uuid, uuid),
  public.get_booking_day(uuid, timestamptz, timestamptz)
  to authenticated;
