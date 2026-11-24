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
