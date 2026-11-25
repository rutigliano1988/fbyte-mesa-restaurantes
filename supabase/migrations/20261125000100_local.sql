-- Mesa · Hito 2 · ficha del local: datos públicos, descripciones, galería, redirecciones de slug y Storage.

-- Datos nuevos del restaurante -------------------------------------------------------
alter table public.restaurants
  add column cuisine text
    constraint restaurants_cuisine_check check (length(trim(cuisine)) between 1 and 60),
  add column price_range smallint
    constraint restaurants_price_range_check check (price_range between 1 and 4),
  add column address_line text
    constraint restaurants_address_line_check check (length(trim(address_line)) between 3 and 200),
  add column postal_code text
    constraint restaurants_postal_code_check check (postal_code ~ '^(0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}$'),
  add column city text
    constraint restaurants_city_check check (length(trim(city)) between 2 and 100),
  add column phone text
    constraint restaurants_phone_check check (phone ~ '^\+?[0-9]{9,15}$'),
  add column contact_email text
    constraint restaurants_contact_email_check check (contact_email = lower(contact_email) and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column website text
    constraint restaurants_website_check check (website ~ '^https://\S+$' and length(website) <= 300),
  add column instagram text
    constraint restaurants_instagram_check check (instagram ~ '^https://www\.instagram\.com/[A-Za-z0-9._]{1,30}$'),
  add column facebook text
    constraint restaurants_facebook_check check (facebook ~ '^https://www\.facebook\.com/\S{1,100}$'),
  add column tiktok text
    constraint restaurants_tiktok_check check (tiktok ~ '^https://www\.tiktok\.com/@[A-Za-z0-9._]{2,24}$'),
  add column accent_color text not null default '#17317F'
    constraint restaurants_accent_color_check check (accent_color ~ '^#[0-9A-F]{6}$'),
  add column logo_path text,
  add column cover_path text,
  add column legal_name text
    constraint restaurants_legal_name_check check (length(trim(legal_name)) between 2 and 200),
  add column tax_id text
    constraint restaurants_tax_id_check check (tax_id ~ '^([0-9]{8}[A-Z]|[XYZKLM][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$'),
  add column published_at timestamptz,
  add column dpa_accepted_at timestamptz,
  add column dpa_accepted_by uuid references auth.users (id) on delete set null,
  add column dpa_version text;

-- Las imágenes del restaurante solo pueden estar en su carpeta.
alter table public.restaurants
  add constraint restaurants_logo_path_check
    check (logo_path ~ ('^' || id::text || '/logo-[a-z0-9-]+\.(webp|jpg)$')),
  add constraint restaurants_cover_path_check
    check (cover_path ~ ('^' || id::text || '/cover-[a-z0-9-]+\.(webp|jpg)$'));

-- El administrador edita la ficha; slug, estado, publicación y contrato van por funciones.
grant update (cuisine, price_range, address_line, postal_code, city, phone, contact_email, website,
  instagram, facebook, tiktok, accent_color, logo_path, cover_path, legal_name, tax_id)
  on public.restaurants to authenticated;

-- Descripción por idioma ------------------------------------------------------------
create table public.restaurant_translations (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  locale text not null
    constraint restaurant_translations_locale_check check (locale in ('es', 'en', 'ca', 'fr', 'de', 'it')),
  description text not null
    constraint restaurant_translations_description_check check (length(trim(description)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, locale)
);
create trigger restaurant_translations_updated_at before update on public.restaurant_translations
  for each row execute function public.set_updated_at();

/** Guarda las descripciones de golpe: {"es": "…", "en": ""}. Texto vacío = borrar ese idioma. */
create or replace function public.save_restaurant_translations(p_restaurant_id uuid, p_descriptions jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_locale text;
  v_text text;
begin
  if not public.has_role(p_restaurant_id, '{admin}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_descriptions) is distinct from 'object' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  for v_locale, v_text in select d.key, d.value from jsonb_each_text(p_descriptions) d loop
    v_text := nullif(trim(v_text), '');
    if v_text is null then
      delete from public.restaurant_translations t
       where t.restaurant_id = p_restaurant_id and t.locale = v_locale;
    else
      insert into public.restaurant_translations (restaurant_id, locale, description)
      values (p_restaurant_id, v_locale, v_text)
      on conflict (restaurant_id, locale) do update set description = excluded.description;
    end if;
  end loop;
end $$;

-- Galería ---------------------------------------------------------------------------
create table public.restaurant_photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  path text not null unique,
  position integer not null default 0 constraint restaurant_photos_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_photos_path_check
    check (path ~ ('^' || restaurant_id::text || '/gallery/[a-z0-9-]+\.(webp|jpg)$'))
);
create index restaurant_photos_restaurant_idx on public.restaurant_photos (restaurant_id, position);
create trigger restaurant_photos_updated_at before update on public.restaurant_photos
  for each row execute function public.set_updated_at();

/** Como mucho 12 fotos por restaurante (con bloqueo, para que dos subidas a la vez no pasen de 12). */
create or replace function public.limit_restaurant_photos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.restaurants r where r.id = new.restaurant_id for no key update;
  if (select count(*) from public.restaurant_photos p where p.restaurant_id = new.restaurant_id) >= 12 then
    raise exception 'PHOTO_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger restaurant_photos_limit before insert on public.restaurant_photos
  for each row execute function public.limit_restaurant_photos();

-- Direcciones antiguas (los QR impresos siguen funcionando) ---------------------------
create table public.slug_redirects (
  old_slug text primary key
    constraint slug_redirects_old_slug_check check (old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(old_slug) between 3 and 60),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index slug_redirects_restaurant_idx on public.slug_redirects (restaurant_id);

/** Un restaurante no puede quedarse con la dirección antigua de otro. */
create or replace function public.check_slug_not_redirected() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.slug_redirects s where s.old_slug = new.slug and s.restaurant_id <> new.id
  ) then
    raise exception 'SLUG_TAKEN' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger restaurants_slug_not_redirected before insert or update of slug on public.restaurants
  for each row execute function public.check_slug_not_redirected();

create or replace function public.change_slug(p_restaurant_id uuid, p_new_slug text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_new text := lower(trim(p_new_slug));
  v_old text;
begin
  if not public.has_role(p_restaurant_id, '{admin}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select r.slug into v_old from public.restaurants r where r.id = p_restaurant_id for update;
  if v_old = v_new then
    return v_new;
  end if;
  -- Volver a una dirección antigua propia: deja de ser redirección.
  delete from public.slug_redirects s where s.old_slug = v_new and s.restaurant_id = p_restaurant_id;
  update public.restaurants set slug = v_new where id = p_restaurant_id;
  insert into public.slug_redirects (old_slug, restaurant_id) values (v_old, p_restaurant_id);
  return v_new;
end $$;

-- Privilegios y RLS ------------------------------------------------------------------
alter table public.restaurant_translations enable row level security;
alter table public.restaurant_photos enable row level security;
alter table public.slug_redirects enable row level security;

revoke all on public.restaurant_translations, public.restaurant_photos, public.slug_redirects from anon, authenticated;

grant select, insert, delete on public.restaurant_translations to authenticated;
grant update (description) on public.restaurant_translations to authenticated;
create policy translations_select on public.restaurant_translations for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy translations_insert on public.restaurant_translations for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin}'));
create policy translations_update on public.restaurant_translations for update to authenticated
  using (public.has_role(restaurant_id, '{admin}')) with check (public.has_role(restaurant_id, '{admin}'));
create policy translations_delete on public.restaurant_translations for delete to authenticated
  using (public.has_role(restaurant_id, '{admin}'));

grant select, insert, delete on public.restaurant_photos to authenticated;
grant update (position) on public.restaurant_photos to authenticated;
create policy photos_select on public.restaurant_photos for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy photos_insert on public.restaurant_photos for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin}'));
create policy photos_update on public.restaurant_photos for update to authenticated
  using (public.has_role(restaurant_id, '{admin}')) with check (public.has_role(restaurant_id, '{admin}'));
create policy photos_delete on public.restaurant_photos for delete to authenticated
  using (public.has_role(restaurant_id, '{admin}'));

grant select on public.slug_redirects to authenticated;
create policy slug_redirects_select on public.slug_redirects for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());

-- Storage: bucket público con las fotos; solo el administrador sube y borra en su carpeta ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-media', 'restaurant-media', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- Ruta {restaurant_id}/logo-…, cover-… o gallery/… (.webp o .jpg) y ser administrador de ese restaurante.
create or replace function public.can_manage_media(p_bucket_id text, p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if p_bucket_id is distinct from 'restaurant-media' or p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo-[a-z0-9-]+|cover-[a-z0-9-]+|gallery/[a-z0-9-]+)\.(webp|jpg)$' then
    return false;
  end if;
  return public.has_role(((storage.foldername(p_name))[1])::uuid, '{admin}');
end $$;

create policy restaurant_media_select on storage.objects for select to authenticated
  using (public.can_manage_media(bucket_id, name));
create policy restaurant_media_insert on storage.objects for insert to authenticated
  with check (public.can_manage_media(bucket_id, name));
create policy restaurant_media_update on storage.objects for update to authenticated
  using (public.can_manage_media(bucket_id, name)) with check (public.can_manage_media(bucket_id, name));
create policy restaurant_media_delete on storage.objects for delete to authenticated
  using (public.can_manage_media(bucket_id, name));

-- Funciones: triggers para nadie; el resto, solo usuarios autenticados.
revoke execute on function public.limit_restaurant_photos(), public.check_slug_not_redirected()
  from public, anon, authenticated;
revoke execute on function public.save_restaurant_translations(uuid, jsonb), public.change_slug(uuid, text),
  public.can_manage_media(text, text)
  from public, anon;
grant execute on function public.save_restaurant_translations(uuid, jsonb), public.change_slug(uuid, text),
  public.can_manage_media(text, text)
  to authenticated;
