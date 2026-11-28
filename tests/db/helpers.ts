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

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled_customer'
  | 'cancelled_restaurant'
  | 'rejected'
  | 'no_show';

export async function insertZone(c: pg.PoolClient, restaurantId: string, name = 'Sala', position = 0): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into public.zones (restaurant_id, name, position) values ($1, $2, $3) returning id',
    [restaurantId, name, position],
  );
  return rows[0].id;
}

/** Mesa de una zona: por defecto «T1», de 2 a 4 personas, activa y reservable online. */
export async function insertTable(
  c: pg.PoolClient,
  restaurantId: string,
  zoneId: string,
  t: { name?: string; min?: number; max?: number; active?: boolean; onlineBookable?: boolean; position?: number } = {},
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    `insert into public.tables (restaurant_id, zone_id, name, min_capacity, max_capacity, active, online_bookable, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [restaurantId, zoneId, t.name ?? 'T1', t.min ?? 2, t.max ?? 4, t.active ?? true, t.onlineBookable ?? true, t.position ?? 0],
  );
  return rows[0].id;
}

export async function insertCustomer(
  c: pg.PoolClient,
  restaurantId: string,
  cu: { name?: string; phone?: string | null; email?: string | null } = {},
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into public.customers (restaurant_id, name, phone, email) values ($1, $2, $3, $4) returning id',
    [restaurantId, cu.name ?? 'Ana García', cu.phone === undefined ? '+34612345678' : cu.phone, cu.email ?? null],
  );
  return rows[0].id;
}

/** Reserva insertada a mano (sin las funciones del panel), con sus mesas. Por defecto, confirmada, de 90 minutos y para 2. */
export async function insertReservation(
  c: pg.PoolClient,
  restaurantId: string,
  r: {
    startsAt: string;
    minutes?: number;
    partySize?: number;
    status?: ReservationStatus;
    source?: 'online' | 'phone' | 'walk_in';
    customerId?: string | null;
    tableIds?: string[];
    /** Hito 4B: avisos por email al cliente (exige tokenHash). */
    notifyCustomer?: boolean;
    tokenHash?: string | null;
  },
): Promise<string> {
  await asSuperuser(c);
  const customerId = r.customerId === undefined ? await insertCustomer(c, restaurantId, { phone: null }) : r.customerId;
  const { rows } = await c.query<{ id: string }>(
    `insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source,
                                      notify_customer, manage_token_hash)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), $6, $7, $8, $9) returning id`,
    [
      restaurantId,
      customerId,
      r.partySize ?? 2,
      r.startsAt,
      r.minutes ?? 90,
      r.status ?? 'confirmed',
      r.source ?? 'phone',
      r.notifyCustomer ?? false,
      r.tokenHash ?? null,
    ],
  );
  for (const tableId of r.tableIds ?? []) {
    await c.query('insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)', [
      rows[0].id,
      tableId,
      restaurantId,
    ]);
  }
  return rows[0].id;
}

/** Como la clave de servicio (service_role): la que usa la app desde el servidor para el flujo público. */
export async function asServiceRole(c: pg.PoolClient): Promise<void> {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', '', true)");
  await c.query('set local role service_role');
}

/** Marca quién hace el cambio en esta transacción, como las funciones del Hito 4B ('customer', 'staff', 'system'). */
export async function setActor(c: pg.PoolClient, actor: 'customer' | 'staff' | 'system' | null): Promise<void> {
  await c.query("select set_config('mesa.actor', $1, true)", [actor ?? '']);
}

/** Huella de un token de prueba: 64 caracteres hexadecimales distintos para cada n. */
export function fakeTokenHash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

/** Emails anotados en la cola para una reserva, por orden de alta y de tipo: ['customer_pending', 'restaurant_request']. */
export async function outboxKinds(c: pg.PoolClient, reservationId: string): Promise<string[]> {
  await asSuperuser(c);
  const { rows } = await c.query<{ k: string }>(
    'select o.kind::text as k from public.email_outbox o where o.reservation_id = $1 order by o.created_at, o.kind',
    [reservationId],
  );
  return rows.map((r) => r.k);
}

/** Datos de un restaurante publicado (dirección, contacto y datos fiscales), con su email de contacto. */
export async function setPublishedFields(c: pg.PoolClient, restaurantId: string, contactEmail: string | null = 'hola@restaurante.es'): Promise<void> {
  await asSuperuser(c);
  await c.query(
    `update public.restaurants
        set address_line = 'Calle Mayor 1', postal_code = '28013', city = 'Madrid', phone = '910000000',
            contact_email = $2, legal_name = 'Taberna Pepe SL', tax_id = 'B12345674'
      where id = $1`,
    [restaurantId, contactEmail],
  );
}

/** Servicio de un día de la semana (1 = lunes … 7 = domingo); por defecto, cena de 20:00 a 23:30 cada 15 min. */
export async function insertService(
  c: pg.PoolClient,
  restaurantId: string,
  s: { weekday: number; name?: string; start?: number; end?: number; last?: number | null; interval?: 15 | 30 },
): Promise<void> {
  await asSuperuser(c);
  await c.query(
    `insert into public.services (restaurant_id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [restaurantId, s.name ?? 'Cena', s.weekday, s.start ?? 1200, s.end ?? 1410, s.last ?? null, s.interval ?? 15],
  );
}

/**
 * Restaurante listo para la reserva online: publicado (activo, con email de contacto), cena todos los días de 20:00 a
 * 23:30 (última reserva 22:30) y ajustes con antelación mínima de 0 minutos y confirmación automática.
 */
export async function bookableRestaurant(c: pg.PoolClient, slug: string, opts: { timezone?: string } = {}): Promise<string> {
  const id = await insertRestaurant(c, { name: `Rest ${slug}`, slug });
  await setPublishedFields(c, id, `hola@${slug}.es`);
  if (opts.timezone) await c.query('update public.restaurants set timezone = $2 where id = $1', [id, opts.timezone]);
  for (let weekday = 1; weekday <= 7; weekday++) await insertService(c, id, { weekday });
  await c.query('insert into public.booking_settings (restaurant_id, min_advance_min) values ($1, 0)', [id]);
  return id;
}

/** Fecha local (AAAA-MM-DD) dentro de `days` días y el instante de `minute` de ese día, en la zona del restaurante. */
export async function localSlot(c: pg.PoolClient, days: number, minute: number, timeZone = 'Europe/Madrid'): Promise<{ date: string; at: string }> {
  const { rows } = await c.query<{ date: string; at: Date }>(
    `select ((now() at time zone $3)::date + $1::int)::text as date,
            (((now() at time zone $3)::date + $1::int)::timestamp + make_interval(mins => $2::int)) at time zone $3 as at`,
    [days, minute, timeZone],
  );
  return { date: rows[0].date, at: rows[0].at.toISOString() };
}

/** Bloqueo de una mesa (o de todo el restaurante con tableId null) de 3 horas desde startsAt. */
export async function insertBlockForTable(c: pg.PoolClient, restaurantId: string, tableId: string | null, startsAt: string, reason: string | null): Promise<void> {
  await asSuperuser(c);
  await c.query(
    "insert into public.blocks (restaurant_id, table_id, starts_at, ends_at, reason) values ($1, $2, $3::timestamptz, $3::timestamptz + interval '3 hours', $4)",
    [restaurantId, tableId, startsAt, reason],
  );
}
