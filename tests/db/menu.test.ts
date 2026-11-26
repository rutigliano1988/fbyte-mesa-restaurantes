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
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

const TABLES = ['menus', 'menu_sections', 'dishes', 'dish_prices', 'menu_items'];

/** Restaurante A con Administrador, Encargado y Sala, y un restaurante B con su Administrador. */
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

describe('menú: permisos por rol', () => {
  it('Administrador y Encargado crean cartas, secciones, platos, precios y elementos; Sala no', () =>
    tx(async (c) => {
      const { a, admin, manager, staff } = await setup(c);
      for (const u of [admin, manager]) {
        await as(c, u);
        const menu = await c.query("insert into public.menus (restaurant_id, kind, names) values ($1, 'carta', $2) returning id", [
          a,
          json({ es: `Carta de ${u.email}` }),
        ]);
        const section = await c.query(
          'insert into public.menu_sections (restaurant_id, menu_id, names) values ($1, $2, $3) returning id',
          [a, menu.rows[0].id, json({ es: 'Entrantes' })],
        );
        const dish = await c.query('insert into public.dishes (restaurant_id, names) values ($1, $2) returning id', [
          a,
          json({ es: `Croquetas ${u.email}` }),
        ]);
        await c.query("insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents) values ($1, $2, 'fixed', 950)", [
          a,
          dish.rows[0].id,
        ]);
        const item = await c.query(
          'insert into public.menu_items (restaurant_id, section_id, dish_id) values ($1, $2, $3) returning menu_id',
          [a, section.rows[0].id, dish.rows[0].id],
        );
        expect(item.rows[0].menu_id).toBe(menu.rows[0].id);
      }
      await as(c, staff);
      await expectDbError(c, "insert into public.menus (restaurant_id, kind, names) values ($1, 'carta', $2)", [a, json({ es: 'Carta' })], /row-level security/);
      await expectDbError(c, 'insert into public.dishes (restaurant_id, names) values ($1, $2)', [a, json({ es: 'Croquetas' })], /row-level security/);
    }));

  it('Sala ve el menú, pero no cambia platos ni agotados con un UPDATE ni borra nada', () =>
    tx(async (c) => {
      const { a, staff } = await setup(c);
      const menu = await insertMenu(c, a);
      const dish = await insertDish(c, a);
      await as(c, staff);
      expect((await c.query('select id from public.menus where restaurant_id = $1', [a])).rowCount).toBe(1);
      expect((await c.query('select id from public.dishes where id = $1', [dish])).rowCount).toBe(1);
      expect((await c.query('update public.dishes set unavailable = true where id = $1', [dish])).rowCount).toBe(0);
      expect((await c.query('update public.dishes set names = $2 where id = $1', [dish, json({ es: 'Otra' })])).rowCount).toBe(0);
      expect((await c.query('delete from public.menus where id = $1', [menu])).rowCount).toBe(0);
      await asSuperuser(c);
      const { rows } = await c.query('select unavailable, names from public.dishes where id = $1', [dish]);
      expect(rows[0]).toEqual({ unavailable: false, names: { es: 'Croquetas' } });
    }));

  it('un miembro de otro restaurante no ve ni toca nada', () =>
    tx(async (c) => {
      const { a, otherAdmin } = await setup(c);
      const menu = await insertMenu(c, a);
      const section = await insertSection(c, a, menu);
      const dish = await insertDish(c, a, { prices: [{ cents: 950 }] });
      await insertItem(c, a, section, { dishId: dish });
      await as(c, otherAdmin);
      for (const table of TABLES) {
        expect((await c.query(`select 1 from public.${table} where restaurant_id = $1`, [a])).rowCount, table).toBe(0);
      }
      expect((await c.query('update public.dishes set unavailable = true where id = $1', [dish])).rowCount).toBe(0);
      await expectDbError(c, 'insert into public.dishes (restaurant_id, names) values ($1, $2)', [a, json({ es: 'Intruso' })], /row-level security/);
    }));

  it('anon no lee ni escribe ninguna tabla del menú', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await insertMenu(c, a);
      await as(c, null);
      for (const table of TABLES) {
        await expectDbError(c, `select 1 from public.${table}`, [], /permission denied/);
      }
      await expectDbError(c, 'insert into public.dishes (restaurant_id, names) values ($1, $2)', [a, json({ es: 'X' })], /permission denied/);
    }));

  it('nadie cambia el restaurante, el tipo de carta ni la carta de una sección o un elemento con un UPDATE', () =>
    tx(async (c) => {
      const { a, b, admin } = await setup(c);
      const menu = await insertMenu(c, a);
      const other = await insertMenu(c, a, { name: 'Bebidas', position: 1 });
      const section = await insertSection(c, a, menu);
      const dish = await insertDish(c, a);
      await insertItem(c, a, section, { dishId: dish });
      await as(c, admin);
      await expectDbError(c, "update public.menus set kind = 'daily' where id = $1", [menu], /permission denied/);
      await expectDbError(c, 'update public.dishes set restaurant_id = $2 where id = $1', [dish, b], /permission denied/);
      await expectDbError(c, 'update public.menu_sections set menu_id = $2 where id = $1', [section, other], /permission denied/);
      await expectDbError(c, 'update public.menu_items set menu_id = $2 where section_id = $1', [section, other], /permission denied/);
    }));
});

