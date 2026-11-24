-- Mesa · Hito 1 · esquema base: perfiles, restaurantes, miembros, invitaciones, auditoría.
create extension if not exists pgcrypto with schema extensions;

create type public.member_role as enum ('admin', 'manager', 'staff');
create type public.restaurant_status as enum ('setup', 'active', 'disabled');

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Perfiles ----------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Slugs reservados (debe coincidir con src/lib/slug.ts) --------------------
create table public.reserved_slugs (slug text primary key);
insert into public.reserved_slugs (slug) values
  ('admin'), ('panel'), ('login'), ('logout'), ('api'), ('auth'), ('invitacion'), ('recuperar'),
  ('nueva-contrasena'), ('legal'), ('privacidad'), ('cookies'), ('aviso-legal'), ('ayuda'),
  ('soporte'), ('static'), ('public'), ('assets'), ('brand'), ('www'), ('mesa'), ('fbyte');

-- Restaurantes --------------------------------------------------------------
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint restaurants_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  name text not null check (length(trim(name)) between 2 and 120),
  status public.restaurant_status not null default 'setup',
  timezone text not null default 'Europe/Madrid' check (timezone in ('Europe/Madrid', 'Atlantic/Canary')),
  default_locale text not null default 'es',
  enabled_locales text[] not null default '{es}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger restaurants_updated_at before update on public.restaurants
  for each row execute function public.set_updated_at();

create or replace function public.check_slug_not_reserved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug) then
    raise exception 'SLUG_RESERVED' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger restaurants_slug_not_reserved before insert or update of slug on public.restaurants
  for each row execute function public.check_slug_not_reserved();

-- Miembros ------------------------------------------------------------------
create table public.restaurant_members (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index restaurant_members_user_idx on public.restaurant_members (user_id);

-- Invitaciones ---------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.member_role not null,
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_restaurant_idx on public.invitations (restaurant_id);

-- Auditoría de FByte -------------------------------------------------------------
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Funciones auxiliares de permisos ---------------------------------------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.user_id = auth.uid()), false)
$$;

/** Rol del usuario actual en un restaurante NO desactivado (null si no es miembro). */
create or replace function public.my_role(p_restaurant_id uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.restaurant_members m
  join public.restaurants r on r.id = m.restaurant_id
  where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid() and r.status <> 'disabled'
$$;

create or replace function public.is_member(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role(p_restaurant_id) is not null
$$;

create or replace function public.has_role(p_restaurant_id uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role(p_restaurant_id) = any (p_roles), false)
$$;

/** Pertenencia sin importar el estado (para poder mostrar "restaurante desactivado"). */
create or replace function public.belongs_to(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid()
  )
$$;

create or replace function public.my_restaurants()
returns table (id uuid, name text, slug text, status public.restaurant_status, role public.member_role)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.slug, r.status, m.role
  from public.restaurant_members m
  join public.restaurants r on r.id = m.restaurant_id
  where m.user_id = auth.uid()
  order by r.name
$$;

/** Impide dejar un restaurante sin ningún administrador. */
create or replace function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.restaurants r where r.id = old.restaurant_id)
    or not exists (select 1 from auth.users u where u.id = old.user_id)
  ) then
    -- Borrado en cascada (restaurante o cuenta eliminados): la regla solo protege acciones del equipo.
    return old;
  end if;
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    -- Bloqueo por restaurante: dos bajas concurrentes no pueden pasar a la vez.
    perform 1 from public.restaurants r where r.id = old.restaurant_id for update;
    if not exists (
      select 1 from public.restaurant_members m
      where m.restaurant_id = old.restaurant_id and m.role = 'admin' and m.user_id <> old.user_id
    ) then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger restaurant_members_protect_last_admin
  before update of role or delete on public.restaurant_members
  for each row execute function public.protect_last_admin();

-- Privilegios y RLS ----------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.reserved_slugs enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.invitations enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.profiles, public.reserved_slugs, public.restaurants, public.restaurant_members,
  public.invitations, public.admin_audit_log from anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from anon, authenticated;

-- profiles
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1 from public.restaurant_members other
    where other.user_id = profiles.user_id and public.is_member(other.restaurant_id)
  )
);
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reserved_slugs (lectura pública)
grant select on public.reserved_slugs to anon, authenticated;
create policy reserved_slugs_select on public.reserved_slugs for select to anon, authenticated using (true);

-- restaurants
grant select on public.restaurants to authenticated;
grant update (name, timezone, default_locale, enabled_locales) on public.restaurants to authenticated;
create policy restaurants_select on public.restaurants for select to authenticated
  using (public.is_platform_admin() or public.belongs_to(id));
create policy restaurants_update on public.restaurants for update to authenticated
  using (public.has_role(id, '{admin}')) with check (public.has_role(id, '{admin}'));

-- restaurant_members
grant select, delete on public.restaurant_members to authenticated;
grant update (role) on public.restaurant_members to authenticated;
create policy members_select on public.restaurant_members for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy members_update on public.restaurant_members for update to authenticated
  using (public.has_role(restaurant_id, '{admin}')) with check (public.has_role(restaurant_id, '{admin}'));
create policy members_delete on public.restaurant_members for delete to authenticated
  using (public.has_role(restaurant_id, '{admin}'));

-- invitations (sin token_hash)
grant select (id, restaurant_id, email, role, expires_at, accepted_at, created_at) on public.invitations to authenticated;
grant delete on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_role(restaurant_id, '{admin}') or public.is_platform_admin());
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.has_role(restaurant_id, '{admin}') or public.is_platform_admin());

-- admin_audit_log
grant select on public.admin_audit_log to authenticated;
create policy audit_select on public.admin_audit_log for select to authenticated using (public.is_platform_admin());

-- Funciones: solo usuarios autenticados
revoke execute on function public.is_platform_admin(), public.my_role(uuid), public.is_member(uuid),
  public.has_role(uuid, public.member_role[]), public.belongs_to(uuid), public.my_restaurants()
  from public, anon;
grant execute on function public.is_platform_admin(), public.my_role(uuid), public.is_member(uuid),
  public.has_role(uuid, public.member_role[]), public.belongs_to(uuid), public.my_restaurants()
  to authenticated;
