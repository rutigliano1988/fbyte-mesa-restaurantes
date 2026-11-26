import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asSuperuser,
  createUser,
  expectDbError,
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

async function setup(c: pg.PoolClient) {
  const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
  const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b', status: 'setup' });
  const admin = await createUser(c, 'admin@example.com');
  const manager = await createUser(c, 'enc@example.com');
  const staff = await createUser(c, 'sala@example.com');
  const otherAdmin = await createUser(c, 'otro@example.com');
  await addMember(c, a, admin.id, 'admin');
  await addMember(c, a, manager.id, 'manager');
  await addMember(c, a, staff.id, 'staff');
  await addMember(c, b, otherAdmin.id, 'admin');
  return { a, b, admin, manager, staff, otherAdmin };
}

const json = (v: unknown) => JSON.stringify(v);
const SAVE_DISH = 'select public.save_dish($1, $2, $3, $4, $5, $6, $7) as id';

async function prices(c: pg.PoolClient, dishId: string) {
  await asSuperuser(c);
  const { rows } = await c.query(
    'select kind, price_cents, labels, position from public.dish_prices where dish_id = $1 order by position',
    [dishId],
  );
  return rows;
}

describe('save_dish', () => {
  it('crea un plato con sus precios en orden', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      await as(c, manager);
      const { rows } = await c.query(SAVE_DISH, [
        a,
        null,
        json({ es: 'Pulpo', en: 'Octopus' }),
        json({ es: 'A la gallega.' }),
        ['molluscs'],
        ['recommended'],
        json([
          { kind: 'fixed', price_cents: 1800, labels: { es: 'Ración' } },
          { kind: 'fixed', price_cents: 1000, labels: { es: 'Media' } },
        ]),
      ]);
      const id = rows[0].id as string;
      await asSuperuser(c);
      const dish = await c.query('select names, descriptions, allergens, tags, unavailable from public.dishes where id = $1', [id]);
      expect(dish.rows[0]).toEqual({
        names: { es: 'Pulpo', en: 'Octopus' },
        descriptions: { es: 'A la gallega.' },
        allergens: ['molluscs'],
        tags: ['recommended'],
        unavailable: false,
      });
      expect(await prices(c, id)).toEqual([
        { kind: 'fixed', price_cents: 1800, labels: { es: 'Ración' }, position: 0 },
        { kind: 'fixed', price_cents: 1000, labels: { es: 'Media' }, position: 1 },
      ]);
    }));

  it('al guardar de nuevo, actualiza el plato y sustituye todos sus precios', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const id = await insertDish(c, a, { name: 'Pescado', prices: [{ cents: 2000 }, { cents: 1200 }] });
      await as(c, admin);
      await c.query(SAVE_DISH, [a, id, json({ es: 'Pescado del día' }), json({}), ['fish'], [], json([{ kind: 'market', price_cents: null }])]);
      expect(await prices(c, id)).toEqual([{ kind: 'market', price_cents: null, labels: {}, position: 0 }]);
      const { rows } = await c.query('select names, allergens from public.dishes where id = $1', [id]);
      expect(rows[0]).toEqual({ names: { es: 'Pescado del día' }, allergens: ['fish'] });
    }));

  it('no combina «según mercado» con otros precios ni pasa de 4, y si falla no cambia nada', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const id = await insertDish(c, a, { name: 'Pescado', prices: [{ cents: 2000 }] });
      await as(c, admin);
      const changed = json({ es: 'Cambiado' });
      await expectDbError(c, SAVE_DISH, [a, id, changed, json({}), [], [], json([{ kind: 'market' }, { kind: 'fixed', price_cents: 900 }])], /MARKET_PRICE_ALONE/);
      await expectDbError(c, SAVE_DISH, [a, id, changed, json({}), [], [], json(Array.from({ length: 5 }, () => ({ kind: 'fixed', price_cents: 100 })))], /INVALID_INPUT/);
      await expectDbError(c, SAVE_DISH, [a, id, changed, json({}), ['gluten'], ['gluten_free'], '[]'], /dishes_tags_allergens_check/);
      await expectDbError(c, SAVE_DISH, [a, id, changed, json({}), [], [], json({ kind: 'fixed' })], /INVALID_INPUT/);
      expect(await prices(c, id)).toEqual([{ kind: 'fixed', price_cents: 2000, labels: {}, position: 0 }]);
      const { rows } = await c.query('select names from public.dishes where id = $1', [id]);
      expect(rows[0].names).toEqual({ es: 'Pescado' });
    }));

  it('Sala, otro restaurante o un plato de otro restaurante → FORBIDDEN', () =>
    tx(async (c) => {
      const { a, b, admin, staff, otherAdmin } = await setup(c);
      const dishB = await insertDish(c, b, { name: 'De B' });
      for (const u of [staff, otherAdmin]) {
        await as(c, u);
        await expectDbError(c, SAVE_DISH, [a, null, json({ es: 'X' }), json({}), [], [], '[]'], /FORBIDDEN/);
      }
      await as(c, admin);
      await expectDbError(c, SAVE_DISH, [a, dishB, json({ es: 'Robado' }), json({}), [], [], '[]'], /FORBIDDEN/);
      await asSuperuser(c);
      const { rows } = await c.query('select names from public.dishes where id = $1', [dishB]);
      expect(rows[0].names).toEqual({ es: 'De B' });
    }));
});

