import { afterAll, beforeAll, expect, it } from 'vitest';
import type pg from 'pg';
import { pool } from './helpers';

// Aquí los datos se confirman de verdad (commit): cada conexión solo ve lo que la otra ya ha confirmado.
// Al acabar se borra el restaurante (en cascada) y el usuario.
const CREATE = 'select public.create_panel_reservation($1, $2, null, $3, $4, false, $5, $6, null, null, null) as r';
let restaurantId = '';
let userId = '';
const tables: Record<'T1' | 'T2', string> = { T1: '', T2: '' };

beforeAll(async () => {
  const c = await pool.connect();
  try {
    restaurantId = (await c.query("insert into public.restaurants (name, slug) values ('Concurrencia', 'concurrencia-4a') returning id")).rows[0].id;
    userId = (await c.query("insert into auth.users (email) values ('concurrencia@example.com') returning id")).rows[0].id;
    await c.query("insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'staff')", [restaurantId, userId]);
    const zone = (await c.query("insert into public.zones (restaurant_id, name) values ($1, 'Sala') returning id", [restaurantId])).rows[0].id;
    for (const [name, max] of [['T1', 2], ['T2', 4]] as const) {
      tables[name] = (
        await c.query('insert into public.tables (restaurant_id, zone_id, name, max_capacity, position) values ($1, $2, $3, $4, $5) returning id', [
          restaurantId,
          zone,
          name,
          max,
          max,
        ])
      ).rows[0].id;
    }
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await pool.query('delete from public.restaurants where id = $1', [restaurantId]);
  await pool.query('delete from auth.users where id = $1', [userId]);
  await pool.end();
});

/** Una conexión con su transacción abierta, como el usuario de Sala. */
async function session(): Promise<pg.PoolClient> {
  const c = await pool.connect();
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  await c.query('set local role authenticated');
  return c;
}

async function close(...clients: pg.PoolClient[]) {
  for (const c of clients) {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

/** La segunda llamada se queda esperando al advisory lock de la primera; la resolvemos cuando la primera confirma. */
async function race(startsAt: string, tableIds: string[] | null, phones: [string, string]) {
  const one = await session();
  const two = await session();
  try {
    const first = (await one.query(CREATE, [restaurantId, startsAt, 2, tableIds, 'Primera', phones[0]])).rows[0].r;
    let settled = false;
    const second = two
      .query(CREATE, [restaurantId, startsAt, 2, tableIds, 'Segunda', phones[1]])
      .then(
        (res) => ({ ok: true as const, r: res.rows[0].r as { table_ids: string[] } }),
        (e: Error) => ({ ok: false as const, message: e.message }),
      )
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const waited = !settled;
    await one.query('commit');
    const result = await second;
    await two.query(result.ok ? 'commit' : 'rollback');
    return { first: first as { table_ids: string[] }, second: result, waited };
  } finally {
    await close(one, two);
  }
}

it('dos altas a la vez en la misma mesa: la segunda espera al bloqueo y da SLOT_TAKEN', async () => {
  const { first, second, waited } = await race('2030-06-14T19:00:00Z', [tables.T1], ['+34600000001', '+34600000002']);
  expect(first.table_ids).toEqual([tables.T1]);
  expect(waited).toBe(true);
  expect(second).toEqual({ ok: false, message: 'SLOT_TAKEN' });
  const { rows } = await pool.query("select count(*)::int as n from public.reservations where restaurant_id = $1 and starts_at = '2030-06-14T19:00:00Z'", [restaurantId]);
  expect(rows[0].n).toBe(1);
});

it('con mesa propuesta, la segunda alta espera y se lleva la siguiente mesa libre', async () => {
  const { first, second, waited } = await race('2030-06-15T19:00:00Z', null, ['+34600000003', '+34600000004']);
  expect(waited).toBe(true);
  expect(first.table_ids).toEqual([tables.T1]);
  expect(second).toEqual({ ok: true, r: expect.objectContaining({ table_ids: [tables.T2] }) });
});
