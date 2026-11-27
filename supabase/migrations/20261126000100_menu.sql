-- Mesa · Hito 3 · menú digital: cartas, secciones, platos reutilizables, precios y elementos de cada sección.
-- Los textos por idioma van en jsonb {"es": "…", "en": "…"}; el castellano es el idioma de respaldo.

create type public.menu_kind as enum ('carta', 'daily', 'special');
create type public.price_kind as enum ('fixed', 'per_kg', 'per_100g', 'market');
create type public.menu_unavailable_mode as enum ('hide', 'strike');

-- Cómo salen los platos agotados en la carta pública. Se cambia con set_menu_unavailable_mode (Administrador y Encargado).
alter table public.restaurants
  add column menu_unavailable_mode public.menu_unavailable_mode not null default 'strike';

/**
 * Texto por idioma: objeto con idiomas conocidos y textos de 1 a p_max caracteres (sin contar los espacios, tabuladores,
 * saltos de línea ni espacios duros de los extremos).
 * Con p_required, el castellano es obligatorio. La usan las restricciones CHECK: la ejecuta quien inserta.
 */
create or replace function public.valid_i18n(p_value jsonb, p_max integer, p_required boolean) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'object' then false
    when p_required and not (p_value ? 'es') then false
    else not exists (
      select 1 from jsonb_each(p_value) e
      where e.key not in ('es', 'en', 'ca', 'fr', 'de', 'it')
         or jsonb_typeof(e.value) <> 'string'
         or length(btrim(e.value #>> '{}', E' \t\r\n\u00a0')) not between 1 and p_max
    )
  end
$$;

-- Cartas: «carta» (siempre visible si está activa), «daily» (menú del día) y «special» (con fechas) -------------
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind public.menu_kind not null,
  names jsonb not null constraint menus_names_check check (public.valid_i18n(names, 60, true)),
  position integer not null default 0 constraint menus_position_check check (position >= 0),
  active boolean not null default true,
  price_cents integer constraint menus_price_cents_check check (price_cents between 0 and 9999999),
  includes jsonb not null default '{}'::jsonb constraint menus_includes_check check (public.valid_i18n(includes, 300, false)),
  -- Días ISO: 1 = lunes … 7 = domingo. Minutos desde medianoche; end_minute hasta 1800 (06:00 del día siguiente).
  weekdays smallint[]
    constraint menus_weekdays_check check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_minute smallint,
  end_minute smallint,
  date_from date,
  date_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  constraint menus_kind_check check (
    case when kind = 'carta'
      then price_cents is null and includes = '{}'::jsonb and weekdays is null and start_minute is null and date_from is null
      else price_cents is not null and weekdays is not null and (kind = 'daily' or date_from is not null)
    end
  ),
  -- Los dos o ninguno: con «case» para que un solo valor nulo no deje pasar el CHECK (null cuenta como aprobado).
  constraint menus_time_check check (
    case when start_minute is null and end_minute is null then true
      else start_minute is not null and end_minute is not null
        and start_minute between 0 and 1439 and end_minute > start_minute and end_minute <= 1800
    end
  ),
  constraint menus_dates_check check (
    case when date_from is null and date_to is null then true
      else date_from is not null and date_to is not null and date_to >= date_from and date_to - date_from <= 366
    end
  )
);
create index menus_restaurant_idx on public.menus (restaurant_id, position);
create trigger menus_updated_at before update on public.menus
  for each row execute function public.set_updated_at();

-- Secciones: en la carta, categorías; en el menú del día, «Primeros», «Segundos»… -----------------------------
create table public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_id uuid not null,
  names jsonb not null constraint menu_sections_names_check check (public.valid_i18n(names, 60, true)),
  position integer not null default 0 constraint menu_sections_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (menu_id, restaurant_id) references public.menus (id, restaurant_id) on delete cascade
);
create index menu_sections_menu_idx on public.menu_sections (menu_id, position);
create index menu_sections_restaurant_idx on public.menu_sections (restaurant_id);
create trigger menu_sections_updated_at before update on public.menu_sections
  for each row execute function public.set_updated_at();

