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

const insZone = 'insert into public.zones (restaurant_id, name, position) values ($1, $2, $3) returning id';
const insTable =
  'insert into public.tables (restaurant_id, zone_id, name, min_capacity, max_capacity) values ($1, $2, $3, $4, $5) returning id';
const NIGHT = '2030-06-14T19:00:00Z';

describe('zonas y mesas', () => {
  it('administrador y encargado las crean y cambian; sala solo las ve', () =>
    tx(async (c) => {
      const { a, manager, staff } = await setup(c);
      await as(c, manager);
      const zone = (await c.query(insZone, [a, 'Terraza', 1])).rows[0].id as string;
      const table = (await c.query(insTable, [a, zone, 'T1', 2, 4])).rows[0].id as string;
      expect((await c.query('update public.tables set max_capacity = 6, active = false where id = $1', [table])).rowCount).toBe(1);
      await as(c, staff);
      expect((await c.query('select name, max_capacity, active from public.tables')).rows).toEqual([
        { name: 'T1', max_capacity: 6, active: false },
      ]);
      await expectDbError(c, insZone, [a, 'Sala', 0], /FORBIDDEN/);
      await expectDbError(c, insTable, [a, zone, 'T2', 2, 4], /FORBIDDEN/);
      expect((await c.query('update public.zones set name = $2 where id = $1', [zone, 'Patio'])).rowCount).toBe(0);
      expect((await c.query('delete from public.tables')).rowCount).toBe(0);
    }));

  it('otro restaurante y anon no ven ni escriben nada', () =>
    tx(async (c) => {
      const { a, b, otherAdmin } = await setup(c);
      const zone = await insertZone(c, a);
      await insertTable(c, a, zone);
      await insertReservation(c, a, { startsAt: NIGHT });
      await as(c, otherAdmin);
      for (const t of ['zones', 'tables', 'customers', 'reservations', 'reservation_tables', 'booking_settings', 'blocks']) {
        expect((await c.query(`select 1 from public.${t}`)).rowCount, t).toBe(0);
      }
      await expectDbError(c, insZone, [a, 'Robada', 0], /FORBIDDEN/);
      await expectDbError(c, insTable, [b, zone, 'T9', 2, 4], /tables_zone_id_restaurant_id_fkey/);
      await as(c, null);
      await expectDbError(c, 'select 1 from public.reservations', [], /permission denied/);
    }));

  it('valida nombres y capacidades; el nombre de la mesa es único en el restaurante sin mirar mayúsculas', () =>
    tx(async (c) => {
      const { a, b, admin } = await setup(c);
      const zone = await insertZone(c, a);
      const zoneB = await insertZone(c, b);
      await insertTable(c, b, zoneB, { name: 'T1' });
      await as(c, admin);
      await expectDbError(c, insZone, [a, ' ', 0], /zones_name_check/);
      await expectDbError(c, insZone, [a, 'x'.repeat(41), 0], /zones_name_check/);
      await expectDbError(c, insZone, [a, 'sala', 0], /zones_name_key/);
      await expectDbError(c, insTable, [a, zone, 'x'.repeat(21), 2, 4], /tables_name_check/);
      await expectDbError(c, insTable, [a, zone, 'T1', 0, 4], /tables_min_capacity_check/);
      await expectDbError(c, insTable, [a, zone, 'T1', 2, 51], /tables_max_capacity_check/);
      await expectDbError(c, insTable, [a, zone, 'T1', 6, 4], /tables_capacity_check/);
      expect((await c.query(insTable, [a, zone, 'T1', 2, 4])).rowCount).toBe(1);
      await expectDbError(c, insTable, [a, zone, ' t1 ', 1, 2], /tables_name_key/);
    }));

  it('como mucho 20 zonas y 100 mesas por restaurante', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await asSuperuser(c);
      await c.query("insert into public.zones (restaurant_id, name) select $1, 'Zona ' || g from generate_series(1, 20) g", [a]);
      const zone = (await c.query('select id from public.zones where restaurant_id = $1 limit 1', [a])).rows[0].id as string;
      await c.query(
        "insert into public.tables (restaurant_id, zone_id, name, max_capacity) select $1, $2, 'M' || g, 4 from generate_series(1, 100) g",
        [a, zone],
      );
      await as(c, admin);
      await expectDbError(c, insZone, [a, 'Una más', 0], /ZONE_LIMIT/);
      await expectDbError(c, insTable, [a, zone, 'Otra', 2, 4], /TABLE_LIMIT/);
    }));

  it('una zona con mesas no se borra; una mesa con reservas futuras tampoco, pero se puede desactivar', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      const zone = await insertZone(c, a);
      const busy = await insertTable(c, a, zone, { name: 'T1' });
      const past = await insertTable(c, a, zone, { name: 'T2' });
      await insertReservation(c, a, { startsAt: NIGHT, tableIds: [busy] });
      await insertReservation(c, a, { startsAt: '2020-01-10T13:00:00Z', status: 'completed', tableIds: [past] });
      await insertReservation(c, a, { startsAt: '2030-07-01T13:00:00Z', status: 'cancelled_customer', tableIds: [past] });
      await as(c, manager);
      await expectDbError(c, 'delete from public.zones where id = $1', [zone], /update or delete on table "zones"/);
      await expectDbError(c, 'delete from public.tables where id = $1', [busy], /TABLE_HAS_RESERVATIONS/);
      expect((await c.query('update public.tables set active = false where id = $1', [busy])).rowCount).toBe(1);
      expect((await c.query('delete from public.tables where id = $1', [past])).rowCount).toBe(1);
    }));

  it('al borrar el restaurante se borra todo lo de reservas', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const zone = await insertZone(c, a);
      const table = await insertTable(c, a, zone);
      await insertReservation(c, a, { startsAt: NIGHT, tableIds: [table] });
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at) values ($1, $2, $3, $3::timestamptz + interval '1 hour')", [a, table, NIGHT]);
      await c.query('delete from public.restaurants where id = $1', [a]);
      for (const t of ['zones', 'tables', 'customers', 'reservations', 'reservation_tables', 'blocks']) {
        expect((await c.query(`select 1 from public.${t} where restaurant_id = $1`, [a])).rowCount, t).toBe(0);
      }
    }));
});

