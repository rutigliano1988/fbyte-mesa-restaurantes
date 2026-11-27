-- Mesa · Hito 4A · reservas: zonas, mesas, ajustes, clientes, reservas, mesas de cada reserva y bloqueos.
-- Los instantes van en timestamptz (UTC); el día y la hora local se calculan con restaurants.timezone.

create type public.reservation_status as enum (
  'pending', 'confirmed', 'seated', 'completed', 'cancelled_customer', 'cancelled_restaurant', 'rejected', 'no_show'
);
create type public.reservation_source as enum ('online', 'phone', 'walk_in');

-- Servicios (Hito 2): última hora de reserva (si falta, end_minute − 60 sin bajar de start_minute) e intervalo.
alter table public.services
  add column last_booking_minute smallint,
  add column slot_interval_min smallint not null default 15
    constraint services_slot_interval_check check (slot_interval_min in (15, 30)),
  add constraint services_last_booking_check
    check (last_booking_minute >= start_minute and last_booking_minute < end_minute);
grant update (last_booking_minute, slot_interval_min) on public.services to authenticated;

-- Zonas ---------------------------------------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null constraint zones_name_check check (length(btrim(name)) between 1 and 40),
  position integer not null default 0 constraint zones_position_check check (position between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create unique index zones_name_key on public.zones (restaurant_id, lower(btrim(name)));
create trigger zones_updated_at before update on public.zones
  for each row execute function public.set_updated_at();

-- Mesas ---------------------------------------------------------------------------------------------------------
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  zone_id uuid not null,
  name text not null constraint tables_name_check check (length(btrim(name)) between 1 and 20),
  min_capacity smallint not null default 1 constraint tables_min_capacity_check check (min_capacity between 1 and 50),
  max_capacity smallint not null constraint tables_max_capacity_check check (max_capacity between 1 and 50),
  online_bookable boolean not null default true,
  active boolean not null default true,
  position integer not null default 0 constraint tables_position_check check (position between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  -- Sin ON DELETE: una zona con mesas no se borra (y al borrar el restaurante, la comprobación es al final).
  foreign key (zone_id, restaurant_id) references public.zones (id, restaurant_id),
  constraint tables_capacity_check check (min_capacity <= max_capacity)
);
create unique index tables_name_key on public.tables (restaurant_id, lower(btrim(name)));
create index tables_zone_idx on public.tables (zone_id);
create trigger tables_updated_at before update on public.tables
  for each row execute function public.set_updated_at();

-- Ajustes de reserva (una fila por restaurante; si no existe, valen los valores por defecto) ----------------------
/** Tramos de duración: [{"min_party": 1, "max_party": 2, "duration_min": 75}], como mucho 6 y sin solaparse. */
create or replace function public.valid_duration_rules(p_rules jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 6 then false
    when exists (
      select 1 from jsonb_array_elements(p_rules) e(v)
      where case
        when jsonb_typeof(e.v) = 'object'
          and coalesce(jsonb_typeof(e.v -> 'min_party'), '') = 'number'
          and coalesce(jsonb_typeof(e.v -> 'max_party'), '') = 'number'
          and coalesce(jsonb_typeof(e.v -> 'duration_min'), '') = 'number'
        then not (
          (e.v ->> 'min_party')::numeric % 1 = 0
          and (e.v ->> 'max_party')::numeric % 1 = 0
          and (e.v ->> 'duration_min')::numeric % 15 = 0
          and (e.v ->> 'min_party')::numeric between 1 and 50
          and (e.v ->> 'max_party')::numeric between (e.v ->> 'min_party')::numeric and 50
          and (e.v ->> 'duration_min')::numeric between 30 and 360
        )
        else true
      end
    ) then false
    else not exists (
      select 1
        from jsonb_array_elements(p_rules) with ordinality a(v, i)
        join jsonb_array_elements(p_rules) with ordinality b(v, j) on a.i < b.j
       where (a.v ->> 'min_party')::numeric <= (b.v ->> 'max_party')::numeric
         and (b.v ->> 'min_party')::numeric <= (a.v ->> 'max_party')::numeric
    )
  end
$$;

create table public.booking_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  default_duration_min smallint not null default 90
    constraint booking_settings_default_duration_check check (default_duration_min between 30 and 360 and default_duration_min % 15 = 0),
  duration_rules jsonb not null default '[]'::jsonb
    constraint booking_settings_duration_rules_check check (public.valid_duration_rules(duration_rules)),
  -- Reglas de la reserva online: se guardan ya y se aplican en el Hito 4B.
  min_advance_min integer not null default 60
    constraint booking_settings_min_advance_check check (min_advance_min between 0 and 10080),
  max_advance_days smallint not null default 60
    constraint booking_settings_max_advance_check check (max_advance_days between 1 and 365),
  max_online_party smallint not null default 8
    constraint booking_settings_max_online_party_check check (max_online_party between 1 and 50),
  cancel_limit_hours smallint not null default 2
    constraint booking_settings_cancel_limit_check check (cancel_limit_hours between 0 and 168),
  auto_confirm boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger booking_settings_updated_at before update on public.booking_settings
  for each row execute function public.set_updated_at();

-- Clientes (ficha mínima; la pantalla de clientes llega en el Hito 5) --------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null constraint customers_name_check check (length(btrim(name)) between 1 and 120),
  -- E.164 (+34612345678), normalizado en la app con libphonenumber-js.
  phone text constraint customers_phone_check check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text constraint customers_email_check
    check (email = lower(email) and length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes text constraint customers_notes_check check (length(notes) <= 500),
  tags text[] not null default '{}' constraint customers_tags_check check (tags <@ array['vip', 'regular', 'problem']),
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  visits_count integer not null default 0 constraint customers_visits_count_check check (visits_count >= 0),
  no_show_count integer not null default 0 constraint customers_no_show_count_check check (no_show_count >= 0),
  cancel_count integer not null default 0 constraint customers_cancel_count_check check (cancel_count >= 0),
  last_visit_at timestamptz,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create unique index customers_phone_key on public.customers (restaurant_id, phone) where phone is not null;
create unique index customers_email_key on public.customers (restaurant_id, email) where email is not null;
create index customers_restaurant_idx on public.customers (restaurant_id);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Reservas ------------------------------------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id uuid,
  party_size smallint not null constraint reservations_party_size_check check (party_size between 1 and 50),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.reservation_status not null default 'confirmed',
  -- Para «Deshacer» el último cambio de estado (una sola vez).
  previous_status public.reservation_status,
  status_changed_at timestamptz,
  source public.reservation_source not null,
  notes text constraint reservations_notes_check check (length(notes) <= 500),
  internal_notes text constraint reservations_internal_notes_check check (length(internal_notes) <= 500),
  locale text not null default 'es'
    constraint reservations_locale_check check (locale in ('es', 'en', 'ca', 'fr', 'de', 'it')),
  created_by uuid references auth.users (id) on delete set null,
  -- Hito 4B (reserva online): se crean ya y quedan vacías.
  manage_token_hash text unique,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  -- Sin ON DELETE: un cliente con reservas no se borra (en el Hito 5 se anonimiza).
  foreign key (customer_id, restaurant_id) references public.customers (id, restaurant_id),
  constraint reservations_time_check check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  constraint reservations_customer_check check (customer_id is not null or source = 'walk_in')
);
create index reservations_day_idx on public.reservations (restaurant_id, starts_at);
create index reservations_customer_idx on public.reservations (customer_id);
create index reservations_created_by_idx on public.reservations (created_by);
create trigger reservations_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();

-- Mesas de cada reserva: horas y «activa» copiadas de la reserva por trigger --------------------------------------
create table public.reservation_tables (
  reservation_id uuid not null,
  table_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null,
  created_at timestamptz not null default now(),
  primary key (reservation_id, table_id),
  foreign key (reservation_id, restaurant_id) references public.reservations (id, restaurant_id) on delete cascade,
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade,
  -- Segunda red de seguridad: una mesa nunca tiene dos reservas activas que se solapen.
  constraint reservation_tables_no_overlap
    exclude using gist (table_id with =, tstzrange(starts_at, ends_at) with &&) where (active)
);
create index reservation_tables_table_idx on public.reservation_tables (table_id, starts_at);
create index reservation_tables_restaurant_idx on public.reservation_tables (restaurant_id, starts_at);

-- Bloqueos: una mesa o todo el restaurante (table_id nulo) ------------------------------------------------------
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text constraint blocks_reason_check check (length(btrim(reason)) between 1 and 140),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade,
  constraint blocks_time_check check (ends_at > starts_at and ends_at <= starts_at + interval '31 days')
);
create index blocks_restaurant_idx on public.blocks (restaurant_id, starts_at);
create index blocks_table_idx on public.blocks (table_id);
create index blocks_created_by_idx on public.blocks (created_by);
create trigger blocks_updated_at before update on public.blocks
  for each row execute function public.set_updated_at();

-- Triggers ------------------------------------------------------------------------------------------------------
-- Los SECURITY DEFINER buscan las filas relacionadas también por restaurant_id = new.restaurant_id.

/**
 * Como mucho 20 zonas y 100 mesas por restaurante (con bloqueo, para que dos altas a la vez no se cuelen).
 * Un usuario sin permiso recibe FORBIDDEN antes de contar nada de otro restaurante.
 * Sin sesión (superusuario o clave de servicio) no hay rol que mirar.
 */
create or replace function public.limit_booking_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_role(new.restaurant_id, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform 1 from public.restaurants r where r.id = new.restaurant_id for no key update;
  if tg_table_name = 'zones' then
    if (select count(*) from public.zones z where z.restaurant_id = new.restaurant_id) >= 20 then
      raise exception 'ZONE_LIMIT' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.tables t where t.restaurant_id = new.restaurant_id) >= 100 then
    raise exception 'TABLE_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger zones_limit before insert on public.zones
  for each row execute function public.limit_booking_rows();
create trigger tables_limit before insert on public.tables
  for each row execute function public.limit_booking_rows();

/** Una mesa con reservas activas que aún no han terminado no se borra: se desactiva. */
create or replace function public.check_table_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Borrado en cascada del restaurante: no hay nada que proteger.
  if not exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
    return old;
  end if;
  if exists (
    select 1 from public.reservation_tables rt
     where rt.table_id = old.id and rt.restaurant_id = old.restaurant_id and rt.active and rt.ends_at > now()
  ) then
    raise exception 'TABLE_HAS_RESERVATIONS' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger tables_check_delete before delete on public.tables
  for each row execute function public.check_table_delete();

/** Al asignar una mesa, copia las horas y si está activa (pending, confirmed o seated) desde su reserva. */
create or replace function public.fill_reservation_table() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select r.starts_at, r.ends_at, r.status in ('pending', 'confirmed', 'seated')
    into new.starts_at, new.ends_at, new.active
    from public.reservations r
   where r.id = new.reservation_id and r.restaurant_id = new.restaurant_id;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reservation_tables_fill before insert on public.reservation_tables
  for each row execute function public.fill_reservation_table();

/** Si cambian las horas o el estado de la reserva, sus mesas lo copian (y la exclusión vuelve a comprobarse). */
create or replace function public.sync_reservation_tables() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reservation_tables rt
     set starts_at = new.starts_at, ends_at = new.ends_at, active = new.status in ('pending', 'confirmed', 'seated')
   where rt.reservation_id = new.id and rt.restaurant_id = new.restaurant_id;
  return null;
end $$;
create trigger reservations_sync_tables after update of starts_at, ends_at, status on public.reservations
  for each row execute function public.sync_reservation_tables();

/**
 * Contadores del cliente: no_show suma en no_show_count, cancelled_customer en cancel_count y completed en
 * visits_count (y last_visit_at); al deshacer, restan.
 */
create or replace function public.update_customer_counters() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null or new.status = old.status then
    return null;
  end if;
  update public.customers c
     set no_show_count = greatest(c.no_show_count
           + (case when new.status = 'no_show' then 1 else 0 end) - (case when old.status = 'no_show' then 1 else 0 end), 0),
         cancel_count = greatest(c.cancel_count
           + (case when new.status = 'cancelled_customer' then 1 else 0 end)
           - (case when old.status = 'cancelled_customer' then 1 else 0 end), 0),
         visits_count = greatest(c.visits_count
           + (case when new.status = 'completed' then 1 else 0 end) - (case when old.status = 'completed' then 1 else 0 end), 0),
         last_visit_at = case when 'completed' in (new.status, old.status) then (
             select max(x.starts_at) from public.reservations x
              where x.customer_id = c.id and x.restaurant_id = c.restaurant_id and x.status = 'completed'
           ) else c.last_visit_at end
   where c.id = new.customer_id and c.restaurant_id = new.restaurant_id;
  return null;
end $$;
create trigger reservations_customer_counters after update of status on public.reservations
  for each row execute function public.update_customer_counters();

-- Privilegios y RLS ---------------------------------------------------------------------------------------------
-- Leen los miembros (y FByte en soporte). Zonas, mesas, ajustes y bloqueos: Administrador y Encargado.
-- Clientes, reservas y sus mesas solo se escriben con las funciones de la siguiente migración. Anon, nada.
alter table public.zones enable row level security;
alter table public.tables enable row level security;
alter table public.booking_settings enable row level security;
alter table public.customers enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_tables enable row level security;
alter table public.blocks enable row level security;

revoke all on public.zones, public.tables, public.booking_settings, public.customers, public.reservations,
  public.reservation_tables, public.blocks from anon, authenticated;

grant select on public.zones, public.tables, public.booking_settings, public.customers, public.reservations,
  public.reservation_tables, public.blocks to authenticated;
grant insert, delete on public.zones, public.tables to authenticated;
grant update (name, position) on public.zones to authenticated;
grant update (zone_id, name, min_capacity, max_capacity, online_bookable, active, position) on public.tables to authenticated;
grant insert on public.booking_settings to authenticated;
grant update (default_duration_min, duration_rules, min_advance_min, max_advance_days, max_online_party,
  cancel_limit_hours, auto_confirm) on public.booking_settings to authenticated;
grant insert (restaurant_id, table_id, starts_at, ends_at, reason) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['zones', 'tables', 'booking_settings', 'customers', 'reservations', 'reservation_tables', 'blocks'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_member(restaurant_id) or public.is_platform_admin())',
      t || '_select', t);
  end loop;
  foreach t in array array['zones', 'tables', 'booking_settings', 'blocks'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_insert', t);
  end loop;
  foreach t in array array['zones', 'tables', 'booking_settings'] loop
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, ''{admin,manager}'')) '
      'with check (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_update', t);
  end loop;
  foreach t in array array['zones', 'tables', 'blocks'] loop
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_delete', t);
  end loop;
end $$;

-- Funciones: triggers para nadie; valid_duration_rules la ejecuta quien inserta (la usa un CHECK).
revoke execute on function public.limit_booking_rows(), public.check_table_delete(), public.fill_reservation_table(),
  public.sync_reservation_tables(), public.update_customer_counters()
  from public, anon, authenticated;
revoke execute on function public.valid_duration_rules(jsonb) from public, anon;
grant execute on function public.valid_duration_rules(jsonb) to authenticated;

-- Tiempo real (Supabase Realtime): solo si existe la publicación (el shim de pruebas no la tiene) y no es FOR ALL TABLES
-- (en ese caso ya las incluye y añadirlas daría error).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    alter publication supabase_realtime add table public.reservations, public.reservation_tables, public.blocks;
  end if;
end $$;
