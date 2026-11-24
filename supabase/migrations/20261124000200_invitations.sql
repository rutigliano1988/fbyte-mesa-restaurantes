-- Mesa · Hito 1 · funciones de negocio: alta de restaurantes, invitaciones, estado y equipo.

/** Interna: crea (o reemplaza) la invitación pendiente y devuelve el token en claro. */
create or replace function public._new_invitation(p_restaurant_id uuid, p_email text, p_role public.member_role)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  delete from public.invitations
   where restaurant_id = p_restaurant_id and email = v_email and accepted_at is null;
  insert into public.invitations (restaurant_id, email, role, token_hash, invited_by)
  values (p_restaurant_id, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid());
  return v_token;
end $$;

create or replace function public.create_restaurant(p_name text, p_slug text, p_admin_email text)
returns table (restaurant_id uuid, invitation_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_token text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.restaurants (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into v_id;
  v_token := public._new_invitation(v_id, p_admin_email, 'admin');
  insert into public.admin_audit_log (actor_id, action, restaurant_id, details)
  values (auth.uid(), 'restaurant.create', v_id, jsonb_build_object('admin_email', lower(trim(p_admin_email))));
  return query select v_id, v_token;
end $$;

create or replace function public.create_invitation(p_restaurant_id uuid, p_email text, p_role public.member_role)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
begin
  if auth.uid() is null or not (public.has_role(p_restaurant_id, '{admin}') or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.restaurant_members m join auth.users u on u.id = m.user_id
    where m.restaurant_id = p_restaurant_id and lower(u.email) = v_email
  ) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;
  return public._new_invitation(p_restaurant_id, v_email, p_role);
end $$;

create or replace function public.get_invitation(p_token text)
returns table (restaurant_id uuid, restaurant_name text, email text, role public.member_role, has_account boolean)
language sql stable security definer set search_path = '' as $$
  select i.restaurant_id, r.name, i.email, i.role,
         exists (select 1 from auth.users u where lower(u.email) = i.email)
  from public.invitations i
  join public.restaurants r on r.id = i.restaurant_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.accepted_at is null
    and i.expires_at > now()
    and r.status <> 'disabled'
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select i.* into v_inv
  from public.invitations i
  join public.restaurants r on r.id = i.restaurant_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.accepted_at is null
    and i.expires_at > now()
    and r.status <> 'disabled'
  for update of i;
  if not found then
    raise exception 'INVALID_INVITATION' using errcode = 'P0001';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from v_inv.email then
    raise exception 'EMAIL_MISMATCH' using errcode = 'P0001';
  end if;
  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (v_inv.restaurant_id, auth.uid(), v_inv.role)
  on conflict (restaurant_id, user_id) do update set role = excluded.role;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.restaurant_id;
end $$;

create or replace function public.set_restaurant_status(p_restaurant_id uuid, p_status public.restaurant_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.restaurants set status = p_status where id = p_restaurant_id;
  insert into public.admin_audit_log (actor_id, action, restaurant_id, details)
  values (auth.uid(), 'restaurant.status', p_restaurant_id, jsonb_build_object('status', p_status));
end $$;

create or replace function public.log_admin_view(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.admin_audit_log (actor_id, action, restaurant_id) values (auth.uid(), 'support.view', p_restaurant_id);
end $$;

create or replace function public.restaurant_team(p_restaurant_id uuid)
returns table (user_id uuid, full_name text, email text, role public.member_role, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_member(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.full_name, u.email::text, m.role, m.created_at
    from public.restaurant_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.restaurant_id = p_restaurant_id
    order by m.created_at;
end $$;

-- Privilegios de ejecución
revoke execute on function public._new_invitation(uuid, text, public.member_role) from public, anon, authenticated;
revoke execute on function
  public.create_restaurant(text, text, text),
  public.create_invitation(uuid, text, public.member_role),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.set_restaurant_status(uuid, public.restaurant_status),
  public.log_admin_view(uuid),
  public.restaurant_team(uuid)
  from public, anon;
grant execute on function
  public.create_restaurant(text, text, text),
  public.create_invitation(uuid, text, public.member_role),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.set_restaurant_status(uuid, public.restaurant_status),
  public.log_admin_view(uuid),
  public.restaurant_team(uuid)
  to authenticated;
grant execute on function public.get_invitation(text) to anon;