describe('duplicate_dish', () => {
  it('copia textos, alérgenos, etiquetas y precios (sin foto ni agotado) y la coloca al final de la sección', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      const menu = await insertMenu(c, a);
      const section = await insertSection(c, a, menu);
      const bread = await insertDish(c, a, { name: 'Pan' });
      const dish = await insertDish(c, a, {
        names: { es: 'Croquetas', en: 'Croquettes' },
        allergens: ['gluten', 'milk'],
        tags: ['recommended'],
        unavailable: true,
        photoPath: `${a}/dishes/foto.webp`,
        prices: [{ cents: 900, labels: { es: 'Media' } }, { cents: 1500, labels: { es: 'Ración' } }],
      });
      await insertItem(c, a, section, { dishId: bread }, 0);
      await insertItem(c, a, section, { dishId: dish }, 1);
      await as(c, manager);
      const { rows } = await c.query('select public.duplicate_dish($1, $2) as id', [dish, section]);
      const copy = rows[0].id as string;
      const d = await c.query('select names, allergens, tags, unavailable, photo_path from public.dishes where id = $1', [copy]);
      expect(d.rows[0]).toEqual({
        names: { es: 'Croquetas (copia)', en: 'Croquettes' },
        allergens: ['gluten', 'milk'],
        tags: ['recommended'],
        unavailable: false,
        photo_path: null,
      });
      expect((await prices(c, copy)).map((p) => [p.price_cents, p.labels.es])).toEqual([
        [900, 'Media'],
        [1500, 'Ración'],
      ]);
      const items = await c.query('select dish_id, position from public.menu_items where section_id = $1 order by position', [section]);
      expect(items.rows).toEqual([
        { dish_id: bread, position: 0 },
        { dish_id: dish, position: 1 },
        { dish_id: copy, position: 2 },
      ]);
    }));

  it('sin sección solo crea el plato; Sala y otros restaurantes no pueden duplicar', () =>
    tx(async (c) => {
      const { a, admin, staff, otherAdmin } = await setup(c);
      const dish = await insertDish(c, a, { name: 'x'.repeat(120) });
      await as(c, admin);
      const { rows } = await c.query('select public.duplicate_dish($1, null) as id', [dish]);
      const names = await c.query('select names from public.dishes where id = $1', [rows[0].id]);
      expect(names.rows[0].names.es).toBe(`${'x'.repeat(112)} (copia)`);
      expect((await c.query('select 1 from public.menu_items where dish_id = $1', [rows[0].id])).rowCount).toBe(0);
      for (const u of [staff, otherAdmin]) {
        await as(c, u);
        await expectDbError(c, 'select public.duplicate_dish($1, null)', [dish], /FORBIDDEN/);
      }
    }));
});

