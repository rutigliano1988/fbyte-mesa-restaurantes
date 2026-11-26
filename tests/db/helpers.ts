import pg from 'pg';
import { expect } from 'vitest';

export const pool = new pg.Pool({
  connectionString: process.env.PG_TEST_URL ?? 'postgresql://postgres@127.0.0.1:54329/mesa_test',
  max: 4,
});

export type TestUser = { id: string; email: string };
export type Role = 'admin' | 'manager' | 'staff';

/** Ejecuta fn dentro de una transacción que siempre se deshace. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  await c.query('begin');
  try {
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

/** Cambia la identidad de la conexión: un usuario autenticado o anon (null). */
export async function as(c: pg.PoolClient, user: TestUser | null): Promise<void> {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    user ? JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }) : '',
  ]);
  await c.query(user ? 'set local role authenticated' : 'set local role anon');
}

/** Vuelve a superusuario (para preparar datos). */
export async function asSuperuser(c: pg.PoolClient): Promise<void> {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', '', true)");
}

export async function createUser(
  c: pg.PoolClient,
  email: string,
  opts: { fullName?: string; platformAdmin?: boolean } = {},
): Promise<TestUser> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
    [email, { full_name: opts.fullName ?? email.split('@')[0] }],
  );
  if (opts.platformAdmin) {
    await c.query('update public.profiles set is_platform_admin = true where user_id = $1', [rows[0].id]);
  }
  return { id: rows[0].id, email };
}

export async function insertRestaurant(
  c: pg.PoolClient,
  r: { name: string; slug: string; status?: 'setup' | 'active' | 'disabled' },
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into public.restaurants (name, slug, status) values ($1, $2, $3) returning id',
    [r.name, r.slug, r.status ?? 'active'],
  );
  return rows[0].id;
}

export async function addMember(c: pg.PoolClient, restaurantId: string, userId: string, role: Role): Promise<void> {
  await asSuperuser(c);
  await c.query('insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, $3)', [
    restaurantId,
    userId,
    role,
  ]);
}

/** Espera que la consulta falle con un mensaje que encaje con pattern, sin romper la transacción. */
export async function expectDbError(
  c: pg.PoolClient,
  sql: string,
  params: unknown[],
  pattern: RegExp,
): Promise<void> {
  await c.query('savepoint expect_err');
  let error: unknown;
  try {
    await c.query(sql, params);
  } catch (e) {
    error = e;
  }
  await c.query('rollback to savepoint expect_err');
  expect(error, `se esperaba un error ${pattern}`).toBeDefined();
  expect(String((error as Error).message)).toMatch(pattern);
}

/** Deja el restaurante listo para publicar: dirección, contacto, datos fiscales y un servicio. */
export async function makePublishable(c: pg.PoolClient, restaurantId: string): Promise<void> {
  await asSuperuser(c);
  await c.query(
    `update public.restaurants
        set address_line = 'Calle Mayor 1', postal_code = '28013', city = 'Madrid', phone = '910000000',
            legal_name = 'Taberna Pepe SL', tax_id = 'B12345674'
      where id = $1`,
    [restaurantId],
  );
  await c.query(
    "insert into public.services (restaurant_id, name, weekday, start_minute, end_minute) values ($1, 'Comida', 1, 780, 960)",
    [restaurantId],
  );
}

export type MenuKind = 'carta' | 'daily' | 'special';
export type PriceKind = 'fixed' | 'per_kg' | 'per_100g' | 'market';

/** Carta (por defecto) o menú del día/especial con precio, días y, en el especial, fechas por defecto. */
export async function insertMenu(
  c: pg.PoolClient,
  restaurantId: string,
  m: {
    kind?: MenuKind;
    name?: string;
    active?: boolean;
    position?: number;
    priceCents?: number;
    weekdays?: number[];
    startMinute?: number;
    endMinute?: number;
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<string> {
  await asSuperuser(c);
  const kind = m.kind ?? 'carta';
  const scheduled = kind !== 'carta';
  const { rows } = await c.query<{ id: string }>(
    `insert into public.menus (restaurant_id, kind, names, active, position, price_cents, weekdays,
                               start_minute, end_minute, date_from, date_to)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      restaurantId,
      kind,
      JSON.stringify({ es: m.name ?? (scheduled ? 'Menú del día' : 'Carta') }),
      m.active ?? true,
      m.position ?? 0,
      scheduled ? (m.priceCents ?? 1500) : null,
      scheduled ? (m.weekdays ?? [1, 2, 3, 4, 5]) : null,
      m.startMinute ?? null,
      m.endMinute ?? null,
      m.dateFrom ?? (kind === 'special' ? '2026-12-24' : null),
      m.dateTo ?? (kind === 'special' ? '2026-12-24' : null),
    ],
  );
  return rows[0].id;
}

export async function insertSection(
  c: pg.PoolClient,
  restaurantId: string,
  menuId: string,
  name = 'Entrantes',
  position = 0,
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into public.menu_sections (restaurant_id, menu_id, names, position) values ($1, $2, $3, $4) returning id',
    [restaurantId, menuId, JSON.stringify({ es: name }), position],
  );
  return rows[0].id;
}

/** Plato con sus precios (en orden). Sin precios, un plato es válido. */
export async function insertDish(
  c: pg.PoolClient,
  restaurantId: string,
  d: {
    name?: string;
    names?: Record<string, string>;
    descriptions?: Record<string, string>;
    allergens?: string[];
    tags?: string[];
    unavailable?: boolean;
    photoPath?: string;
    prices?: { kind?: PriceKind; cents?: number | null; labels?: Record<string, string> }[];
  } = {},
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    `insert into public.dishes (restaurant_id, names, descriptions, allergens, tags, unavailable, photo_path)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      restaurantId,
      JSON.stringify(d.names ?? { es: d.name ?? 'Croquetas' }),
      JSON.stringify(d.descriptions ?? {}),
      d.allergens ?? [],
      d.tags ?? [],
      d.unavailable ?? false,
      d.photoPath ?? null,
    ],
  );
  for (const [position, p] of (d.prices ?? []).entries()) {
    const kind = p.kind ?? 'fixed';
    await c.query(
      'insert into public.dish_prices (restaurant_id, dish_id, kind, price_cents, labels, position) values ($1, $2, $3, $4, $5, $6)',
      [restaurantId, rows[0].id, kind, kind === 'market' ? null : (p.cents ?? 1000), JSON.stringify(p.labels ?? {}), position],
    );
  }
  return rows[0].id;
}

/** Elemento de una sección: un plato del restaurante o uno escrito a mano (solo en menús del día y especiales). */
export async function insertItem(
  c: pg.PoolClient,
  restaurantId: string,
  sectionId: string,
  item: { dishId: string } | { inlineName: string; inlineAllergens?: string[] },
  position = 0,
): Promise<string> {
  await asSuperuser(c);
  const dishId = 'dishId' in item ? item.dishId : null;
  const inline = 'inlineName' in item ? JSON.stringify({ es: item.inlineName }) : null;
  const allergens = 'inlineName' in item ? (item.inlineAllergens ?? []) : [];
  const { rows } = await c.query<{ id: string }>(
    `insert into public.menu_items (restaurant_id, section_id, dish_id, inline_names, inline_allergens, position)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [restaurantId, sectionId, dishId, inline, allergens, position],
  );
  return rows[0].id;
}
