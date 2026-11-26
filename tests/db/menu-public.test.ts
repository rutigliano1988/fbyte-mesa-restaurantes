import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asSuperuser,
  createUser,
  insertDish,
  insertItem,
  insertMenu,
  insertRestaurant,
  insertSection,
  makePublishable,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

/** Restaurante publicado (status active) con castellano e inglés activos. */
async function activeRestaurant(c: pg.PoolClient, slug = 'la-taberna'): Promise<string> {
  const id = await insertRestaurant(c, { name: 'La Taberna', slug, status: 'setup' });
  await makePublishable(c, id);
  await c.query("update public.restaurants set status = 'active', enabled_locales = '{es,en}' where id = $1", [id]);
  return id;
}

async function publicMenu(c: pg.PoolClient, slug: string) {
  await as(c, null);
  const { rows } = await c.query('select public.get_public_menu($1) as menu', [slug]);
  return rows[0].menu;
}

type Named = { names: { es: string } };

describe('get_public_menu', () => {
  it('anon lee las cartas activas con secciones, platos y precios, en orden y solo en los idiomas activos', () =>
    tx(async (c) => {
      const r = await activeRestaurant(c);
      const carta = await insertMenu(c, r, { name: 'Carta', position: 1 });
      await insertMenu(c, r, { name: 'Bebidas', position: 0 });
      const entrantes = await insertSection(c, r, carta, 'Entrantes', 0);
      const postres = await insertSection(c, r, carta, 'Postres', 1);
      const croquetas = await insertDish(c, r, {
        names: { es: 'Croquetas', en: 'Croquettes', ca: 'Croquetes' },
        allergens: ['gluten', 'milk'],
        prices: [{ cents: 900, labels: { es: 'Media', en: 'Half', fr: 'Demi' } }, { cents: 1500, labels: { es: 'Ración' } }],
      });
      const flan = await insertDish(c, r, { name: 'Flan', allergens: ['eggs', 'milk'], prices: [{ cents: 500 }] });
      await insertItem(c, r, postres, { dishId: flan });
      await insertItem(c, r, entrantes, { dishId: croquetas });
      const menu = await publicMenu(c, 'La-Taberna ');
      expect(menu.unavailable_mode).toBe('strike');
      expect(menu.menus.map((m: Named) => m.names.es)).toEqual(['Bebidas', 'Carta']);
      expect(menu.menus[0].sections).toEqual([]);
      const sections = menu.menus[1].sections;
      expect(sections.map((s: Named) => s.names.es)).toEqual(['Entrantes', 'Postres']);
      const dish = sections[0].items[0].dish;
      expect(dish.names).toEqual({ es: 'Croquetas', en: 'Croquettes' });
      expect(dish.allergens).toEqual(['gluten', 'milk']);
      expect(dish.prices).toEqual([
        { kind: 'fixed', price_cents: 900, labels: { es: 'Media', en: 'Half' } },
        { kind: 'fixed', price_cents: 1500, labels: { es: 'Ración' } },
      ]);
      expect(sections[1].items[0].dish.names).toEqual({ es: 'Flan' });
    }));

  it('nunca devuelve cartas desactivadas', () =>
    tx(async (c) => {
      const r = await activeRestaurant(c);
      const off = await insertMenu(c, r, { name: 'Antigua', active: false });
      await insertSection(c, r, off);
      await insertMenu(c, r, { name: 'Carta', position: 1 });
      const menu = await publicMenu(c, 'la-taberna');
      expect(menu.menus.map((m: Named) => m.names.es)).toEqual(['Carta']);
    }));

  it('restaurantes en configuración o desactivados, slugs antiguos y slugs que no existen → null', () =>
    tx(async (c) => {
      const setup = await insertRestaurant(c, { name: 'En obras', slug: 'en-obras', status: 'setup' });
      const off = await insertRestaurant(c, { name: 'Cerrado', slug: 'cerrado', status: 'disabled' });
      for (const id of [setup, off]) await insertMenu(c, id);
      const r = await activeRestaurant(c);
      await insertMenu(c, r);
      await asSuperuser(c);
      await c.query("insert into public.slug_redirects (old_slug, restaurant_id) values ('vieja-taberna', $1)", [r]);
      for (const slug of ['en-obras', 'cerrado', 'vieja-taberna', 'no-existe', '']) {
        expect(await publicMenu(c, slug), slug).toBeNull();
      }
    }));

  it('el menú del día trae precio, «incluye» y programación; los platos escritos a mano, sus alérgenos', () =>
    tx(async (c) => {
      const r = await activeRestaurant(c);
      const daily = await insertMenu(c, r, { kind: 'daily', priceCents: 1450, weekdays: [1, 2, 3, 4, 5], startMinute: 780, endMinute: 960 });
      await asSuperuser(c);
      await c.query('update public.menus set includes = $2 where id = $1', [daily, JSON.stringify({ es: 'Pan, bebida y postre', de: 'Brot' })]);
      const primeros = await insertSection(c, r, daily, 'Primeros');
      await insertItem(c, r, primeros, { inlineName: 'Sopa de pescado', inlineAllergens: ['fish', 'celery'] });
      const menu = await publicMenu(c, 'la-taberna');
      const d = menu.menus[0];
      expect(d).toMatchObject({
        kind: 'daily',
        price_cents: 1450,
        includes: { es: 'Pan, bebida y postre' },
        weekdays: [1, 2, 3, 4, 5],
        start_minute: 780,
        end_minute: 960,
        date_from: null,
        date_to: null,
      });
      expect(d.sections[0].items[0]).toMatchObject({ dish: null, inline_names: { es: 'Sopa de pescado' }, inline_allergens: ['fish', 'celery'] });
      const special = await insertMenu(c, r, { kind: 'special', name: 'Nochebuena', position: 1, dateFrom: '2026-12-24', dateTo: '2026-12-24' });
      expect(special).toBeTruthy();
      const again = await publicMenu(c, 'la-taberna');
      expect(again.menus[1]).toMatchObject({ kind: 'special', date_from: '2026-12-24', date_to: '2026-12-24' });
    }));

  it('solo devuelve las claves públicas', () =>
    tx(async (c) => {
      const r = await activeRestaurant(c);
      const carta = await insertMenu(c, r);
      const section = await insertSection(c, r, carta);
      await insertItem(c, r, section, { dishId: await insertDish(c, r, { prices: [{ cents: 900 }] }) });
      const menu = await publicMenu(c, 'la-taberna');
      expect(Object.keys(menu).sort()).toEqual(['menus', 'unavailable_mode']);
      expect(Object.keys(menu.menus[0]).sort()).toEqual(
        ['date_from', 'date_to', 'end_minute', 'id', 'includes', 'kind', 'names', 'price_cents', 'sections', 'start_minute', 'weekdays'],
      );
      expect(Object.keys(menu.menus[0].sections[0]).sort()).toEqual(['id', 'items', 'names']);
      expect(Object.keys(menu.menus[0].sections[0].items[0]).sort()).toEqual(['dish', 'id', 'inline_allergens', 'inline_names']);
      expect(Object.keys(menu.menus[0].sections[0].items[0].dish).sort()).toEqual(
        ['allergens', 'descriptions', 'id', 'names', 'photo_path', 'prices', 'tags', 'unavailable'],
      );
    }));

  it('el modo de agotados y los agotados viajan con los datos', () =>
    tx(async (c) => {
      const r = await activeRestaurant(c);
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, r, admin.id, 'admin');
      const carta = await insertMenu(c, r);
      const section = await insertSection(c, r, carta);
      await insertItem(c, r, section, { dishId: await insertDish(c, r, { unavailable: true }) });
      await as(c, admin);
      await c.query("select public.set_menu_unavailable_mode($1, 'hide')", [r]);
      const menu = await publicMenu(c, 'la-taberna');
      expect(menu.unavailable_mode).toBe('hide');
      expect(menu.menus[0].sections[0].items[0].dish.unavailable).toBe(true);
    }));
});

