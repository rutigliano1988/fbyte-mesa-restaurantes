-- Mesa · Hito 3 · funciones del panel del menú: leer todo el menú, guardar platos con sus precios,
-- duplicar, ordenar y agotados. Las de edición son SECURITY INVOKER: se aplican las RLS del usuario.

/** Todo el menú del restaurante para el panel (también las cartas desactivadas), en una sola llamada. */
create or replace function public.get_menu_tree(p_restaurant_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  r public.restaurants%rowtype;
begin
  if not (public.is_member(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.restaurants x where x.id = p_restaurant_id;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enabled_locales', to_jsonb(r.enabled_locales),
    'unavailable_mode', r.menu_unavailable_mode,
    'timezone', r.timezone,
    'menus', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'names', m.names, 'includes', m.includes, 'active', m.active,
               'position', m.position, 'price_cents', m.price_cents, 'weekdays', to_jsonb(m.weekdays),
               'start_minute', m.start_minute, 'end_minute', m.end_minute, 'date_from', m.date_from, 'date_to', m.date_to,
               'sections', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'names', s.names, 'position', s.position,
                          'items', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', i.id, 'position', i.position, 'dish_id', i.dish_id,
                                     'inline_names', i.inline_names, 'inline_allergens', to_jsonb(i.inline_allergens)
                                   ) order by i.position, i.created_at)
                              from public.menu_items i where i.section_id = s.id
                          ), '[]'::jsonb)
                        ) order by s.position, s.created_at)
                   from public.menu_sections s where s.menu_id = m.id
               ), '[]'::jsonb)
             ) order by m.position, m.created_at)
        from public.menus m where m.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    'dishes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'names', d.names, 'descriptions', d.descriptions, 'photo_path', d.photo_path,
               'allergens', to_jsonb(d.allergens), 'tags', to_jsonb(d.tags), 'unavailable', d.unavailable,
               'prices', coalesce((
                 select jsonb_agg(jsonb_build_object('kind', p.kind, 'price_cents', p.price_cents, 'labels', p.labels)
                          order by p.position, p.created_at)
                   from public.dish_prices p where p.dish_id = d.id
               ), '[]'::jsonb)
             ) order by d.created_at, d.id)
        from public.dishes d where d.restaurant_id = p_restaurant_id
    ), '[]'::jsonb)
  );
end $$;

/**
 * Crea (p_dish_id null) o actualiza un plato y sustituye sus precios, todo o nada.
 * p_prices: [{"kind": "fixed", "price_cents": 1250, "labels": {"es": "Ración"}}, …] en orden; como mucho 4.
 */
create or replace function public.save_dish(
  p_restaurant_id uuid, p_dish_id uuid, p_names jsonb, p_descriptions jsonb,
  p_allergens text[], p_tags text[], p_prices jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_dish_id;
  v_price jsonb;
  v_position integer := 0;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) > 4 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.dishes (restaurant_id, names, descriptions, allergens, tags)
    values (p_restaurant_id, p_names, coalesce(p_descriptions, '{}'::jsonb), coalesce(p_allergens, '{}'), coalesce(p_tags, '{}'))
    returning id into v_id;
  else
    update public.dishes
       set names = p_names, descriptions = coalesce(p_descriptions, '{}'::jsonb),
           allergens = coalesce(p_allergens, '{}'), tags = coalesce(p_tags, '{}')
     where id = v_id and restaurant_id = p_restaurant_id;
    if not found then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    delete from public.dish_prices p where p.dish_id = v_id;
  end if;
  for v_price in select e.value from jsonb_array_elements(p_prices) e loop
    insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents, labels, position)
    values (p_restaurant_id, v_id, (v_price ->> 'kind')::public.price_kind, (v_price ->> 'price_cents')::integer,
            coalesce(v_price -> 'labels', '{}'::jsonb), v_position);
    v_position := v_position + 1;
  end loop;
  return v_id;
end $$;

