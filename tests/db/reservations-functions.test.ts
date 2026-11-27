import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asSuperuser,
  createUser,
  expectDbError,
  insertCustomer,
  insertReservation,
  insertRestaurant,
  insertTable,
  insertZone,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

const NIGHT = '2030-06-14T19:00:00Z';
const CREATE = 'select public.create_panel_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as r';
const UPDATE = 'select public.update_panel_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9) as r';
const STATUS = 'select public.set_reservation_status($1, $2, $3)';
const UNDO = 'select public.undo_reservation_status($1, $2) as status';
const WALK_IN = 'select public.create_walk_in($1, $2, $3, $4, $5) as r';

/** Restaurante A con Terraza (posición 0: T1 2–2, T2 2–4) y Sala (posición 1: S1 2–4, S2 5–8), y B con una mesa. */
async function setup(c: pg.PoolClient) {
  const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
  const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b', status: 'setup' });
  const admin = await createUser(c, 'admin@example.com');
  const staff = await createUser(c, 'sala@example.com');
  const otherAdmin = await createUser(c, 'otro@example.com');
  await addMember(c, a, admin.id, 'admin');
  await addMember(c, a, staff.id, 'staff');
  await addMember(c, b, otherAdmin.id, 'admin');
  const terraza = await insertZone(c, a, 'Terraza', 0);
  const sala = await insertZone(c, a, 'Sala', 1);
  const t = {
    T1: await insertTable(c, a, terraza, { name: 'T1', min: 1, max: 2, position: 0 }),
    T2: await insertTable(c, a, terraza, { name: 'T2', min: 2, max: 4, position: 1 }),
    S1: await insertTable(c, a, sala, { name: 'S1', min: 2, max: 4, position: 0 }),
    S2: await insertTable(c, a, sala, { name: 'S2', min: 5, max: 8, position: 1 }),
    B1: await insertTable(c, b, await insertZone(c, b), { name: 'B1' }),
  };
  return { a, b, admin, staff, otherAdmin, t };
}

type Args = {
  startsAt?: string;
  duration?: number | null;
  party?: number;
  tables?: string[] | null;
  force?: boolean;
  name?: string;
  phone?: string | null;
  email?: string | null;
};

function createArgs(restaurantId: string, o: Args = {}) {
  return [
    restaurantId,
    o.startsAt ?? NIGHT,
    o.duration === undefined ? null : o.duration,
    o.party ?? 2,
    o.tables === undefined ? null : o.tables,
    o.force ?? false,
    o.name ?? 'Ana García',
    o.phone === undefined ? '+34612345678' : o.phone,
    o.email ?? null,
    'Trona para un bebé',
    null,
  ];
}

async function create(c: pg.PoolClient, restaurantId: string, o: Args = {}): Promise<{ id: string; table_ids: string[] }> {
  return (await c.query(CREATE, createArgs(restaurantId, o))).rows[0].r;
}

async function reservation(c: pg.PoolClient, id: string) {
  await asSuperuser(c);
  const { rows } = await c.query(
    `select r.status, r.previous_status, r.source, r.party_size, r.starts_at, r.ends_at, r.notes, r.created_by,
            array(select rt.table_id from public.reservation_tables rt where rt.reservation_id = r.id order by rt.table_id) as table_ids
       from public.reservations r where r.id = $1`,
    [id],
  );
  return rows[0];
}

async function counters(c: pg.PoolClient, customerId: string) {
  await asSuperuser(c);
  const { rows } = await c.query(
    'select visits_count, no_show_count, cancel_count, last_visit_at from public.customers where id = $1',
    [customerId],
  );
  return rows[0];
}