describe('list_public_menus', () => {
  it('solo restaurantes activos con alguna carta activa con platos', () =>
    tx(async (c) => {
      const conCarta = await activeRestaurant(c, 'con-carta');
      const carta = await insertMenu(c, conCarta);
      await insertItem(c, conCarta, await insertSection(c, conCarta, carta), { dishId: await insertDish(c, conCarta) });
      const vacia = await activeRestaurant(c, 'carta-vacia');
      await insertSection(c, vacia, await insertMenu(c, vacia));
      const apagada = await activeRestaurant(c, 'carta-apagada');
      const off = await insertMenu(c, apagada, { active: false });
      await insertItem(c, apagada, await insertSection(c, apagada, off), { dishId: await insertDish(c, apagada) });
      const enObras = await insertRestaurant(c, { name: 'En obras', slug: 'en-obras', status: 'setup' });
      const obras = await insertMenu(c, enObras);
      await insertItem(c, enObras, await insertSection(c, enObras, obras), { dishId: await insertDish(c, enObras) });
      await as(c, null);
      const { rows } = await c.query('select slug, enabled_locales, updated_at from public.list_public_menus()');
      expect(rows.map((x) => [x.slug, x.enabled_locales])).toEqual([['con-carta', ['es', 'en']]]);
      expect(rows[0].updated_at).toBeInstanceOf(Date);
    }));
});

describe('privilegios del Hito 3', () => {
  it('nadie ejecuta los triggers nuevos ni i18n_pick; anon tampoco las funciones del panel', () =>
    tx(async (c) => {
      for (const role of ['anon', 'authenticated']) {
        for (const fn of [
          'public.limit_menu_rows()',
          'public.check_dish_prices()',
          'public.check_menu_item()',
          'public.i18n_pick(jsonb, text[])',
        ]) {
          const { rows } = await c.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute']);
          expect(rows[0].ok, `${role} → ${fn}`).toBe(false);
        }
      }
      for (const fn of [
        'public.get_menu_tree(uuid)',
        'public.save_dish(uuid, uuid, jsonb, jsonb, text[], text[], jsonb)',
        'public.set_dish_unavailable(uuid, boolean)',
        'public.valid_i18n(jsonb, integer, boolean)',
      ]) {
        const { rows } = await c.query("select has_function_privilege('anon', $1, 'execute') as ok", [fn]);
        expect(rows[0].ok, fn).toBe(false);
      }
    }));
});