describe('menú: restricciones', () => {
  it('textos por idioma: castellano obligatorio, idiomas conocidos y longitudes', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await asSuperuser(c);
      const sql = 'insert into public.dishes (restaurant_id, names, descriptions) values ($1, $2, $3)';
      for (const names of [{}, { en: 'Croquettes' }, { es: 'Croquetas', xx: 'Hmm' }, { es: '   ' }, { es: 'x'.repeat(121) }, { es: 1 }, []]) {
        await expectDbError(c, sql, [a, json(names), json({})], /dishes_names_check/);
      }
      await expectDbError(c, sql, [a, json({ es: 'Croquetas' }), json({ es: 'x'.repeat(501) })], /dishes_descriptions_check/);
      expect((await c.query(sql, [a, json({ es: 'Croquetas', en: 'Croquettes' }), json({ es: 'De jamón.' })])).rowCount).toBe(1);
      await expectDbError(
        c,
        "insert into public.menu_sections (restaurant_id, menu_id, names) values ($1, $2, $3)",
        [a, await insertMenu(c, a), json({ es: 'x'.repeat(61) })],
        /menu_sections_names_check/,
      );
    }));

  it('cartas: la carta no lleva precio ni programación; el menú del día y el especial sí', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await asSuperuser(c);
      const sql = `insert into public.menus (restaurant_id, kind, names, price_cents, weekdays, start_minute, end_minute, date_from, date_to)
                   values ($1, $2, '{"es": "Menú"}', $3, $4, $5, $6, $7, $8)`;
      const bad: [unknown[], RegExp][] = [
        [['carta', 1500, null, null, null, null, null], /menus_kind_check/],
        [['carta', null, [1, 2], null, null, null, null], /menus_kind_check/],
        [['daily', null, [1, 2], null, null, null, null], /menus_kind_check/],
        [['daily', 1500, null, null, null, null, null], /menus_kind_check/],
        [['special', 3500, [1, 2, 3, 4, 5, 6, 7], null, null, null, null], /menus_kind_check/],
        [['daily', 1500, [8], null, null, null, null], /menus_weekdays_check/],
        [['daily', 1500, [], null, null, null, null], /menus_weekdays_check/],
        [['daily', 1500, [1], 780, null, null, null], /menus_time_check/],
        [['daily', 1500, [1], 780, 1801, null, null], /menus_time_check/],
        [['daily', 1500, [1], 960, 780, null, null], /menus_time_check/],
        [['daily', 1500, [1], null, null, '2026-12-01', null], /menus_dates_check/],
        [['special', 3500, [1], null, null, '2026-12-25', '2026-12-24'], /menus_dates_check/],
        [['daily', 10000000, [1], null, null, null, null], /menus_price_cents_check/],
      ];
      for (const [values, pattern] of bad) await expectDbError(c, sql, [a, ...values], pattern);
      for (const values of [
        ['carta', null, null, null, null, null, null],
        ['daily', 1550, [5, 6], 1200, 1560, null, null],
        ['daily', 0, [1, 2, 3, 4, 5], null, null, '2026-12-01', '2026-12-31'],
        ['special', 4500, [1, 2, 3, 4, 5, 6, 7], 1200, 1500, '2026-12-24', '2026-12-24'],
      ]) {
        expect((await c.query(sql, [a, ...values])).rowCount).toBe(1);
      }
    }));

  it('límites: 40 secciones por carta, 100 elementos por sección, 20 cartas, 500 platos y 4 precios', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const menu = await insertMenu(c, a, { kind: 'daily' });
      await asSuperuser(c);
      await c.query(
        "insert into public.menu_sections (restaurant_id, menu_id, names, position) select $1, $2, jsonb_build_object('es', 'Sección ' || g), g from generate_series(1, 40) g",
        [a, menu],
      );
      await expectDbError(c, 'insert into public.menu_sections (restaurant_id, menu_id, names) values ($1, $2, $3)', [a, menu, json({ es: 'Otra' })], /SECTION_LIMIT/);
      const { rows: sections } = await c.query('select id from public.menu_sections where menu_id = $1 order by position limit 1', [menu]);
      await c.query(
        "insert into public.menu_items (restaurant_id, section_id, inline_names, position) select $1, $2, jsonb_build_object('es', 'Plato ' || g), g from generate_series(1, 100) g",
        [a, sections[0].id],
      );
      await expectDbError(c, 'insert into public.menu_items (restaurant_id, section_id, inline_names) values ($1, $2, $3)', [a, sections[0].id, json({ es: 'Otro' })], /ITEM_LIMIT/);
      await c.query(
        "insert into public.menus (restaurant_id, kind, names, position) select $1, 'carta', jsonb_build_object('es', 'Carta ' || g), g from generate_series(1, 19) g",
        [a],
      );
      await expectDbError(c, "insert into public.menus (restaurant_id, kind, names) values ($1, 'carta', $2)", [a, json({ es: 'Una más' })], /MENU_LIMIT/);
      await c.query(
        "insert into public.dishes (restaurant_id, names) select $1, jsonb_build_object('es', 'Plato ' || g) from generate_series(1, 500) g",
        [a],
      );
      await expectDbError(c, 'insert into public.dishes (restaurant_id, names) values ($1, $2)', [a, json({ es: 'Uno más' })], /DISH_LIMIT/);
      const { rows: dishes } = await c.query('select id from public.dishes where restaurant_id = $1 limit 1', [a]);
      await c.query(
        "insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents, position) select $1, $2, 'fixed', 100 * g, g from generate_series(1, 4) g",
        [a, dishes[0].id],
      );
      await expectDbError(c, "insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents) values ($1, $2, 'fixed', 100)", [a, dishes[0].id], /PRICE_LIMIT/);
    }));

  it('precios: «según mercado» va solo y sin importe; los demás, con importe de 0 a 99 999,99 €', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const dish = await insertDish(c, a);
      await asSuperuser(c);
      const sql = 'insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents, labels) values ($1, $2, $3, $4, $5)';
      await expectDbError(c, sql, [a, dish, 'market', 1500, json({})], /dish_prices_amount_check/);
      await expectDbError(c, sql, [a, dish, 'fixed', null, json({})], /dish_prices_amount_check/);
      await expectDbError(c, sql, [a, dish, 'per_kg', -1, json({})], /dish_prices_amount_check/);
      await expectDbError(c, sql, [a, dish, 'per_100g', 10000000, json({})], /dish_prices_amount_check/);
      await expectDbError(c, sql, [a, dish, 'fixed', 900, json({ es: 'x'.repeat(41) })], /dish_prices_labels_check/);
      await c.query(sql, [a, dish, 'market', null, json({})]);
      await expectDbError(c, sql, [a, dish, 'fixed', 1200, json({})], /MARKET_PRICE_ALONE/);
      const other = await insertDish(c, a, { name: 'Chuletón', prices: [{ kind: 'fixed', cents: 1200 }, { kind: 'per_kg', cents: 4500 }] });
      await expectDbError(c, sql, [a, other, 'market', null, json({})], /MARKET_PRICE_ALONE/);
      await expectDbError(
        c,
        "update public.dish_prices set kind = 'market', price_cents = null where dish_id = $1 and kind = 'fixed'",
        [other],
        /MARKET_PRICE_ALONE/,
      );
      const lone = await insertDish(c, a, { name: 'Pan' });
      const { rows } = await c.query('select count(*)::int as n from public.dish_prices where dish_id = $1', [lone]);
      expect(rows[0].n).toBe(0);
    }));

  it('etiquetas incompatibles con alérgenos y códigos desconocidos', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await asSuperuser(c);
      const sql = 'insert into public.dishes (restaurant_id, names, allergens, tags) values ($1, $2, $3, $4)';
      const bad: [string[], string[], RegExp][] = [
        [['gluten'], ['gluten_free'], /dishes_tags_allergens_check/],
        [['milk'], ['vegan'], /dishes_tags_allergens_check/],
        [['eggs'], ['vegan'], /dishes_tags_allergens_check/],
        [['fish'], ['vegan'], /dishes_tags_allergens_check/],
        [['crustaceans'], ['vegan'], /dishes_tags_allergens_check/],
        [['molluscs'], ['vegan'], /dishes_tags_allergens_check/],
        [['pollen'], [], /dishes_allergens_check/],
        [[], ['halal'], /dishes_tags_check/],
      ];
      for (const [allergens, tags, pattern] of bad) await expectDbError(c, sql, [a, json({ es: 'Plato' }), allergens, tags], pattern);
      for (const [allergens, tags] of [
        [['nuts', 'soy', 'sesame'], ['vegan', 'spicy']],
        [['milk', 'eggs'], ['vegetarian']],
        [['gluten'], ['new', 'recommended']],
        [[], ['gluten_free', 'vegan']],
      ]) {
        expect((await c.query(sql, [a, json({ es: 'Plato' }), allergens, tags])).rowCount).toBe(1);
      }
      const dish = await insertDish(c, a, { tags: ['gluten_free'] });
      await expectDbError(c, "update public.dishes set allergens = '{gluten}' where id = $1", [dish], /dishes_tags_allergens_check/);
    }));

  it('elementos: un plato o uno escrito a mano, nunca los dos; a mano solo en menús del día y especiales; sin repetir plato en una carta', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const carta = await insertMenu(c, a);
      const entrantes = await insertSection(c, a, carta, 'Entrantes');
      const principales = await insertSection(c, a, carta, 'Principales', 1);
      const daily = await insertMenu(c, a, { kind: 'daily', position: 1 });
      const primeros = await insertSection(c, a, daily, 'Primeros');
      const dish = await insertDish(c, a);
      await asSuperuser(c);
      const sql =
        'insert into public.menu_items (restaurant_id, section_id, dish_id, inline_names, inline_allergens) values ($1, $2, $3, $4, $5)';
      await expectDbError(c, sql, [a, primeros, dish, json({ es: 'Sopa' }), []], /menu_items_kind_check/);
      await expectDbError(c, sql, [a, primeros, null, null, []], /menu_items_kind_check/);
      await expectDbError(c, sql, [a, entrantes, null, json({ es: 'Sopa' }), []], /INLINE_ONLY_DAILY/);
      await expectDbError(c, sql, [a, primeros, dish, null, ['milk']], /menu_items_inline_allergens_only_check/);
      await expectDbError(c, sql, [a, primeros, null, json({ es: 'Sopa' }), ['pollen']], /menu_items_inline_allergens_check/);
      await expectDbError(c, sql, [a, primeros, null, json({ en: 'Soup' }), []], /menu_items_inline_names_check/);
      await c.query(sql, [a, entrantes, dish, null, []]);
      await expectDbError(c, sql, [a, principales, dish, null, []], /menu_items_menu_dish_key/);
      expect((await c.query(sql, [a, primeros, dish, null, []])).rowCount).toBe(1);
      const inline = await c.query(`${sql} returning menu_id`, [a, primeros, null, json({ es: 'Sopa del día' }), ['celery']]);
      expect(inline.rows[0].menu_id).toBe(daily);
    }));

  it('no se mezclan restaurantes: cada pieza solo apunta a piezas de su restaurante', () =>
    tx(async (c) => {
      const { a, b } = await setup(c);
      const menuB = await insertMenu(c, b);
      const sectionB = await insertSection(c, b, menuB);
      const dishB = await insertDish(c, b);
      const menuA = await insertMenu(c, a);
      const sectionA = await insertSection(c, a, menuA);
      const dishA = await insertDish(c, a);
      await asSuperuser(c);
      await expectDbError(c, 'insert into public.menu_sections (restaurant_id, menu_id, names) values ($1, $2, $3)', [a, menuB, json({ es: 'X' })], /foreign key/);
      await expectDbError(c, "insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents) values ($1, $2, 'fixed', 100)", [a, dishB], /foreign key/);
      await expectDbError(c, 'insert into public.menu_items (restaurant_id, section_id, dish_id) values ($1, $2, $3)', [a, sectionA, dishB], /foreign key/);
      await expectDbError(c, 'insert into public.menu_items (restaurant_id, section_id, dish_id) values ($1, $2, $3)', [a, sectionB, dishA], /foreign key/);
    }));

  it('la foto del plato solo puede estar en la carpeta dishes/ de su restaurante', () =>
    tx(async (c) => {
      const { a, b } = await setup(c);
      const dish = await insertDish(c, a);
      await asSuperuser(c);
      for (const path of [`${b}/dishes/abc.webp`, `${a}/gallery/abc.webp`, `${a}/dishes/abc.png`, `${a}/dishes/ABC.webp`, `${a}/dishes/x/abc.webp`]) {
        await expectDbError(c, 'update public.dishes set photo_path = $2 where id = $1', [dish, path], /dishes_photo_path_check/);
      }
      expect((await c.query('update public.dishes set photo_path = $2 where id = $1', [dish, `${a}/dishes/abc-123.webp`])).rowCount).toBe(1);
    }));

  it('borrar un plato lo quita de las cartas; borrar una carta se lleva sus secciones y elementos, pero no los platos', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const menu = await insertMenu(c, a);
      const section = await insertSection(c, a, menu);
      const dish = await insertDish(c, a, { prices: [{ cents: 900 }] });
      const other = await insertDish(c, a, { name: 'Tortilla' });
      await insertItem(c, a, section, { dishId: dish });
      await insertItem(c, a, section, { dishId: other }, 1);
      await c.query('delete from public.dishes where id = $1', [dish]);
      const left = await c.query('select dish_id from public.menu_items where section_id = $1', [section]);
      expect(left.rows).toEqual([{ dish_id: other }]);
      expect((await c.query('select 1 from public.dish_prices where dish_id = $1', [dish])).rowCount).toBe(0);
      await c.query('delete from public.menus where id = $1', [menu]);
      expect((await c.query('select 1 from public.menu_sections where menu_id = $1', [menu])).rowCount).toBe(0);
      expect((await c.query('select 1 from public.menu_items where menu_id = $1', [menu])).rowCount).toBe(0);
      expect((await c.query('select 1 from public.dishes where id = $1', [other])).rowCount).toBe(1);
    }));

  it('el modo de agotados es «strike» por defecto y no se cambia con un UPDATE directo', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await as(c, admin);
      const { rows } = await c.query('select menu_unavailable_mode from public.restaurants where id = $1', [a]);
      expect(rows[0].menu_unavailable_mode).toBe('strike');
      await expectDbError(c, "update public.restaurants set menu_unavailable_mode = 'hide' where id = $1", [a], /permission denied/);
    }));
});