describe('create_panel_reservation', () => {
  it('propone la mesa más pequeña que sirve (desempate por posición) y nace confirmada con su cliente', () =>
    tx(async (c) => {
      const { a, staff, t } = await setup(c);
      await as(c, staff);
      const r = await create(c, a, { party: 2 });
      expect(r.table_ids).toEqual([t.T1]);
      const second = await create(c, a, { party: 2, phone: '+34600000002' });
      expect(second.table_ids).toEqual([t.T2]);
      const third = await create(c, a, { party: 3, phone: '+34600000003' });
      expect(third.table_ids).toEqual([t.S1]);
      const row = await reservation(c, r.id);
      expect(row).toMatchObject({ status: 'confirmed', source: 'phone', party_size: 2, notes: 'Trona para un bebé', created_by: staff.id });
      expect(row.ends_at.getTime() - row.starts_at.getTime()).toBe(90 * 60_000);
      const { rows } = await c.query('select name, phone from public.customers where restaurant_id = $1 order by phone', [a]);
      expect(rows).toEqual([
        { name: 'Ana García', phone: '+34600000002' },
        { name: 'Ana García', phone: '+34600000003' },
        { name: 'Ana García', phone: '+34612345678' },
      ]);
    }));

  it('con mesas elegidas: varias si entre todas hay sitio, y si no, TABLE_TOO_SMALL', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const group = await create(c, a, { party: 10, tables: [t.S2, t.S1, t.S2] });
      expect(group.table_ids).toEqual([t.S1, t.S2].sort());
      await expectDbError(c, CREATE, createArgs(a, { party: 7, tables: [t.T1, t.T2] }), /TABLE_TOO_SMALL/);
      const small = await create(c, a, { party: 1, tables: [t.T2], phone: '+34600000009' });
      expect(small.table_ids).toEqual([t.T2]);
    }));

  it('mesa ocupada → SLOT_TAKEN; sin mesa libre → NO_TABLE_AVAILABLE; bloqueada (mesa o restaurante) → TABLE_BLOCKED', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await insertReservation(c, a, { startsAt: '2030-06-14T18:00:00Z', minutes: 90, tableIds: [t.S2] });
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { party: 6, tables: [t.S2] }), /SLOT_TAKEN/);
      await expectDbError(c, CREATE, createArgs(a, { party: 6 }), /NO_TABLE_AVAILABLE/);
      const after = await create(c, a, { party: 6, startsAt: '2030-06-14T19:30:00Z' });
      expect(after.table_ids).toEqual([t.S2]);
      await asSuperuser(c);
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at) values ($1, $2, '2030-06-15T12:00:00Z', '2030-06-15T16:00:00Z')", [a, t.T1]);
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-15T13:00:00Z', tables: [t.T1] }), /TABLE_BLOCKED/);
      expect((await create(c, a, { startsAt: '2030-06-15T13:00:00Z', party: 2 })).table_ids).toEqual([t.T2]);
      await asSuperuser(c);
      await c.query("insert into public.blocks (restaurant_id, starts_at, ends_at, reason) values ($1, '2030-06-16T12:00:00Z', '2030-06-16T16:00:00Z', 'Evento')", [a]);
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-16T13:00:00Z', tables: [t.S1] }), /TABLE_BLOCKED/);
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-16T13:00:00Z' }), /NO_TABLE_AVAILABLE/);
    }));

  it('forzar: se guarda sin mesa aunque no haya hueco y nunca encima de otra reserva', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      for (const id of Object.values(t).slice(0, 4)) await insertReservation(c, a, { startsAt: NIGHT, tableIds: [id] });
      await as(c, admin);
      const forced = await create(c, a, { party: 4, force: true, tables: [t.S1] });
      expect(forced.table_ids).toEqual([]);
      expect((await reservation(c, forced.id)).table_ids).toEqual([]);
    }));

  it('reconoce al cliente por teléfono o por email, actualiza el nombre y completa lo que falta', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const known = await insertCustomer(c, a, { name: 'Ana', phone: '+34612345678', email: null });
      const byEmail = await insertCustomer(c, a, { name: 'Luis', phone: null, email: 'luis@example.com' });
      await as(c, admin);
      await create(c, a, { name: 'Ana García', email: 'ana@example.com' });
      await create(c, a, { startsAt: '2030-06-15T19:00:00Z', name: 'Luis Pérez', phone: '+34699999999', email: 'luis@example.com' });
      await asSuperuser(c);
      const { rows } = await c.query('select id, name, phone, email from public.customers where restaurant_id = $1 order by name', [a]);
      expect(rows).toEqual([
        { id: known, name: 'Ana García', phone: '+34612345678', email: 'ana@example.com' },
        { id: byEmail, name: 'Luis Pérez', phone: '+34699999999', email: 'luis@example.com' },
      ]);
    }));

  it('duración: la del tramo, la de por defecto o la escrita a mano; datos que no valen → INVALID_INPUT', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await as(c, admin);
      await c.query('insert into public.booking_settings (restaurant_id, default_duration_min, duration_rules) values ($1, 105, $2)', [
        a,
        JSON.stringify([{ min_party: 1, max_party: 2, duration_min: 60 }]),
      ]);
      const minutes = async (id: string) => {
        const row = await reservation(c, id);
        await as(c, admin);
        return (row.ends_at.getTime() - row.starts_at.getTime()) / 60_000;
      };
      expect(await minutes((await create(c, a, { party: 2 })).id)).toBe(60);
      expect(await minutes((await create(c, a, { party: 3, phone: '+34600000003' })).id)).toBe(105);
      expect(await minutes((await create(c, a, { party: 4, duration: 150, phone: '+34600000004' })).id)).toBe(150);
      for (const o of [{ party: 0 }, { party: 51 }, { duration: 20 }, { duration: 735 }, { name: ' ' }, { phone: null }] as Args[]) {
        await expectDbError(c, CREATE, createArgs(a, o), /INVALID_INPUT/);
      }
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-20T19:00:00Z', phone: '612345678' }), /customers_phone_check/);
    }));

  it('sala reserva; otro restaurante, una mesa de otro restaurante o FByte en soporte → FORBIDDEN', () =>
    tx(async (c) => {
      const { a, otherAdmin, admin, t } = await setup(c);
      const fbyte = await createUser(c, 'soporte@fbyte.es', { platformAdmin: true });
      for (const u of [otherAdmin, fbyte]) {
        await as(c, u);
        await expectDbError(c, CREATE, createArgs(a), /FORBIDDEN/);
      }
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { tables: [t.B1] }), /FORBIDDEN/);
      await as(c, null);
      await expectDbError(c, CREATE, createArgs(a), /permission denied/);
    }));
});

