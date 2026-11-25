-- Mesa · Hito 2 · horario: servicios por día de la semana y cierres o días especiales.
-- Horas en minutos desde medianoche; end_minute puede pasar de 1440 (hasta las 06:00 del día siguiente).
-- Días ISO: 1 = lunes … 7 = domingo.
create extension if not exists btree_gist with schema extensions;

create type public.schedule_exception_kind as enum ('closed', 'custom');

create table public.services (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null constraint services_name_check check (length(trim(name)) between 1 and 40),
  weekday smallint not null constraint services_weekday_check check (weekday between 1 and 7),
  start_minute smallint not null constraint services_start_minute_check check (start_minute between 0 and 1439),
  end_minute smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_range_check check (end_minute > start_minute and end_minute <= 1800),
  constraint services_no_overlap exclude using gist (
    restaurant_id with =, weekday with =, int4range(start_minute, end_minute) with &&
  )
);
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

/** Servicios de un día especial: [{"name": "Cena", "start_minute": 1200, "end_minute": 1470}], como mucho 6. */
create or replace function public.valid_custom_services(p_services jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_services) is distinct from 'array' or jsonb_array_length(p_services) > 6 then false
  else not exists (
    select 1 from jsonb_array_elements(p_services) e(v)
    where case
      when jsonb_typeof(e.v) = 'object'
        and coalesce(jsonb_typeof(e.v -> 'name'), '') = 'string'
        and coalesce(jsonb_typeof(e.v -> 'start_minute'), '') = 'number'
        and coalesce(jsonb_typeof(e.v -> 'end_minute'), '') = 'number'
      then not (
        length(trim(e.v ->> 'name')) between 1 and 40
        and (e.v ->> 'start_minute')::numeric % 1 = 0
        and (e.v ->> 'end_minute')::numeric % 1 = 0
        and (e.v ->> 'start_minute')::numeric between 0 and 1439
        and (e.v ->> 'end_minute')::numeric > (e.v ->> 'start_minute')::numeric
        and (e.v ->> 'end_minute')::numeric <= 1800
      )
      else true
    end
  ) end
$$;

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  kind public.schedule_exception_kind not null default 'closed',
  custom_services jsonb not null default '[]'::jsonb,
  note text constraint schedule_exceptions_note_check check (length(trim(note)) between 1 and 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_exceptions_dates_check check (date_to >= date_from and date_to - date_from <= 366),
  constraint schedule_exceptions_services_check check (
    case when public.valid_custom_services(custom_services)
      then (kind = 'closed' and jsonb_array_length(custom_services) = 0)
        or (kind = 'custom' and jsonb_array_length(custom_services) >= 1)
      else false
    end
  ),
  constraint schedule_exceptions_no_overlap exclude using gist (
    restaurant_id with =, daterange(date_from, date_to, '[]') with &&
  )
);
create trigger schedule_exceptions_updated_at before update on public.schedule_exceptions
  for each row execute function public.set_updated_at();

-- Privilegios y RLS: leen los miembros (y FByte en soporte); editan Administrador y Encargado.
alter table public.services enable row level security;
alter table public.schedule_exceptions enable row level security;
revoke all on public.services, public.schedule_exceptions from anon, authenticated;

grant select, insert, delete on public.services to authenticated;
grant update (name, weekday, start_minute, end_minute) on public.services to authenticated;
create policy services_select on public.services for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy services_insert on public.services for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy services_update on public.services for update to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}')) with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy services_delete on public.services for delete to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}'));

grant select, insert, delete on public.schedule_exceptions to authenticated;
grant update (date_from, date_to, kind, custom_services, note) on public.schedule_exceptions to authenticated;
create policy exceptions_select on public.schedule_exceptions for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy exceptions_insert on public.schedule_exceptions for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy exceptions_update on public.schedule_exceptions for update to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}')) with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy exceptions_delete on public.schedule_exceptions for delete to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}'));

-- La usa una restricción CHECK: la ejecuta quien inserta.
revoke execute on function public.valid_custom_services(jsonb) from public, anon;
grant execute on function public.valid_custom_services(jsonb) to authenticated;
