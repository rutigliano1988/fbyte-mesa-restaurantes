import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getAvailableSlots } from '@/lib/reservations/availability';
import { servicesForDate, type ExceptionConfig, type ServiceConfig } from '@/lib/reservations/day';
import { addDays, zonedTimeToUtc } from '@/lib/reservations/time';
import {
  asServiceRole,
  asSuperuser,
  bookableRestaurant,
  expectDbError,
  fakeTokenHash,
  insertBlockForTable,
  insertCustomer,
  insertReservation,
  insertRestaurant,
  insertTable,
  insertZone,
  localSlot,
  outboxKinds,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

const CREATE = 'select public.create_public_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as r';
const DAY = 'select public.get_public_booking_day($1, $2::date, $3) as d';

type Booking = {
  slug?: string;
  id?: string;
  token?: string;
  party?: number;
  at: string;
  zoneId?: string | null;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string | null;
  locale?: string;
  marketing?: boolean;
};

let seq = 0;
function bookingArgs(b: Booking) {
  seq += 1;
  return [
    b.slug ?? 'online',
    b.id ?? crypto.randomUUID(),
    b.token ?? fakeTokenHash(1000 + seq),
    b.party ?? 2,
    b.at,
    b.zoneId ?? null,
    b.name ?? 'Ana García',
    b.email ?? 'ana@example.com',
    b.phone ?? '+34612345678',
    b.notes === undefined ? 'Trona' : b.notes,
    b.locale ?? 'en',
    b.marketing ?? false,
  ];
}

async function book(c: pg.PoolClient, b: Booking): Promise<{ id: string; status: string; table_ids: string[] }> {
  await asServiceRole(c);
  const r = (await c.query(CREATE, bookingArgs(b))).rows[0].r;
  await asSuperuser(c);
  return r;
}

async function expectBookingError(c: pg.PoolClient, b: Booking, pattern: RegExp) {
  await asServiceRole(c);
  await expectDbError(c, CREATE, bookingArgs(b), pattern);
  await asSuperuser(c);
}

/** «online» con Terraza (posición 0: T1 2–2, T2 2–4) y Sala (posición 1: S1 2–6 que no se reserva online). */
async function setup(c: pg.PoolClient) {
  const a = await bookableRestaurant(c, 'online');
  const terraza = await insertZone(c, a, 'Terraza', 0);
  const sala = await insertZone(c, a, 'Sala', 1);
  const t = {
    T1: await insertTable(c, a, terraza, { name: 'T1', min: 1, max: 2, position: 0 }),
    T2: await insertTable(c, a, terraza, { name: 'T2', min: 2, max: 4, position: 1 }),
    S1: await insertTable(c, a, sala, { name: 'S1', min: 2, max: 6, position: 0, onlineBookable: false }),
  };
  const slot = await localSlot(c, 3, 21 * 60);
  return { a, terraza, sala, t, slot };
}

describe('privilegios', () => {
  const PUBLIC = [
    'public.get_public_booking_day(text, date, text)',
    'public.public_booking_enabled(text)',
    'public.create_public_reservation(text, uuid, text, integer, timestamptz, uuid, text, text, text, text, text, boolean)',
    'public.hit_rate_limit(text, integer, integer)',
  ];
  const HELPERS = [
    'public.booking_settings_of(uuid)',
    'public.day_services(uuid, date)',
    'public.is_bookable_slot(uuid, timestamptz, timestamptz)',
    'public.pick_online_table(uuid, integer, timestamptz, timestamptz, uuid, uuid)',
    'public.upsert_online_customer(uuid, text, text, text, boolean)',
  ];
  it('anon y authenticated no ejecutan ninguna función nueva; service_role solo las públicas', () =>
    tx(async (c) => {
      for (const fn of [...PUBLIC, ...HELPERS]) {
        for (const role of ['anon', 'authenticated']) {
          expect((await c.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0].ok, `${role} ${fn}`).toBe(false);
        }
        expect((await c.query("select has_function_privilege('service_role', $1, 'execute') as ok", [fn])).rows[0].ok, fn).toBe(PUBLIC.includes(fn));
      }
    }));
});

describe('get_public_booking_day', () => {
  it('trae lo necesario para las horas libres y ningún dato personal', () =>
    tx(async (c) => {
      const { a, t, slot } = await setup(c);
      const customerId = await insertCustomer(c, a, { name: 'Ana Secreta', phone: '+34699999999', email: 'secreta@example.com' });
      await insertReservation(c, a, { startsAt: slot.at, tableIds: [t.T2], customerId });
      await c.query("update public.reservations set notes = 'Nota secreta', internal_notes = 'Interna secreta' where restaurant_id = $1", [a]);
      await insertBlockForTable(c, a, t.T1, slot.at, 'Motivo secreto');
      await asServiceRole(c);
      const d = (await c.query(DAY, ['online', slot.date, null])).rows[0].d;
      const text = JSON.stringify(d);
      for (const secret of ['Ana Secreta', '+34699999999', 'secreta@example.com', 'Nota secreta', 'Interna secreta', 'Motivo secreto', customerId]) {
        expect(text).not.toContain(secret);
      }
      expect(Object.keys(d).sort()).toEqual(['blocks', 'exceptions', 'occupancy', 'services', 'settings', 'tables', 'timezone', 'zones']);
      expect(d.timezone).toBe('Europe/Madrid');
      expect(d.settings).toMatchObject({ min_advance_min: 0, max_advance_days: 60, max_online_party: 8, auto_confirm: true });
      expect(d.services).toHaveLength(7);
      // Solo mesas online (S1 no) y zonas con alguna.
      expect(d.tables.map((x: { name: string }) => x.name)).toEqual(['T1', 'T2']);
      expect(d.zones.map((x: { name: string }) => x.name)).toEqual(['Terraza']);
      expect(d.occupancy).toEqual([{ table_id: t.T2, starts_at: expect.any(String), ends_at: expect.any(String) }]);
      expect(d.blocks).toEqual([{ table_id: t.T1, starts_at: expect.any(String), ends_at: expect.any(String) }]);
    }));

  it('al modificar con el token, la propia reserva no ocupa', () =>
    tx(async (c) => {
      const { a, t, slot } = await setup(c);
      await insertReservation(c, a, { startsAt: slot.at, tableIds: [t.T2], notifyCustomer: true, tokenHash: fakeTokenHash(77), customerId: await insertCustomer(c, a, { email: 'x@example.com' }) });
      await asServiceRole(c);
      expect((await c.query(DAY, ['online', slot.date, fakeTokenHash(77)])).rows[0].d.occupancy).toEqual([]);
      expect((await c.query(DAY, ['online', slot.date, fakeTokenHash(78)])).rows[0].d.occupancy).toHaveLength(1);
    }));

  it('null si no existe, no está activo o tiene la reserva online apagada; el botón «Reservar» va igual', () =>
    tx(async (c) => {
      const { a, slot } = await setup(c);
      await insertRestaurant(c, { name: 'En obras', slug: 'en-obras', status: 'setup' });
      const enabled = async (slug: string) => {
        await asServiceRole(c);
        const ok = (await c.query('select public.public_booking_enabled($1) as ok', [slug])).rows[0].ok;
        await asSuperuser(c);
        return ok;
      };
      await asServiceRole(c);
      expect((await c.query(DAY, ['no-existe', slot.date, null])).rows[0].d).toBeNull();
      expect((await c.query(DAY, ['en-obras', slot.date, null])).rows[0].d).toBeNull();
      expect(await enabled('online')).toBe(true);
      expect(await enabled('ONLINE ')).toBe(true);
      expect(await enabled('en-obras')).toBe(false);
      await c.query('update public.tables set online_bookable = false where restaurant_id = $1', [a]);
      expect(await enabled('online')).toBe(false);
      await c.query('update public.tables set online_bookable = true where restaurant_id = $1', [a]);
      await c.query('update public.booking_settings set online_enabled = false where restaurant_id = $1', [a]);
      expect(await enabled('online')).toBe(false);
      await asServiceRole(c);
      expect((await c.query(DAY, ['online', slot.date, null])).rows[0].d).toBeNull();
    }));
});

describe('is_bookable_slot coincide con el módulo de disponibilidad', () => {
  type Scenario = {
    name: string;
    timezone: 'Europe/Madrid' | 'Atlantic/Canary';
    date: string;
    now: string;
    minAdvanceMin: number;
    maxAdvanceDays: number;
    services: Omit<ServiceConfig, 'id'>[];
    exceptions: ExceptionConfig[];
  };
  const night = (weekday: number, start: number, end: number, last: number | null, interval: 15 | 30): Omit<ServiceConfig, 'id'> => ({
    name: 'Noche',
    weekday,
    startMinute: start,
    endMinute: end,
    lastBookingMinute: last,
    slotIntervalMin: interval,
  });
  const scenarios: Scenario[] = [
    {
      name: 'Madrid, noche del adelanto de hora (28/03/2027), con servicio que pasa de medianoche',
      timezone: 'Europe/Madrid',
      date: '2027-03-27',
      now: '2027-03-20T12:00:00Z',
      minAdvanceMin: 0,
      maxAdvanceDays: 365,
      services: [night(6, 1320, 1740, 1680, 30), night(7, 60, 300, 240, 30)],
      exceptions: [],
    },
    {
      name: 'Madrid, noche del atraso de hora (31/10/2027)',
      timezone: 'Europe/Madrid',
      date: '2027-10-30',
      now: '2027-10-20T12:00:00Z',
      minAdvanceMin: 0,
      maxAdvanceDays: 365,
      services: [night(6, 1320, 1740, 1680, 15), night(7, 60, 300, 240, 15)],
      exceptions: [],
    },
    {
      name: 'Canarias, adelanto y atraso de hora',
      timezone: 'Atlantic/Canary',
      date: '2027-03-27',
      now: '2027-03-20T12:00:00Z',
      minAdvanceMin: 0,
      maxAdvanceDays: 365,
      services: [night(6, 1320, 1680, null, 15), night(7, 0, 240, 180, 15)],
      exceptions: [],
    },
    {
      name: 'excepciones (cerrado y horario especial) y antelación mínima y máxima',
      timezone: 'Europe/Madrid',
      date: '2027-06-11',
      now: '2027-06-10T19:10:00Z',
      minAdvanceMin: 120,
      maxAdvanceDays: 2,
      services: [1, 2, 3, 4, 5, 6, 7].map((w) => night(w, 780, 960, null, 30)).concat([night(4, 1200, 1440, 1380, 15)]),
      exceptions: [
        { dateFrom: '2027-06-11', dateTo: '2027-06-11', kind: 'custom', customServices: [{ name: 'Gala', startMinute: 1230, endMinute: 1530 }] },
        { dateFrom: '2027-06-12', dateTo: '2027-06-12', kind: 'closed', customServices: [] },
      ],
    },
  ];

  for (const sc of scenarios) {
    it(sc.name, () =>
      tx(async (c) => {
        const id = await insertRestaurant(c, { name: 'Horas', slug: 'horas', status: 'setup' });
        await c.query('update public.restaurants set timezone = $2 where id = $1', [id, sc.timezone]);
        for (const s of sc.services) {
          await c.query(
            'insert into public.services (restaurant_id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min) values ($1, $2, $3, $4, $5, $6, $7)',
            [id, s.name, s.weekday, s.startMinute, s.endMinute, s.lastBookingMinute, s.slotIntervalMin],
          );
        }
        for (const e of sc.exceptions) {
          await c.query('insert into public.schedule_exceptions (restaurant_id, date_from, date_to, kind, custom_services) values ($1, $2, $3, $4, $5)', [
            id,
            e.dateFrom,
            e.dateTo,
            e.kind,
            JSON.stringify(e.customServices.map((x) => ({ name: x.name, start_minute: x.startMinute, end_minute: x.endMinute }))),
          ]);
        }
        await c.query('insert into public.booking_settings (restaurant_id, min_advance_min, max_advance_days) values ($1, $2, $3)', [
          id,
          sc.minAdvanceMin,
          sc.maxAdvanceDays,
        ]);
        const nowMs = Date.parse(sc.now);
        const from = zonedTimeToUtc(addDays(sc.date, -1), 0, sc.timezone);
        const to = zonedTimeToUtc(addDays(sc.date, 3), 0, sc.timezone);
        const expected = new Set<number>();
        for (let i = -2; i <= 3; i++) {
          const date = addDays(sc.date, i);
          const slots = getAvailableSlots({
            date,
            timeZone: sc.timezone,
            services: servicesForDate(date, sc.services, sc.exceptions),
            partySize: 2,
            durationMin: 90,
            tables: [],
            occupancy: [],
            blocks: [],
            notBeforeMs: nowMs + sc.minAdvanceMin * 60_000,
            notAfterMs: nowMs + sc.maxAdvanceDays * 86_400_000,
          });
          for (const s of slots) if (s.startMs >= from && s.startMs < to) expected.add(s.startMs);
        }
        const { rows } = await c.query<{ t: Date }>(
          "select t from generate_series($2::timestamptz, $3::timestamptz - interval '1 minute', interval '15 minutes') t where public.is_bookable_slot($1, t, $4) order by t",
          [id, new Date(from).toISOString(), new Date(to).toISOString(), sc.now],
        );
        expect(rows.map((r) => r.t.getTime())).toEqual([...expected].sort((x, y) => x - y));
        expect(expected.size).toBeGreaterThan(0);
      }));
  }
});

describe('create_public_reservation', () => {
  it('confirmada en la mesa online más pequeña, con privacidad, idioma, avisos y huella; emails al cliente y al restaurante', () =>
    tx(async (c) => {
      const { t, slot } = await setup(c);
      const id = crypto.randomUUID();
      const r = await book(c, { id, token: fakeTokenHash(5), at: slot.at, locale: 'fr' });
      expect(r).toEqual({ id, status: 'confirmed', table_ids: [t.T1] });
      const { rows } = await c.query('select * from public.reservations where id = $1', [id]);
      expect(rows[0]).toMatchObject({ source: 'online', notify_customer: true, manage_token_hash: fakeTokenHash(5), locale: 'fr', notes: 'Trona', party_size: 2 });
      expect(rows[0].privacy_accepted_at).not.toBeNull();
      expect(rows[0].created_by).toBeNull();
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed', 'restaurant_new']);
    }));

  it('con confirmación manual queda pendiente; por encima del máximo online es una solicitud sin mesa', () =>
    tx(async (c) => {
      const { a, t, slot } = await setup(c);
      await c.query('update public.booking_settings set auto_confirm = false, max_online_party = 4 where restaurant_id = $1', [a]);
      const pending = await book(c, { at: slot.at, party: 1 });
      expect(pending).toMatchObject({ status: 'pending', table_ids: [t.T1] });
      expect(await outboxKinds(c, pending.id)).toEqual(['customer_pending', 'restaurant_request']);
      const group = await book(c, { at: slot.at, party: 12, email: 'grupo@example.com', phone: '+34611111111' });
      expect(group).toMatchObject({ status: 'pending', table_ids: [] });
      expect((await c.query('select count(*)::int as n from public.reservation_tables where reservation_id = $1', [group.id])).rows[0].n).toBe(0);
    }));

  it('solo mesas online y de la zona pedida: si no queda ninguna, SLOT_TAKEN (aunque haya mesas que no son online)', () =>
    tx(async (c) => {
      const { t, terraza, sala, slot } = await setup(c);
      expect(await book(c, { at: slot.at, party: 3, zoneId: terraza })).toMatchObject({ table_ids: [t.T2] });
      await expectBookingError(c, { at: slot.at, party: 3, email: 'otra@example.com', phone: '+34622222222' }, /SLOT_TAKEN/);
      await expectBookingError(c, { at: slot.at, party: 2, zoneId: sala, email: 'otra@example.com', phone: '+34622222222' }, /SLOT_TAKEN/);
      expect(await book(c, { at: slot.at, party: 2, zoneId: terraza, email: 'otra@example.com', phone: '+34622222222' })).toMatchObject({ table_ids: [t.T1] });
    }));

  it('una mesa bloqueada no se ofrece', () =>
    tx(async (c) => {
      const { a, t, slot } = await setup(c);
      await insertBlockForTable(c, a, t.T2, slot.at, null);
      await expectBookingError(c, { at: slot.at, party: 3 }, /SLOT_TAKEN/);
    }));

  it('hora que no se ofrece, fuera de la antelación o restaurante sin reserva online', () =>
    tx(async (c) => {
      const { a, slot } = await setup(c);
      const offGrid = await localSlot(c, 3, 21 * 60 + 5);
      await expectBookingError(c, { at: offGrid.at }, /SLOT_UNAVAILABLE/);
      const tooLate = await localSlot(c, 3, 23 * 60);
      await expectBookingError(c, { at: tooLate.at }, /SLOT_UNAVAILABLE/);
      const far = await localSlot(c, 70, 21 * 60);
      await expectBookingError(c, { at: far.at }, /SLOT_UNAVAILABLE/);
      await expectBookingError(c, { at: new Date(Date.now() - 3_600_000).toISOString() }, /SLOT_UNAVAILABLE/);
      await c.query('update public.booking_settings set online_enabled = false where restaurant_id = $1', [a]);
      await expectBookingError(c, { at: slot.at }, /BOOKING_CLOSED/);
      await expectBookingError(c, { at: slot.at, slug: 'no-existe' }, /BOOKING_CLOSED/);
    }));

  it('datos no válidos: INVALID_INPUT', () =>
    tx(async (c) => {
      const { slot } = await setup(c);
      const other = await bookableRestaurant(c, 'otro');
      const otherZone = await insertZone(c, other);
      for (const bad of [
        { email: 'sin-arroba' },
        { phone: '612345678' },
        { name: '   ' },
        { party: 0 },
        { party: 51 },
        { locale: 'pt' },
        { token: 'XYZ' },
        { zoneId: otherZone },
        { notes: 'x'.repeat(501) },
      ]) {
        await expectBookingError(c, { at: slot.at, ...bad }, /INVALID_INPUT/);
      }
    }));

  it('el cliente online no sobrescribe nombre ni notas; completa el teléfono y solo activa las comunicaciones', () =>
    tx(async (c) => {
      const { a, slot } = await setup(c);
      const existing = await insertCustomer(c, a, { name: 'Ana Ficha', phone: null, email: 'ana@example.com' });
      await c.query("update public.customers set notes = 'Le gusta la terraza', marketing_opt_in = true, marketing_opt_in_at = '2026-01-01' where id = $1", [existing]);
      await book(c, { at: slot.at, name: 'Otro Nombre', email: 'ANA@example.com', phone: '+34655555555', marketing: false });
      const { rows } = await c.query('select name, phone, notes, marketing_opt_in, marketing_opt_in_at from public.customers where id = $1', [existing]);
      expect(rows[0]).toMatchObject({ name: 'Ana Ficha', phone: '+34655555555', notes: 'Le gusta la terraza', marketing_opt_in: true });
      expect(rows[0].marketing_opt_in_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect((await c.query('select count(*)::int as n from public.customers where restaurant_id = $1', [a])).rows[0].n).toBe(1);
    }));

  it('si el teléfono es de otro cliente no se le pone; un cliente nuevo guarda la fecha del consentimiento comercial', () =>
    tx(async (c) => {
      const { a, slot } = await setup(c);
      await insertCustomer(c, a, { name: 'Pepe', phone: '+34677777777', email: null });
      const byEmail = await insertCustomer(c, a, { name: 'Ana', phone: null, email: 'ana@example.com' });
      const r = await book(c, { at: slot.at, email: 'ana@example.com', phone: '+34677777777' });
      expect((await c.query('select customer_id from public.reservations where id = $1', [r.id])).rows[0].customer_id).toBe(byEmail);
      expect((await c.query('select phone from public.customers where id = $1', [byEmail])).rows[0].phone).toBeNull();
      const fresh = await book(c, { at: (await localSlot(c, 4, 21 * 60)).at, email: 'nueva@example.com', phone: '+34688888888', marketing: true });
      const { rows } = await c.query('select c.marketing_opt_in, c.marketing_opt_in_at from public.reservations r join public.customers c on c.id = r.customer_id where r.id = $1', [fresh.id]);
      expect(rows[0].marketing_opt_in).toBe(true);
      expect(rows[0].marketing_opt_in_at).not.toBeNull();
    }));

  it('el mismo id o la misma huella dos veces: INVALID_INPUT', () =>
    tx(async (c) => {
      const { slot } = await setup(c);
      const id = crypto.randomUUID();
      await book(c, { at: slot.at, id, token: fakeTokenHash(1) });
      await expectBookingError(c, { at: slot.at, id, email: 'b@example.com', phone: '+34633333333' }, /INVALID_INPUT/);
      await expectBookingError(c, { at: slot.at, token: fakeTokenHash(1), email: 'b@example.com', phone: '+34633333333' }, /INVALID_INPUT/);
    }));
});

describe('hit_rate_limit', () => {
  it('cuenta los intentos de cada clave en su ventana', () =>
    tx(async (c) => {
      await asServiceRole(c);
      const hit = async (key: string) => (await c.query('select public.hit_rate_limit($1, 3, 600) as ok', [key])).rows[0].ok;
      expect([await hit('book:a:1'), await hit('book:a:1'), await hit('book:a:1'), await hit('book:a:1')]).toEqual([true, true, true, false]);
      expect(await hit('book:a:2')).toBe(true);
      await expectDbError(c, 'select public.hit_rate_limit($1, 3, 600)', [''], /INVALID_INPUT/);
      await asSuperuser(c);
      const { rows } = await c.query("select hits from public.rate_limits where key = 'book:a:1'");
      expect(rows).toEqual([{ hits: 4 }]);
    }));
});