describe('create_walk_in', () => {
  it('se sienta ya en la mesa elegida, con o sin nombre', () =>
    tx(async (c) => {
      const { a, staff, t } = await setup(c);
      await as(c, staff);
      const anon = (await c.query(WALK_IN, [a, 2, [t.T2], null, null])).rows[0].r;
      const named = (await c.query(WALK_IN, [a, 4, [t.S1], 60, 'Familia Ruiz'])).rows[0].r;
      const row = await reservation(c, anon.id);
      expect(row).toMatchObject({ status: 'seated', source: 'walk_in', table_ids: [t.T2] });
      expect(Math.abs(row.starts_at.getTime() - Date.now())).toBeLessThan(120_000);
      const { rows } = await c.query('select c.name from public.reservations r join public.customers c on c.id = r.customer_id where r.id = $1', [named.id]);
      expect(rows).toEqual([{ name: 'Familia Ruiz' }]);
      const n = await c.query('select customer_id from public.reservations where id = $1', [anon.id]);
      expect(n.rows[0].customer_id).toBeNull();
      await as(c, staff);
      await expectDbError(c, WALK_IN, [a, 2, [t.T2], null, null], /SLOT_TAKEN/);
      await expectDbError(c, WALK_IN, [a, 2, [], null, null], /INVALID_INPUT/);
    }));
});