-- Platos del restaurante (reutilizables en varias cartas) --------------------------------------------------------
create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  names jsonb not null constraint dishes_names_check check (public.valid_i18n(names, 120, true)),
  descriptions jsonb not null default '{}'::jsonb
    constraint dishes_descriptions_check check (public.valid_i18n(descriptions, 500, false)),
  photo_path text,
  -- Reglamento (UE) 1169/2011, anexo II (igual que src/lib/menu/codes.ts).
  allergens text[] not null default '{}'
    constraint dishes_allergens_check check (allergens <@ array['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk',
      'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']),
  tags text[] not null default '{}'
    constraint dishes_tags_check check (tags <@ array['vegan', 'vegetarian', 'gluten_free', 'spicy', 'new', 'recommended']),
  unavailable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  constraint dishes_photo_path_check
    check (photo_path ~ ('^' || restaurant_id::text || '/dishes/[a-z0-9-]+\.(webp|jpg)$')),
  constraint dishes_tags_allergens_check check (
    not ('gluten_free' = any (tags) and 'gluten' = any (allergens))
    and not ('vegan' = any (tags) and allergens && array['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'])
  )
);
create index dishes_restaurant_idx on public.dishes (restaurant_id);
create trigger dishes_updated_at before update on public.dishes
  for each row execute function public.set_updated_at();

-- Precios: fijo (con etiqueta opcional: Ración/Media), por kilo, por 100 g o «según mercado» (sin importe) ------
create table public.dish_prices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  dish_id uuid not null,
  kind public.price_kind not null default 'fixed',
  price_cents integer,
  labels jsonb not null default '{}'::jsonb constraint dish_prices_labels_check check (public.valid_i18n(labels, 40, false)),
  position integer not null default 0 constraint dish_prices_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (dish_id, restaurant_id) references public.dishes (id, restaurant_id) on delete cascade,
  constraint dish_prices_amount_check check (
    case when kind = 'market' then price_cents is null
      else price_cents is not null and price_cents between 0 and 9999999
    end
  )
);
create index dish_prices_dish_idx on public.dish_prices (dish_id, position);
create index dish_prices_restaurant_idx on public.dish_prices (restaurant_id);
create trigger dish_prices_updated_at before update on public.dish_prices
  for each row execute function public.set_updated_at();

-- Elementos de una sección: un plato del restaurante o uno escrito solo para ese menú, nunca los dos ------------
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  section_id uuid not null,
  -- Lo rellena el trigger desde la sección: sirve para que un plato no se repita en la misma carta.
  menu_id uuid not null,
  dish_id uuid,
  inline_names jsonb
    constraint menu_items_inline_names_check check (inline_names is null or public.valid_i18n(inline_names, 120, true)),
  inline_allergens text[] not null default '{}'
    constraint menu_items_inline_allergens_check check (inline_allergens <@ array['gluten', 'crustaceans', 'eggs', 'fish',
      'peanuts', 'soy', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']),
  position integer not null default 0 constraint menu_items_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (section_id, restaurant_id) references public.menu_sections (id, restaurant_id) on delete cascade,
  foreign key (menu_id, restaurant_id) references public.menus (id, restaurant_id) on delete cascade,
  foreign key (dish_id, restaurant_id) references public.dishes (id, restaurant_id) on delete cascade,
  constraint menu_items_kind_check check ((dish_id is null) <> (inline_names is null)),
  constraint menu_items_inline_allergens_only_check check (dish_id is null or cardinality(inline_allergens) = 0)
);
create index menu_items_section_idx on public.menu_items (section_id, position);
create index menu_items_dish_idx on public.menu_items (dish_id);
create index menu_items_menu_idx on public.menu_items (menu_id);
create index menu_items_restaurant_idx on public.menu_items (restaurant_id);
create unique index menu_items_menu_dish_key on public.menu_items (menu_id, dish_id) where dish_id is not null;
create trigger menu_items_updated_at before update on public.menu_items
  for each row execute function public.set_updated_at();

-- Límites (con bloqueo, para que dos altas a la vez no se cuelen) ------------------------------------------------
-- Los triggers son SECURITY DEFINER: la fila padre se busca también por restaurant_id, para que no lean ni bloqueen
-- piezas de otro restaurante (si no está en el mismo restaurante, FORBIDDEN).
create or replace function public.limit_menu_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'menus' then
    perform 1 from public.restaurants r where r.id = new.restaurant_id for no key update;
    if (select count(*) from public.menus m where m.restaurant_id = new.restaurant_id) >= 20 then
      raise exception 'MENU_LIMIT' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'menu_sections' then
    perform 1 from public.menus m where m.id = new.menu_id and m.restaurant_id = new.restaurant_id for no key update;
    if not found then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if (select count(*) from public.menu_sections s where s.menu_id = new.menu_id) >= 40 then
      raise exception 'SECTION_LIMIT' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'dishes' then
    perform 1 from public.restaurants r where r.id = new.restaurant_id for no key update;
    if (select count(*) from public.dishes d where d.restaurant_id = new.restaurant_id) >= 500 then
      raise exception 'DISH_LIMIT' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger menus_limit before insert on public.menus
  for each row execute function public.limit_menu_rows();
create trigger menu_sections_limit before insert on public.menu_sections
  for each row execute function public.limit_menu_rows();
create trigger dishes_limit before insert on public.dishes
  for each row execute function public.limit_menu_rows();

/** Como mucho 4 precios por plato, y un precio «según mercado» va solo. */
create or replace function public.check_dish_prices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.dishes d where d.id = new.dish_id and d.restaurant_id = new.restaurant_id for no key update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if (select count(*) from public.dish_prices p where p.dish_id = new.dish_id and p.id <> new.id) >= 4 then
    raise exception 'PRICE_LIMIT' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.dish_prices p
     where p.dish_id = new.dish_id and p.id <> new.id and (new.kind = 'market' or p.kind = 'market')
  ) then
    raise exception 'MARKET_PRICE_ALONE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger dish_prices_check before insert or update of kind on public.dish_prices
  for each row execute function public.check_dish_prices();

