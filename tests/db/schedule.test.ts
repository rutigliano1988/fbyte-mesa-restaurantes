import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { addMember, as, createUser, expectDbError, insertRestaurant, pool, tx, type Role, type TestUser } from './helpers';

afterAll(() => pool.end());

const insService =
  'insert into public.services (restaurant_id, name, weekday, start_minute, end_minute) values ($1, $2, $3, $4, $5)';
const insException =
  'insert into public.schedule_exceptions (restaurant_id, date_from, date_to, kind, custom_services, note) values ($1, $2, $3, $4, $5, $6)';

async function restaurantWith(c: pg.PoolClient, role: Role): Promise<{ id: string; user: TestUser }> {
  const id = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
  const user = await createUser(c, `${role}@example.com`);
  await addMember(c, id, user.id, role);
  await as(c, user);
  return { id, user };
}

describe('servicios', () => {
  it('administrador y encargado los crean; sala solo los ve', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'manager');
      expect((await c.query(insService, [id, 'Comida', 1, 780, 960])).rowCount).toBe(1);
      const staff = await createUser(c, 'sala@example.com');
      await addMember(c, id, staff.id, 'staff');
      await as(c, staff);
      expect((await c.query('select name from public.services')).rows).toEqual([{ name: 'Comida' }]);
      await expectDbError(c, insService, [id, 'Cena', 1, 1200, 1410], /row-level security/);
      expect((await c.query('delete from public.services')).rowCount).toBe(0);
    }));

  it('acepta cenas que pasan de medianoche y rechaza rangos imposibles', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'admin');
      expect((await c.query(insService, [id, 'Cena', 5, 1200, 1470])).rowCount).toBe(1);
      await expectDbError(c, insService, [id, 'X', 2, 600, 600], /services_range_check/);
      await expectDbError(c, insService, [id, 'X', 2, 1300, 1900], /services_range_check/);
      await expectDbError(c, insService, [id, 'X', 0, 600, 700], /services_weekday_check/);
      await expectDbError(c, insService, [id, 'X', 8, 600, 700], /services_weekday_check/);
      await expectDbError(c, insService, [id, 'X', 2, 1440, 1500], /services_start_minute_check/);
      await expectDbError(c, insService, [id, ' ', 2, 600, 700], /services_name_check/);
    }));

  it('no deja solapar servicios del mismo día, pero sí que se toquen', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'admin');
      await c.query(insService, [id, 'Comida', 1, 780, 960]);
      await expectDbError(c, insService, [id, 'Merienda', 1, 900, 1000], /services_no_overlap/);
      expect((await c.query(insService, [id, 'Merienda', 1, 960, 1080])).rowCount).toBe(1);
      expect((await c.query(insService, [id, 'Comida', 2, 780, 960])).rowCount).toBe(1);
    }));

  it('un encargado de A no escribe en B', () =>
    tx(async (c) => {
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      await restaurantWith(c, 'manager');
      await expectDbError(c, insService, [b, 'Comida', 1, 780, 960], /row-level security/);
    }));
});

describe('cierres y días especiales', () => {
  it('guarda un cierre por rango y un día especial con sus servicios', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'manager');
      expect((await c.query(insException, [id, '2026-12-24', '2026-12-26', 'closed', '[]', 'Navidad'])).rowCount).toBe(1);
      const special = JSON.stringify([{ name: 'Cena', start_minute: 1200, end_minute: 1560 }]);
      expect((await c.query(insException, [id, '2026-12-31', '2026-12-31', 'custom', special, null])).rowCount).toBe(1);
    }));

  it('valida fechas y servicios especiales', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'admin');
      const cena = { name: 'Cena', start_minute: 1200, end_minute: 1400 };
      const cases: [unknown[], RegExp][] = [
        [['2026-12-26', '2026-12-24', 'closed', '[]', null], /schedule_exceptions_dates_check/],
        [['2026-01-01', '2027-06-01', 'closed', '[]', null], /schedule_exceptions_dates_check/],
        [['2026-12-24', '2026-12-24', 'closed', JSON.stringify([cena]), null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'custom', '[]', null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'custom', JSON.stringify([{ name: 'X', start_minute: 'abc', end_minute: 1300 }]), null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'custom', JSON.stringify([{ ...cena, end_minute: 1900 }]), null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'custom', JSON.stringify([{ ...cena, start_minute: 600.5 }]), null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'custom', JSON.stringify(Array(7).fill(cena)), null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'custom', JSON.stringify({ cena }), null], /schedule_exceptions_services_check/],
        [['2026-12-24', '2026-12-24', 'closed', '[]', 'x'.repeat(141)], /schedule_exceptions_note_check/],
      ];
      for (const [values, pattern] of cases) await expectDbError(c, insException, [id, ...values], pattern);
    }));

  it('no deja solapar fechas de cierres', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'admin');
      await c.query(insException, [id, '2026-12-24', '2026-12-26', 'closed', '[]', null]);
      await expectDbError(c, insException, [id, '2026-12-26', '2026-12-28', 'closed', '[]', null], /schedule_exceptions_no_overlap/);
      expect((await c.query(insException, [id, '2026-12-27', '2026-12-28', 'closed', '[]', null])).rowCount).toBe(1);
    }));

  it('sala no crea cierres', () =>
    tx(async (c) => {
      const { id } = await restaurantWith(c, 'staff');
      await expectDbError(c, insException, [id, '2026-12-24', '2026-12-24', 'closed', '[]', null], /row-level security/);
    }));
});