describe('orden', () => {
  async function tree(c: pg.PoolClient, a: string) {
    const m1 = await insertMenu(c, a, { name: 'Uno', position: 0 });
    const m2 = await insertMenu(c, a, { name: 'Dos', position: 1 });
    const m3 = await insertMenu(c, a, { name: 'Tres', position: 2 });
    const s1 = await insertSection(c, a, m1, 'A', 0);
    const s2 = await insertSection(c, a, m1, 'B', 1);
    const items: string[] = [];
    for (const [i, name] of ['Pan', 'Sopa', 'Flan'].entries()) {
      items.push(await insertItem(c, a, s1, { dishId: await insertDish(c, a, { name }) }, i));
    }
    return { m1, m2, m3, s1, s2, items };
  }

  async function ids(c: pg.PoolClient, sql: string, param: string) {
    await asSuperuser(c);
    return (await c.query(sql, [param])).rows.map((r) => r.id);
  }

  it('reorder_menus, reorder_sections y reorder_items dejan las posiciones en el orden pedido', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      const { m1, m2, m3, s1, s2, items } = await tree(c, a);
      await as(c, manager);
      await c.query('select public.reorder_menus($1, $2)', [a, [m3, m1, m2]]);
      await c.query('select public.reorder_sections($1, $2)', [m1, [s2, s1]]);
      await c.query('select public.reorder_items($1, $2)', [s1, [items[2], items[0], items[1]]]);
      expect(await ids(c, 'select id from public.menus where restaurant_id = $1 order by position', a)).toEqual([m3, m1, m2]);
      expect(await ids(c, 'select id from public.menu_sections where menu_id = $1 order by position', m1)).toEqual([s2, s1]);
      expect(await ids(c, 'select id from public.menu_items where section_id = $1 order by position', s1)).toEqual([
        items[2],
        items[0],
        items[1],
      ]);
    }));

  it('exige exactamente los mismos elementos: ni de menos, ni repetidos, ni de otro sitio', () =>
    tx(async (c) => {
      const { a, b, admin } = await setup(c);
      const { m1, m2, m3, s1, s2, items } = await tree(c, a);
      const menuB = await insertMenu(c, b);
      await as(c, admin);
      for (const list of [[m1, m2], [m1, m1, m2], [m1, m2, m3, menuB]]) {
        await expectDbError(c, 'select public.reorder_menus($1, $2)', [a, list], /INVALID_INPUT/);
      }
      await expectDbError(c, 'select public.reorder_menus($1, null)', [a], /INVALID_INPUT/);
      await expectDbError(c, 'select public.reorder_sections($1, $2)', [m1, [s1]], /INVALID_INPUT/);
      await expectDbError(c, 'select public.reorder_items($1, $2)', [s2, items], /INVALID_INPUT/);
    }));

  it('Sala y otros restaurantes no ordenan nada', () =>
    tx(async (c) => {
      const { a, staff, otherAdmin } = await setup(c);
      const { m1, m2, m3, s1, s2, items } = await tree(c, a);
      for (const u of [staff, otherAdmin]) {
        await as(c, u);
        await expectDbError(c, 'select public.reorder_menus($1, $2)', [a, [m3, m2, m1]], /FORBIDDEN/);
        await expectDbError(c, 'select public.reorder_sections($1, $2)', [m1, [s2, s1]], /FORBIDDEN/);
        await expectDbError(c, 'select public.reorder_items($1, $2)', [s1, [...items].reverse()], /FORBIDDEN/);
      }
    }));
});

