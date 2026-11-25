-- Mesa · Hito 2 · publicar la mini-web y datos públicos para anon.

/** Lo que falta para poder publicar (vacío = se puede publicar). */
create or replace function public.restaurant_missing_fields(p_restaurant_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants%rowtype;
  v_missing text[] := '{}';
begin
  if not (public.is_member(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.restaurants x where x.id = p_restaurant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.address_line is null then v_missing := array_append(v_missing, 'address_line'); end if;
  if r.postal_code is null then v_missing := array_append(v_missing, 'postal_code'); end if;
  if r.city is null then v_missing := array_append(v_missing, 'city'); end if;
  if r.phone is null and r.contact_email is null then v_missing := array_append(v_missing, 'contact'); end if;
  if not exists (select 1 from public.services s where s.restaurant_id = r.id) then
    v_missing := array_append(v_missing, 'services');
  end if;
  if r.legal_name is null then v_missing := array_append(v_missing, 'legal_name'); end if;
  if r.tax_id is null then v_missing := array_append(v_missing, 'tax_id'); end if;
  return v_missing;
end $$;

/** El administrador publica: acepta el contrato de encargado del tratamiento y pasa a 'active'. */
create or replace function public.publish_restaurant(p_restaurant_id uuid, p_dpa_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.restaurant_status;
  v_missing text[];
begin
  if not public.has_role(p_restaurant_id, '{admin}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select r.status into v_status from public.restaurants r where r.id = p_restaurant_id for update;
  if v_status = 'active' then
    raise exception 'ALREADY_PUBLISHED' using errcode = 'P0001';
  end if;
  -- Debe coincidir con DPA_VERSION de src/lib/legal/dpa.ts.
  if p_dpa_version is distinct from '2026-11-borrador' then
    raise exception 'DPA_VERSION' using errcode = '22023';
  end if;
  v_missing := public.restaurant_missing_fields(p_restaurant_id);
  if cardinality(v_missing) > 0 then
    raise exception 'MISSING_FIELDS' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
  end if;
  update public.restaurants
     set status = 'active', published_at = now(), dpa_accepted_at = now(),
         dpa_accepted_by = auth.uid(), dpa_version = p_dpa_version
   where id = p_restaurant_id;
  insert into public.admin_audit_log (actor_id, action, restaurant_id, details)
  values (auth.uid(), 'restaurant.publish', p_restaurant_id, jsonb_build_object('dpa_version', p_dpa_version));
end $$;

/** FByte ya no activa restaurantes sin contrato aceptado: publicar es cosa del restaurante. */
create or replace function public.set_restaurant_status(p_restaurant_id uuid, p_status public.restaurant_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dpa timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select r.dpa_accepted_at into v_dpa from public.restaurants r where r.id = p_restaurant_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_status = 'active' and v_dpa is null then
    raise exception 'DPA_REQUIRED' using errcode = 'P0001';
  end if;
  update public.restaurants set status = p_status where id = p_restaurant_id;
  insert into public.admin_audit_log (actor_id, action, restaurant_id, details)
  values (auth.uid(), 'restaurant.status', p_restaurant_id, jsonb_build_object('status', p_status));
end $$;

/**
 * Mini-web: datos públicos de un restaurante activo, {"redirect": "<slug>"} si es una dirección antigua,
 * o null. Nunca devuelve equipo, invitaciones, auditoría ni datos del contrato.
 */
create or replace function public.get_public_restaurant(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  r public.restaurants%rowtype;
  v_target text;
  v_today date;
begin
  select * into r from public.restaurants x where x.slug = v_slug and x.status = 'active';
  if not found then
    select x.slug into v_target
      from public.slug_redirects s join public.restaurants x on x.id = s.restaurant_id
     where s.old_slug = v_slug and x.status = 'active';
    if found then
      return jsonb_build_object('redirect', v_target);
    end if;
    return null;
  end if;
  v_today := (now() at time zone r.timezone)::date;
  return jsonb_build_object(
    'id', r.id,
    'slug', r.slug,
    'name', r.name,
    'timezone', r.timezone,
    'enabled_locales', to_jsonb(r.enabled_locales),
    'cuisine', r.cuisine,
    'price_range', r.price_range,
    'address_line', r.address_line,
    'postal_code', r.postal_code,
    'city', r.city,
    'phone', r.phone,
    'contact_email', r.contact_email,
    'website', r.website,
    'instagram', r.instagram,
    'facebook', r.facebook,
    'tiktok', r.tiktok,
    'accent_color', r.accent_color,
    'logo_path', r.logo_path,
    'cover_path', r.cover_path,
    'legal_name', r.legal_name,
    'tax_id', r.tax_id,
    'descriptions', coalesce((
      select jsonb_object_agg(t.locale, t.description)
        from public.restaurant_translations t where t.restaurant_id = r.id
    ), '{}'::jsonb),
    'photos', coalesce((
      select jsonb_agg(p.path order by p.position, p.created_at)
        from public.restaurant_photos p where p.restaurant_id = r.id
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', s.name, 'weekday', s.weekday, 'start_minute', s.start_minute, 'end_minute', s.end_minute
             ) order by s.weekday, s.start_minute)
        from public.services s where s.restaurant_id = r.id
    ), '[]'::jsonb),
    -- Cierres y días especiales que no han terminado, de los próximos 90 días (fechas en la zona del restaurante).
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date_from', e.date_from, 'date_to', e.date_to, 'kind', e.kind,
               'custom_services', e.custom_services, 'note', e.note
             ) order by e.date_from)
        from public.schedule_exceptions e
       where e.restaurant_id = r.id and e.date_to >= v_today and e.date_from <= v_today + 90
    ), '[]'::jsonb)
  );
end $$;

/** Para sitemap.xml: restaurantes activos. */
create or replace function public.list_public_slugs()
returns table (slug text, enabled_locales text[], updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.slug, r.enabled_locales, r.updated_at from public.restaurants r where r.status = 'active' order by r.slug
$$;

revoke execute on function public.restaurant_missing_fields(uuid), public.publish_restaurant(uuid, text),
  public.get_public_restaurant(text), public.list_public_slugs()
  from public, anon;
grant execute on function public.restaurant_missing_fields(uuid), public.publish_restaurant(uuid, text)
  to authenticated;
grant execute on function public.get_public_restaurant(text), public.list_public_slugs() to anon, authenticated;