/**
 * Al añadir un elemento: hereda la carta de su sección, los platos escritos a mano solo valen en menús del día
 * y especiales, y como mucho 100 por sección.
 */
create or replace function public.check_menu_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.menu_kind;
begin
  select s.menu_id, m.kind into new.menu_id, v_kind
    from public.menu_sections s join public.menus m on m.id = s.menu_id
   where s.id = new.section_id and s.restaurant_id = new.restaurant_id;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.inline_names is not null and v_kind = 'carta' then
    raise exception 'INLINE_ONLY_DAILY' using errcode = 'P0001';
  end if;
  perform 1 from public.menu_sections s where s.id = new.section_id and s.restaurant_id = new.restaurant_id for no key update;
  if (select count(*) from public.menu_items i where i.section_id = new.section_id) >= 100 then
    raise exception 'ITEM_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger menu_items_check before insert on public.menu_items
  for each row execute function public.check_menu_item();

-- Privilegios y RLS: leen los miembros (y FByte en soporte); editan Administrador y Encargado. -------------------
-- Sala marca agotados solo con set_dish_unavailable (siguiente migración). Anon no toca nada.
alter table public.menus enable row level security;
alter table public.menu_sections enable row level security;
alter table public.dishes enable row level security;
alter table public.dish_prices enable row level security;
alter table public.menu_items enable row level security;

revoke all on public.menus, public.menu_sections, public.dishes, public.dish_prices, public.menu_items
  from anon, authenticated;

grant select, insert, delete on public.menus, public.menu_sections, public.dishes, public.dish_prices, public.menu_items
  to authenticated;
-- Ni restaurant_id, ni el tipo de carta, ni la carta o sección a la que pertenece algo se cambian con un UPDATE.
grant update (names, position, active, price_cents, includes, weekdays, start_minute, end_minute, date_from, date_to)
  on public.menus to authenticated;
grant update (names, position) on public.menu_sections to authenticated;
grant update (names, descriptions, photo_path, allergens, tags, unavailable) on public.dishes to authenticated;
grant update (kind, price_cents, labels, position) on public.dish_prices to authenticated;
grant update (inline_names, inline_allergens, position) on public.menu_items to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['menus', 'menu_sections', 'dishes', 'dish_prices', 'menu_items'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_member(restaurant_id) or public.is_platform_admin())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, ''{admin,manager}'')) '
      'with check (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_delete', t);
  end loop;
end $$;

-- Funciones: triggers para nadie; valid_i18n la ejecuta quien inserta (la usan los CHECK).
revoke execute on function public.limit_menu_rows(), public.check_dish_prices(), public.check_menu_item()
  from public, anon, authenticated;
revoke execute on function public.valid_i18n(jsonb, integer, boolean) from public, anon;
grant execute on function public.valid_i18n(jsonb, integer, boolean) to authenticated;