describe('agotados', () => {
  it('Sala, Encargado y Administrador marcan y quitan «Agotado» con set_dish_unavailable', () =>
    tx(async (c) => {
      const { a, admin, manager, staff } = await setup(c);
      const dish = await insertDish(c, a);
      for (const [u, value] of [
        [staff, true],
        [manager, false],
        [admin, true],
      ] as const) {
        await as(c, u);
        await c.query('select public.set_dish_unavailable($1, $2)', [dish, value]);
        const { rows } = await c.query('select unavailable from public.dishes where id = $1', [dish]);
        expect(rows[0].unavailable, u.email).toBe(value);
      }
      await expectDbError(c, 'select public.set_dish_unavailable($1, null)', [dish], /INVALID_INPUT/);
    }));

  it('ni otro restaurante, ni un restaurante desactivado, ni anon', () =>
    tx(async (c) => {
      const { a, staff, otherAdmin } = await setup(c);
      const dish = await insertDish(c, a);
      await as(c, otherAdmin);
      await expectDbError(c, 'select public.set_dish_unavailable($1, true)', [dish], /FORBIDDEN/);
      await as(c, null);
      await expectDbError(c, 'select public.set_dish_unavailable($1, true)', [dish], /permission denied/);
      await asSuperuser(c);
      await c.query("update public.restaurants set status = 'disabled' where id = $1", [a]);
      await as(c, staff);
      await expectDbError(c, 'select public.set_dish_unavailable($1, true)', [dish], /FORBIDDEN/);
    }));

  it('el modo de agotados lo eligen Administrador y Encargado, también con la web publicada; Sala no', () =>
    tx(async (c) => {
      const { a, admin, manager, staff } = await setup(c);
      await makePublishable(c, a);
      await c.query("update public.restaurants set status = 'active' where id = $1", [a]);
      for (const [u, mode] of [
        [manager, 'hide'],
        [admin, 'strike'],
        [manager, 'hide'],
      ] as const) {
        await as(c, u);
        await c.query('select public.set_menu_unavailable_mode($1, $2)', [a, mode]);
        const { rows } = await c.query('select menu_unavailable_mode from public.restaurants where id = $1', [a]);
        expect(rows[0].menu_unavailable_mode).toBe(mode);
      }
      await expectDbError(c, 'select public.set_menu_unavailable_mode($1, null)', [a], /INVALID_INPUT/);
      await as(c, staff);
      await expectDbError(c, "select public.set_menu_unavailable_mode($1, 'strike')", [a], /FORBIDDEN/);
    }));
});

describe('get_menu_tree', () => {
  it('da al equipo todas las cartas (también las desactivadas), secciones, elementos y platos en orden', () =>
    tx(async (c) => {
      const { a, staff } = await setup(c);
      const daily = await insertMenu(c, a, { kind: 'daily', name: 'Menú del día', position: 1, startMinute: 780, endMinute: 960 });
      const carta = await insertMenu(c, a, { name: 'Carta', position: 0, active: false });
      const segundos = await insertSection(c, a, daily, 'Segundos', 1);
      const primeros = await insertSection(c, a, daily, 'Primeros', 0);
      const dish = await insertDish(c, a, { name: 'Lentejas', prices: [{ cents: 800 }] });
      await insertItem(c, a, primeros, { dishId: dish });
      await insertItem(c, a, segundos, { inlineName: 'Merluza', inlineAllergens: ['fish'] });
      await as(c, staff);
      const { rows } = await c.query('select public.get_menu_tree($1) as tree', [a]);
      const t = rows[0].tree;
      expect(t.enabled_locales).toEqual(['es']);
      expect(t.unavailable_mode).toBe('strike');
      expect(t.timezone).toBe('Europe/Madrid');
      expect(t.menus.map((m: { id: string; active: boolean }) => [m.id, m.active])).toEqual([
        [carta, false],
        [daily, true],
      ]);
      const d = t.menus[1];
      expect([d.kind, d.price_cents, d.weekdays, d.start_minute, d.end_minute]).toEqual(['daily', 1500, [1, 2, 3, 4, 5], 780, 960]);
      expect(d.sections.map((s: { names: { es: string } }) => s.names.es)).toEqual(['Primeros', 'Segundos']);
      expect(d.sections[0].items[0]).toMatchObject({ dish_id: dish, inline_names: null, inline_allergens: [] });
      expect(d.sections[1].items[0]).toMatchObject({ dish_id: null, inline_names: { es: 'Merluza' }, inline_allergens: ['fish'] });
      expect(t.dishes).toEqual([
        {
          id: dish,
          names: { es: 'Lentejas' },
          descriptions: {},
          photo_path: null,
          allergens: [],
          tags: [],
          unavailable: false,
          prices: [{ kind: 'fixed', price_cents: 800, labels: {} }],
        },
      ]);
    }));

  it('quien no es del restaurante recibe FORBIDDEN', () =>
    tx(async (c) => {
      const { a, otherAdmin } = await setup(c);
      await insertMenu(c, a);
      await as(c, otherAdmin);
      await expectDbError(c, 'select public.get_menu_tree($1)', [a], /FORBIDDEN/);
    }));
});