/** Copia un plato (sin foto ni agotado). Con p_section_id, coloca la copia al final de esa sección. */
create or replace function public.duplicate_dish(p_dish_id uuid, p_section_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  d public.dishes%rowtype;
  v_id uuid;
begin
  select * into d from public.dishes x where x.id = p_dish_id;
  if not found or not public.has_role(d.restaurant_id, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.dishes (restaurant_id, names, descriptions, allergens, tags)
  values (d.restaurant_id, jsonb_set(d.names, '{es}', to_jsonb(left(d.names ->> 'es', 112) || ' (copia)')),
          d.descriptions, d.allergens, d.tags)
  returning id into v_id;
  insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents, labels, position)
  select p.restaurant_id, v_id, p.kind, p.price_cents, p.labels, p.position
    from public.dish_prices p where p.dish_id = p_dish_id order by p.position;
  if p_section_id is not null then
    insert into public.menu_items (restaurant_id, section_id, dish_id, position)
    values (d.restaurant_id, p_section_id, v_id,
            coalesce((select max(i.position) + 1 from public.menu_items i where i.section_id = p_section_id), 0));
  end if;
  return v_id;
end $$;

/** Posiciones 0, 1, 2… de las cartas en el orden de p_ids, que trae exactamente todas las del restaurante. */
create or replace function public.reorder_menus(p_restaurant_id uuid, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not public.has_role(p_restaurant_id, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_ids is null or array(select x from unnest(p_ids) x order by x)
       is distinct from array(select m.id from public.menus m where m.restaurant_id = p_restaurant_id order by m.id) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  update public.menus m set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where m.id = o.id and m.position is distinct from o.ord - 1;
end $$;

create or replace function public.reorder_sections(p_menu_id uuid, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_restaurant uuid;
begin
  select m.restaurant_id into v_restaurant from public.menus m where m.id = p_menu_id;
  if v_restaurant is null or not public.has_role(v_restaurant, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_ids is null or array(select x from unnest(p_ids) x order by x)
       is distinct from array(select s.id from public.menu_sections s where s.menu_id = p_menu_id order by s.id) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  update public.menu_sections s set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.position is distinct from o.ord - 1;
end $$;

create or replace function public.reorder_items(p_section_id uuid, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_restaurant uuid;
begin
  select s.restaurant_id into v_restaurant from public.menu_sections s where s.id = p_section_id;
  if v_restaurant is null or not public.has_role(v_restaurant, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_ids is null or array(select x from unnest(p_ids) x order by x)
       is distinct from array(select i.id from public.menu_items i where i.section_id = p_section_id order by i.id) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  update public.menu_items i set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where i.id = o.id and i.position is distinct from o.ord - 1;
end $$;

/** Marcar o quitar «Agotado». También Sala, que no tiene UPDATE efectivo sobre dishes. */
create or replace function public.set_dish_unavailable(p_dish_id uuid, p_unavailable boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant uuid;
begin
  select d.restaurant_id into v_restaurant from public.dishes d where d.id = p_dish_id;
  if v_restaurant is null or not public.has_role(v_restaurant, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_unavailable is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  update public.dishes set unavailable = p_unavailable where id = p_dish_id;
end $$;

/** Cómo salen los agotados en la carta pública: ocultos (hide) o tachados (strike). */
create or replace function public.set_menu_unavailable_mode(p_restaurant_id uuid, p_mode public.menu_unavailable_mode)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_restaurant_id, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_mode is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  update public.restaurants set menu_unavailable_mode = p_mode where id = p_restaurant_id;
end $$;

revoke execute on function public.get_menu_tree(uuid),
  public.save_dish(uuid, uuid, jsonb, jsonb, text[], text[], jsonb), public.duplicate_dish(uuid, uuid),
  public.reorder_menus(uuid, uuid[]), public.reorder_sections(uuid, uuid[]), public.reorder_items(uuid, uuid[]),
  public.set_dish_unavailable(uuid, boolean), public.set_menu_unavailable_mode(uuid, public.menu_unavailable_mode)
  from public, anon;
grant execute on function public.get_menu_tree(uuid),
  public.save_dish(uuid, uuid, jsonb, jsonb, text[], text[], jsonb), public.duplicate_dish(uuid, uuid),
  public.reorder_menus(uuid, uuid[]), public.reorder_sections(uuid, uuid[]), public.reorder_items(uuid, uuid[]),
  public.set_dish_unavailable(uuid, boolean), public.set_menu_unavailable_mode(uuid, public.menu_unavailable_mode)
  to authenticated;