describe('update_panel_reservation', () => {
  it('cambia hora, personas y mesas comprobando el hueco sin contar la propia reserva', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const r = await create(c, a, { party: 2, tables: [t.T2] });
      const later = await create(c, a, { startsAt: '2030-06-14T21:00:00Z', party: 2, tables: [t.S1], phone: '+34600000002' });
      await c.query(UPDATE, [a, r.id, '2030-06-14T19:30:00Z', 90, 3, [t.T2], false, 'Cambia a las 21:30', 'Cliente habitual']);
      let row = await reservation(c, r.id);
      expect(row).toMatchObject({ party_size: 3, table_ids: [t.T2], notes: 'Cambia a las 21:30' });
      expect(row.starts_at).toEqual(new Date('2030-06-14T19:30:00Z'));
      await as(c, admin);
      await expectDbError(c, UPDATE, [a, r.id, '2030-06-14T20:00:00Z', 90, 3, [t.S1], false, null, null], /SLOT_TAKEN/);
      await c.query(UPDATE, [a, r.id, '2030-06-14T19:30:00Z', 90, 6, null, false, null, null]);
      row = await reservation(c, r.id);
      expect(row.table_ids).toEqual([t.S2]);
      await as(c, admin);
      await c.query(UPDATE, [a, r.id, '2030-06-14T19:30:00Z', 90, 6, null, true, null, null]);
      expect((await reservation(c, r.id)).table_ids).toEqual([]);
      expect((await reservation(c, later.id)).table_ids).toEqual([t.S1]);
    }));

  it('solo notas: no vuelve a mirar bloqueos ni mesas desactivadas; reservas cerradas → RESERVATION_CLOSED', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const r = await create(c, a, { party: 2, tables: [t.T2] });
      await asSuperuser(c);
      await c.query('update public.tables set active = false where id = $1', [t.T2]);
      await c.query("insert into public.blocks (restaurant_id, starts_at, ends_at) values ($1, $2, $2::timestamptz + interval '3 hours')", [a, NIGHT]);
      await as(c, admin);
      await c.query(UPDATE, [a, r.id, NIGHT, 90, 2, [t.T2], false, 'Mesa junto a la ventana', null]);
      expect((await reservation(c, r.id)).notes).toBe('Mesa junto a la ventana');
      await as(c, admin);
      await expectDbError(c, UPDATE, [a, r.id, NIGHT, 90, 5, [t.T2], false, null, null], /TABLE_TOO_SMALL/);
      await c.query(STATUS, [a, r.id, 'no_show']);
      await expectDbError(c, UPDATE, [a, r.id, NIGHT, 90, 2, [t.T2], false, null, null], /RESERVATION_CLOSED/);
    }));
});

describe('update_panel_reservation: cambiar hora y mesa a la vez', () => {
  // R en T1 a las 19:00, X en T1 a las 21:00 y T2 libre: R pasa a las 21:00 dejando T1.
  const LATE = '2030-06-14T21:00:00Z';
  async function scenario(c: pg.PoolClient) {
    const s = await setup(c);
    await as(c, s.admin);
    const r = await create(c, s.a, { party: 2, tables: [s.t.T1] });
    await insertReservation(c, s.a, { startsAt: LATE, tableIds: [s.t.T1] });
    await as(c, s.admin);
    return { ...s, r };
  }

  it('con las mesas elegidas: la reserva se va a T2 sin falso choque con T1', () =>
    tx(async (c) => {
      const { a, t, r } = await scenario(c);
      await c.query(UPDATE, [a, r.id, LATE, 90, 2, [t.T2], false, null, null]);
      const row = await reservation(c, r.id);
      expect(row.table_ids).toEqual([t.T2]);
      expect(row.starts_at).toEqual(new Date(LATE));
    }));

  it('forzando: se queda sin mesa a la hora nueva', () =>
    tx(async (c) => {
      const { a, r } = await scenario(c);
      await c.query(UPDATE, [a, r.id, LATE, 90, 2, null, true, null, null]);
      const row = await reservation(c, r.id);
      expect(row.table_ids).toEqual([]);
      expect(row.starts_at).toEqual(new Date(LATE));
    }));

  it('con mesa propuesta: la propuesta es T2 y se mueve sin falso choque', () =>
    tx(async (c) => {
      const { a, t, r } = await scenario(c);
      await c.query(UPDATE, [a, r.id, LATE, 90, 2, null, false, null, null]);
      expect((await reservation(c, r.id)).table_ids).toEqual([t.T2]);
    }));

  it('reserva forzada sin mesa: cambiar solo las notas con un array vacío la deja sin mesa y sin error', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      for (const id of [t.T1, t.T2, t.S1, t.S2]) await insertReservation(c, a, { startsAt: NIGHT, tableIds: [id] });
      await as(c, admin);
      const forced = await create(c, a, { party: 2, force: true });
      expect(forced.table_ids).toEqual([]);
      await as(c, admin);
      await c.query(UPDATE, [a, forced.id, NIGHT, 90, 2, [], false, 'Solo notas', null]);
      const row = await reservation(c, forced.id);
      expect(row.table_ids).toEqual([]);
      expect(row.notes).toBe('Solo notas');
    }));
});