describe('reservas y sus mesas', () => {
  it('una mesa no tiene dos reservas activas que se solapen; canceladas o seguidas, sí', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      await insertReservation(c, a, { startsAt: NIGHT, tableIds: [table] });
      const other = await insertReservation(c, a, { startsAt: '2030-06-14T19:30:00Z' });
      await expectDbError(
        c,
        'insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)',
        [other, table, a],
        /reservation_tables_no_overlap/,
      );
      await insertReservation(c, a, { startsAt: '2030-06-14T19:30:00Z', status: 'cancelled_customer', tableIds: [table] });
      await insertReservation(c, a, { startsAt: '2030-06-14T20:30:00Z', tableIds: [table] });
      const { rows } = await c.query('select count(*)::int as n from public.reservation_tables where table_id = $1', [table]);
      expect(rows[0].n).toBe(3);
    }));

  it('las mesas copian horas y estado de su reserva, también al cambiarla', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      const id = await insertReservation(c, a, { startsAt: NIGHT, minutes: 120, tableIds: [table] });
      const read = async () =>
        (await c.query('select starts_at, ends_at, active from public.reservation_tables where reservation_id = $1', [id])).rows[0];
      expect(await read()).toEqual({ starts_at: new Date(NIGHT), ends_at: new Date('2030-06-14T21:00:00Z'), active: true });
      await c.query("update public.reservations set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour', status = 'no_show' where id = $1", [id]);
      expect(await read()).toEqual({ starts_at: new Date('2030-06-14T20:00:00Z'), ends_at: new Date('2030-06-14T22:00:00Z'), active: false });
    }));

  it('una reserva no lleva mesas ni clientes de otro restaurante, y sin cliente solo puede ser un walk-in', () =>
    tx(async (c) => {
      const { a, b } = await setup(c);
      const tableB = await insertTable(c, b, await insertZone(c, b));
      const customerB = await insertCustomer(c, b);
      const id = await insertReservation(c, a, { startsAt: NIGHT });
      await expectDbError(
        c,
        'insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)',
        [id, tableB, a],
        /reservation_tables_table_id_restaurant_id_fkey/,
      );
      await expectDbError(
        c,
        'insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)',
        [id, tableB, b],
        /FORBIDDEN/,
      );
      await expectDbError(c, 'update public.reservations set customer_id = $2 where id = $1', [id, customerB], /reservations_customer_id_restaurant_id_fkey/);
      await expectDbError(c, 'update public.reservations set customer_id = null where id = $1', [id], /reservations_customer_check/);
      await expectDbError(c, "update public.reservations set ends_at = starts_at where id = $1", [id], /reservations_time_check/);
      await expectDbError(c, "update public.reservations set party_size = 51 where id = $1", [id], /reservations_party_size_check/);
    }));

  it('sala lee reservas y clientes pero no los escribe directamente', () =>
    tx(async (c) => {
      const { a, staff } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      const id = await insertReservation(c, a, { startsAt: NIGHT, tableIds: [table] });
      await as(c, staff);
      expect((await c.query('select id from public.reservations')).rows).toEqual([{ id }]);
      expect((await c.query('select 1 from public.customers')).rowCount).toBe(1);
      await expectDbError(c, "update public.reservations set status = 'seated' where id = $1", [id], /permission denied/);
      await expectDbError(c, "insert into public.customers (restaurant_id, name) values ($1, 'X')", [a], /permission denied/);
      await expectDbError(c, 'delete from public.reservation_tables', [], /permission denied/);
      await expectDbError(
        c,
        "insert into public.blocks (restaurant_id, starts_at, ends_at) values ($1, now(), now() + interval '1 hour')",
        [a],
        /row-level security/,
      );
    }));

  it('FByte en soporte lee pero no escribe', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const fbyte = await createUser(c, 'soporte@fbyte.es', { platformAdmin: true });
      await insertReservation(c, a, { startsAt: NIGHT });
      await as(c, fbyte);
      expect((await c.query('select 1 from public.reservations')).rowCount).toBe(1);
      await expectDbError(c, insZone, [a, 'Sala', 0], /FORBIDDEN/);
    }));
});

