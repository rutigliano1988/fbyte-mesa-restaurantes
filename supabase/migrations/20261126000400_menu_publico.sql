-- Mesa · Hito 3 · carta pública para anon: solo cartas activas de restaurantes activos, en sus idiomas activos.
-- Las cartas traen su programación: qué menú del día se ve lo decide la página al pintarse (zona del restaurante).

/** Solo los idiomas pedidos de un texto por idioma. Uso interno de get_public_menu. */
create or replace function public.i18n_pick(p_value jsonb, p_locales text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p_value, '{}'::jsonb)) e
   where e.key = any (p_locales)
$$;

/**
 * Carta pública de un restaurante activo: {"unavailable_mode": …, "menus": […]}, o null.
 * Nunca devuelve cartas desactivadas ni nada de restaurantes en configuración o desactivados.
 */
create or replace function public.get_public_menu(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  r public.restaurants%rowtype;
begin
  select * into r from public.restaurants x where x.slug = v_slug and x.status = 'active';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'unavailable_mode', r.menu_unavailable_mode,
    'menus', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'names', public.i18n_pick(m.names, r.enabled_locales),
               'price_cents', m.price_cents, 'includes', public.i18n_pick(m.includes, r.enabled_locales),
               'weekdays', to_jsonb(m.weekdays), 'start_minute', m.start_minute, 'end_minute', m.end_minute,
               'date_from', m.date_from, 'date_to', m.date_to,
               'sections', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'names', public.i18n_pick(s.names, r.enabled_locales),
                          'items', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', i.id,
                                     'inline_names', case when i.inline_names is null then null
                                                          else public.i18n_pick(i.inline_names, r.enabled_locales) end,
                                     'inline_allergens', to_jsonb(i.inline_allergens),
                                     'dish', case when d.id is null then null else jsonb_build_object(
                                       'id', d.id,
                                       'names', public.i18n_pick(d.names, r.enabled_locales),
                                       'descriptions', public.i18n_pick(d.descriptions, r.enabled_locales),
                                       'photo_path', d.photo_path,
                                       'allergens', to_jsonb(d.allergens),
                                       'tags', to_jsonb(d.tags),
                                       'unavailable', d.unavailable,
                                       'prices', coalesce((
                                         select jsonb_agg(jsonb_build_object(
                                                  'kind', p.kind, 'price_cents', p.price_cents,
                                                  'labels', public.i18n_pick(p.labels, r.enabled_locales)
                                                ) order by p.position, p.created_at)
                                           from public.dish_prices p where p.dish_id = d.id
                                       ), '[]'::jsonb)
                                     ) end
                                   ) order by i.position, i.created_at)
                              from public.menu_items i left join public.dishes d on d.id = i.dish_id
                             where i.section_id = s.id
                          ), '[]'::jsonb)
                        ) order by s.position, s.created_at)
                   from public.menu_sections s where s.menu_id = m.id
               ), '[]'::jsonb)
             ) order by m.position, m.created_at)
        from public.menus m
       where m.restaurant_id = r.id and m.active
    ), '[]'::jsonb)
  );
end $$;

/** Para sitemap.xml: restaurantes activos con alguna carta activa que tenga platos. */
create or replace function public.list_public_menus()
returns table (slug text, enabled_locales text[], updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.slug, r.enabled_locales,
         greatest(r.updated_at,
                  (select max(m.updated_at) from public.menus m where m.restaurant_id = r.id and m.active),
                  (select max(d.updated_at) from public.dishes d where d.restaurant_id = r.id))
    from public.restaurants r
   where r.status = 'active'
     and exists (
       select 1 from public.menus m join public.menu_items i on i.menu_id = m.id
        where m.restaurant_id = r.id and m.active
     )
   order by r.slug
$$;

revoke execute on function public.i18n_pick(jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.get_public_menu(text), public.list_public_menus() from public, anon;
grant execute on function public.get_public_menu(text), public.list_public_menus() to anon, authenticated;