describe('bloqueo de mesas fuera del día simple', () => {
  it('una reserva que cruza la medianoche (Madrid) choca con otra a las 00:15 en la misma mesa', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      // 23:30–01:00 hora de Madrid (UTC+2 en junio)
      await create(c, a, { startsAt: '2030-06-14T21:30:00Z', duration: 90, tables: [t.T1] });
      await as(c, admin);
      await expectDbError(
        c,
        CREATE,
        createArgs(a, { startsAt: '2030-06-14T22:15:00Z', duration: 60, tables: [t.T1], phone: '+34600000002' }),
        /SLOT_TAKEN/,
      );
    }));

  it('mover una reserva a otro día funciona y libera la mesa del día anterior', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const r = await create(c, a, { tables: [t.T1] });
      await c.query(UPDATE, [a, r.id, '2030-06-15T19:00:00Z', 90, 2, [t.T1], false, null, null]);
      expect((await reservation(c, r.id)).starts_at).toEqual(new Date('2030-06-15T19:00:00Z'));
      await as(c, admin);
      const again = await create(c, a, { tables: [t.T1], phone: '+34600000002' });
      expect(again.table_ids).toEqual([t.T1]);
    }));
});

describe('estados, contadores y deshacer', () => {
  it('solo deja los cambios de estado permitidos', () =>
    tx(async (c) => {
      const { a, staff } = await setup(c);
      const pending = await insertReservation(c, a, { startsAt: NIGHT, status: 'pending' });
      const confirmed = await insertReservation(c, a, { startsAt: NIGHT });
      await as(c, staff);
      await expectDbError(c, STATUS, [a, pending, 'seated'], /INVALID_TRANSITION/);
      await c.query(STATUS, [a, pending, 'confirmed']);
      await c.query(STATUS, [a, pending, 'seated']);
      await expectDbError(c, STATUS, [a, pending, 'no_show'], /INVALID_TRANSITION/);
      await c.query(STATUS, [a, pending, 'completed']);
      await expectDbError(c, STATUS, [a, pending, 'seated'], /INVALID_TRANSITION/);
      await c.query(STATUS, [a, confirmed, 'cancelled_restaurant']);
      await expectDbError(c, STATUS, [a, confirmed, 'confirmed'], /INVALID_TRANSITION/);
      expect(await reservation(c, pending)).toMatchObject({ status: 'completed', previous_status: 'seated' });
    }));

  it('no-show, cancelación del cliente y visita cuentan en el cliente; deshacer resta', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const customer = await insertCustomer(c, a);
      const r1 = await insertReservation(c, a, { startsAt: '2030-06-10T19:00:00Z', customerId: customer });
      const r2 = await insertReservation(c, a, { startsAt: '2030-06-11T19:00:00Z', customerId: customer });
      const r3 = await insertReservation(c, a, { startsAt: '2030-06-12T19:00:00Z', customerId: customer, status: 'seated' });
      await as(c, admin);
      await c.query(STATUS, [a, r1, 'no_show']);
      await c.query(STATUS, [a, r2, 'cancelled_customer']);
      await c.query(STATUS, [a, r3, 'completed']);
      expect(await counters(c, customer)).toEqual({
        visits_count: 1,
        no_show_count: 1,
        cancel_count: 1,
        last_visit_at: new Date('2030-06-12T19:00:00Z'),
      });
      await as(c, admin);
      expect((await c.query(UNDO, [a, r1])).rows[0].status).toBe('confirmed');
      expect((await c.query(UNDO, [a, r3])).rows[0].status).toBe('seated');
      expect(await counters(c, customer)).toEqual({ visits_count: 0, no_show_count: 0, cancel_count: 1, last_visit_at: null });
      await as(c, admin);
      await expectDbError(c, UNDO, [a, r1], /NOTHING_TO_UNDO/);
      await c.query(STATUS, [a, r1, 'seated']);
      await expectDbError(c, UNDO, [a, r1], /NOTHING_TO_UNDO/);
    }));

  it('deshacer vuelve a mirar que la mesa siga libre y sin bloquear', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const first = await create(c, a, { party: 2, tables: [t.T1] });
      await c.query(STATUS, [a, first.id, 'cancelled_restaurant']);
      await create(c, a, { party: 2, tables: [t.T1], phone: '+34600000002' });
      await expectDbError(c, UNDO, [a, first.id], /SLOT_TAKEN/);
      const other = await create(c, a, { startsAt: '2030-06-15T19:00:00Z', party: 2, tables: [t.T2], phone: '+34600000003' });
      await c.query(STATUS, [a, other.id, 'no_show']);
      await asSuperuser(c);
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at) values ($1, $2, '2030-06-15T18:00:00Z', '2030-06-15T23:00:00Z')", [a, t.T2]);
      await as(c, admin);
      await expectDbError(c, UNDO, [a, other.id], /TABLE_BLOCKED/);
      expect((await reservation(c, first.id)).status).toBe('cancelled_restaurant');
    }));

  it('una reserva de otro restaurante → FORBIDDEN', () =>
    tx(async (c) => {
      const { a, b, admin } = await setup(c);
      const theirs = await insertReservation(c, b, { startsAt: NIGHT });
      await as(c, admin);
      await expectDbError(c, STATUS, [a, theirs, 'seated'], /FORBIDDEN/);
      await expectDbError(c, UNDO, [a, theirs], /FORBIDDEN/);
      await expectDbError(c, UPDATE, [a, theirs, NIGHT, 90, 2, null, false, null, null], /FORBIDDEN/);
      await expectDbError(c, STATUS, [b, theirs, 'seated'], /FORBIDDEN/);
    }));
});