describe('ajustes, servicios, clientes y bloqueos', () => {
  it('ajustes de reserva: valores por defecto y tramos de duración válidos', () =>
    tx(async (c) => {
      const { a, b, manager } = await setup(c);
      await as(c, manager);
      const ins = 'insert into public.booking_settings (restaurant_id, duration_rules) values ($1, $2)';
      const rules = (r: unknown) => JSON.stringify(r);
      const bad: unknown[] = [
        { min_party: 1, max_party: 2 },
        [{ min_party: 3, max_party: 2, duration_min: 90 }],
        [{ min_party: 1, max_party: 2, duration_min: 100 }],
        [{ min_party: 1, max_party: 2, duration_min: 15 }],
        [{ min_party: 1, max_party: 60, duration_min: 90 }],
        [{ min_party: 1.5, max_party: 2, duration_min: 90 }],
        [{ min_party: '1', max_party: 2, duration_min: 90 }],
        [{ min_party: 1, max_party: 4, duration_min: 90 }, { min_party: 4, max_party: 6, duration_min: 120 }],
        Array.from({ length: 7 }, (_, i) => ({ min_party: i + 1, max_party: i + 1, duration_min: 90 })),
      ];
      for (const r of bad) await expectDbError(c, ins, [a, rules(r)], /booking_settings_duration_rules_check/);
      await c.query(ins, [a, rules([{ min_party: 1, max_party: 2, duration_min: 75 }, { min_party: 7, max_party: 50, duration_min: 150 }])]);
      const { rows } = await c.query(
        'select default_duration_min, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm from public.booking_settings',
      );
      expect(rows).toEqual([
        { default_duration_min: 90, min_advance_min: 60, max_advance_days: 60, max_online_party: 8, cancel_limit_hours: 2, auto_confirm: true },
      ]);
      await expectDbError(c, 'update public.booking_settings set default_duration_min = 100', [], /booking_settings_default_duration_check/);
      await expectDbError(c, ins, [b, '[]'], /row-level security/);
    }));

  it('servicios: última hora de reserva dentro del servicio e intervalo de 15 o 30', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await as(c, admin);
      const ins =
        'insert into public.services (restaurant_id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min) values ($1, $2, $3, $4, $5, $6, $7)';
      expect((await c.query(ins, [a, 'Cena', 5, 1200, 1470, 1410, 30])).rowCount).toBe(1);
      await expectDbError(c, ins, [a, 'Comida', 1, 780, 960, 960, 15], /services_last_booking_check/);
      await expectDbError(c, ins, [a, 'Comida', 1, 780, 960, 700, 15], /services_last_booking_check/);
      await expectDbError(c, ins, [a, 'Comida', 1, 780, 960, null, 20], /services_slot_interval_check/);
      const { rows } = await c.query(
        "insert into public.services (restaurant_id, name, weekday, start_minute, end_minute) values ($1, 'Comida', 2, 780, 960) returning last_booking_minute, slot_interval_min",
        [a],
      );
      expect(rows[0]).toEqual({ last_booking_minute: null, slot_interval_min: 15 });
      expect((await c.query("update public.services set last_booking_minute = 900, slot_interval_min = 30 where weekday = 2")).rowCount).toBe(1);
    }));

  it('clientes: teléfono E.164 y email en minúsculas, únicos en cada restaurante', () =>
    tx(async (c) => {
      const { a, b } = await setup(c);
      await insertCustomer(c, a, { phone: '+34612345678', email: 'ana@example.com' });
      await insertCustomer(c, b, { phone: '+34612345678', email: 'ana@example.com' });
      const ins = 'insert into public.customers (restaurant_id, name, phone, email) values ($1, $2, $3, $4)';
      await expectDbError(c, ins, [a, 'Otra', '+34612345678', null], /customers_phone_key/);
      await expectDbError(c, ins, [a, 'Otra', null, 'ana@example.com'], /customers_email_key/);
      await expectDbError(c, ins, [a, 'Otra', '612345678', null], /customers_phone_check/);
      await expectDbError(c, ins, [a, 'Otra', null, 'Ana@Example.com'], /customers_email_check/);
      expect((await c.query(ins, [a, 'Sin datos', null, null])).rowCount).toBe(1);
      expect((await c.query(ins, [a, 'Sin datos 2', null, null])).rowCount).toBe(1);
    }));

  it('bloqueos: los crean y borran administrador y encargado, de una mesa o de todo el restaurante', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      await as(c, manager);
      const ins = 'insert into public.blocks (restaurant_id, table_id, starts_at, ends_at, reason) values ($1, $2, $3, $4, $5) returning created_by';
      const { rows } = await c.query(ins, [a, table, NIGHT, '2030-06-14T21:00:00Z', 'Cumpleaños privado']);
      expect(rows[0].created_by).toBe(manager.id);
      expect((await c.query(ins, [a, null, NIGHT, '2030-06-14T21:00:00Z', null])).rowCount).toBe(1);
      await expectDbError(c, ins, [a, null, NIGHT, NIGHT, null], /blocks_time_check/);
      await expectDbError(c, ins, [a, null, NIGHT, '2030-06-14T21:00:00Z', 'x'.repeat(141)], /blocks_reason_check/);
      await expectDbError(
        c,
        'insert into public.blocks (restaurant_id, starts_at, ends_at, created_by) values ($1, $2, $3, $4)',
        [a, NIGHT, '2030-06-14T21:00:00Z', manager.id],
        /permission denied/,
      );
      expect((await c.query('delete from public.blocks')).rowCount).toBe(2);
    }));
});

describe('privilegios del Hito 4A', () => {
  it('anon no toca ninguna tabla nueva ni ejecuta ninguna función nueva', () =>
    tx(async (c) => {
      for (const t of ['zones', 'tables', 'booking_settings', 'customers', 'reservations', 'reservation_tables', 'blocks']) {
        const { rows } = await c.query("select has_table_privilege('anon', $1, 'select, insert, update, delete') as ok", [`public.${t}`]);
        expect(rows[0].ok, t).toBe(false);
      }
      for (const fn of [
        'public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text)',
        'public.create_walk_in(uuid, integer, uuid[], integer, text)',
        'public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text)',
        'public.set_reservation_status(uuid, uuid, public.reservation_status)',
        'public.undo_reservation_status(uuid, uuid)',
        'public.get_booking_day(uuid, timestamptz, timestamptz)',
        'public.valid_duration_rules(jsonb)',
      ]) {
        const { rows } = await c.query("select has_function_privilege('anon', $1, 'execute') as ok", [fn]);
        expect(rows[0].ok, fn).toBe(false);
      }
    }));

  it('nadie ejecuta los triggers ni las funciones auxiliares', () =>
    tx(async (c) => {
      for (const role of ['anon', 'authenticated']) {
        for (const fn of [
          'public.limit_booking_rows()',
          'public.check_table_delete()',
          'public.fill_reservation_table()',
          'public.sync_reservation_tables()',
          'public.update_customer_counters()',
          'public.reservation_duration(uuid, integer)',
          'public.reservation_transition_ok(public.reservation_status, public.reservation_status)',
          'public.lock_reservation_days(uuid, tstzrange[])',
          'public.pick_reservation_table(uuid, integer, timestamptz, timestamptz, uuid)',
          'public.resolve_reservation_tables(uuid, integer, timestamptz, timestamptz, uuid[], boolean, uuid, uuid[])',
          'public.upsert_customer(uuid, text, text, text)',
        ]) {
          const { rows } = await c.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]);
          expect(rows[0].ok, `${role} → ${fn}`).toBe(false);
        }
      }
    }));
});