describe('get_booking_day', () => {
  it('devuelve las reservas del rango con cliente y mesas, y lo que ocupa mesas hasta 12 h después', () =>
    tx(async (c) => {
      const { a, staff, otherAdmin, t } = await setup(c);
      const customer = await insertCustomer(c, a, { name: 'Ana', phone: '+34612345678' });
      const inside = await insertReservation(c, a, { startsAt: NIGHT, customerId: customer, tableIds: [t.T1, t.T2], partySize: 5 });
      await insertReservation(c, a, { startsAt: '2030-06-15T09:00:00Z', tableIds: [t.S1] });
      await insertReservation(c, a, { startsAt: '2030-06-14T20:00:00Z', status: 'cancelled_customer', tableIds: [t.S2] });
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at, reason) values ($1, $2, '2030-06-14T12:00:00Z', '2030-06-14T15:00:00Z', 'Obras')", [a, t.S2]);
      await as(c, staff);
      const { rows } = await c.query('select public.get_booking_day($1, $2, $3) as d', [a, '2030-06-14T00:00:00Z', '2030-06-15T04:00:00Z']);
      const day = rows[0].d;
      expect(day.reservations.map((r: { id: string }) => r.id)).toHaveLength(2);
      expect(day.reservations[0]).toMatchObject({
        id: inside,
        party_size: 5,
        status: 'confirmed',
        table_ids: [t.T1, t.T2].sort(),
        customer: { id: customer, name: 'Ana', phone: '+34612345678', tags: [], visits_count: 0, no_show_count: 0, cancel_count: 0 },
      });
      expect(day.occupancy.map((o: { table_id: string }) => o.table_id).sort()).toEqual([t.T1, t.T2, t.S1].sort());
      expect(day.blocks).toEqual([
        expect.objectContaining({ table_id: t.S2, reason: 'Obras' }),
      ]);
      await expectDbError(c, 'select public.get_booking_day($1, $2, $3)', [a, '2030-06-14T00:00:00Z', '2030-06-20T00:00:00Z'], /INVALID_INPUT/);
      await as(c, otherAdmin);
      await expectDbError(c, 'select public.get_booking_day($1, $2, $3)', [a, '2030-06-14T00:00:00Z', '2030-06-15T00:00:00Z'], /FORBIDDEN/);
    }));
});
