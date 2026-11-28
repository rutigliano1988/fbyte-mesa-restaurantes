import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { emailKindsFor, type EmailActor } from '@/lib/email/outbox-rules';
import { RESERVATION_SOURCES, RESERVATION_STATUSES } from '@/lib/reservations/codes';
import {
  addMember,
  as,
  asServiceRole,
  asSuperuser,
  createUser,
  expectDbError,
  fakeTokenHash,
  insertCustomer,
  insertReservation,
  insertRestaurant,
  insertTable,
  insertZone,
  outboxKinds,
  pool,
  setActor,
  setPublishedFields,
  tx,
} from './helpers';

afterAll(() => pool.end());

const NIGHT = '2030-06-14T19:00:00Z';
const KINDS = 'select public.reservation_email_kinds($1, $2, $3, $4, $5, $6, $7)::text[] as k';

async function setup(c: pg.PoolClient) {
  const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
  const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
  await setPublishedFields(c, a, 'hola@resta.es');
  const admin = await createUser(c, 'admin@example.com');
  const staff = await createUser(c, 'sala@example.com');
  const otherAdmin = await createUser(c, 'otro@example.com');
  await addMember(c, a, admin.id, 'admin');
  await addMember(c, a, staff.id, 'staff');
  await addMember(c, b, otherAdmin.id, 'admin');
  const zone = await insertZone(c, a);
  const table = await insertTable(c, a, zone);
  return { a, b, admin, staff, otherAdmin, table };
}

/** Reserva con cliente con email y avisos activados, como la crearía la web. */
async function onlineReservation(c: pg.PoolClient, restaurantId: string, o: { status?: 'pending' | 'confirmed'; email?: string | null; n?: number } = {}) {
  const n = o.n ?? 1;
  const customerId = await insertCustomer(c, restaurantId, {
    phone: `+3461234560${n}`,
    email: o.email === undefined ? `cliente${n}@example.com` : o.email,
  });
  return insertReservation(c, restaurantId, {
    startsAt: NIGHT,
    status: o.status ?? 'confirmed',
    source: 'online',
    customerId,
    notifyCustomer: true,
    tokenHash: fakeTokenHash(n),
  });
}

describe('ajustes y columnas nuevas', () => {
  it('booking_settings trae la reserva online y los avisos activados por defecto, sin email de avisos', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await c.query('insert into public.booking_settings (restaurant_id) values ($1)', [a]);
      const { rows } = await c.query('select online_enabled, notify_restaurant, notification_email from public.booking_settings where restaurant_id = $1', [a]);
      expect(rows[0]).toEqual({ online_enabled: true, notify_restaurant: true, notification_email: null });
    }));

  it('el Administrador cambia los ajustes nuevos; Sala no; el email de avisos tiene que ser válido y en minúsculas', () =>
    tx(async (c) => {
      const { a, admin, staff } = await setup(c);
      await c.query('insert into public.booking_settings (restaurant_id) values ($1)', [a]);
      await as(c, admin);
      const ok = await c.query(
        "update public.booking_settings set online_enabled = false, notify_restaurant = false, notification_email = 'avisos@resta.es' where restaurant_id = $1 returning restaurant_id",
        [a],
      );
      expect(ok.rowCount).toBe(1);
      await expectDbError(c, "update public.booking_settings set notification_email = 'Mal@Resta.es' where restaurant_id = $1", [a], /booking_settings_notification_email_check/);
      await expectDbError(c, "update public.booking_settings set notification_email = 'sin-arroba' where restaurant_id = $1", [a], /booking_settings_notification_email_check/);
      await as(c, staff);
      const denied = await c.query('update public.booking_settings set online_enabled = true where restaurant_id = $1', [a]);
      expect(denied.rowCount).toBe(0);
    }));

  it('una reserva con avisos necesita la huella del enlace, y la huella son 64 hexadecimales', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const customerId = await insertCustomer(c, a);
      await expectDbError(
        c,
        "insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, source, notify_customer) values ($1, $2, 2, $3, $3::timestamptz + interval '90 minutes', 'phone', true)",
        [a, customerId, NIGHT],
        /reservations_notify_check/,
      );
      await expectDbError(
        c,
        "insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, source, manage_token_hash) values ($1, $2, 2, $3, $3::timestamptz + interval '90 minutes', 'phone', 'XYZ')",
        [a, customerId, NIGHT],
        /reservations_manage_token_hash_check/,
      );
      const id = await insertReservation(c, a, { startsAt: NIGHT, customerId, notifyCustomer: true, tokenHash: fakeTokenHash(7) });
      expect(id).toBeTruthy();
    }));
});

describe('privilegios de la cola y del límite de intentos', () => {
  it('los miembros leen la cola de su restaurante; los de otro restaurante y anon, no', () =>
    tx(async (c) => {
      const { a, staff, otherAdmin } = await setup(c);
      const id = await onlineReservation(c, a);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed']);
      await as(c, staff);
      expect((await c.query('select kind from public.email_outbox')).rows).toHaveLength(1);
      await as(c, otherAdmin);
      expect((await c.query('select kind from public.email_outbox')).rows).toHaveLength(0);
      await as(c, null);
      await expectDbError(c, 'select * from public.email_outbox', [], /permission denied/);
    }));

  it('nadie escribe en la cola ni toca el límite de intentos directamente (ni la clave de servicio)', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const id = await onlineReservation(c, a);
      await as(c, admin);
      await expectDbError(c, "insert into public.email_outbox (restaurant_id, reservation_id, kind) values ($1, $2, 'customer_confirmed')", [a, id], /permission denied/);
      await expectDbError(c, "update public.email_outbox set status = 'sent'", [], /permission denied/);
      await expectDbError(c, 'delete from public.email_outbox', [], /permission denied/);
      await expectDbError(c, 'select * from public.rate_limits', [], /permission denied/);
      await asServiceRole(c);
      await expectDbError(c, "insert into public.email_outbox (restaurant_id, reservation_id, kind) values ($1, $2, 'customer_confirmed')", [a, id], /permission denied/);
      await expectDbError(c, "insert into public.rate_limits (key, window_start) values ('x', now())", [], /permission denied/);
    }));

  it('las funciones de encolado no las ejecuta nadie más que el propio trigger', () =>
    tx(async (c) => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const { rows } = await c.query(
          `select has_function_privilege($1, 'public.reservation_email_kinds(text, public.reservation_status, public.reservation_status, boolean, public.reservation_source, text, boolean)', 'execute') as k,
                  has_function_privilege($1, 'public.enqueue_reservation_emails()', 'execute') as e`,
          [role],
        );
        expect(rows[0], role).toEqual({ k: false, e: false });
      }
    }));
});

describe('reglas de encolado (función pura)', () => {
  const cases: [string, unknown[], string[]][] = [
    ['alta online pendiente', ['INSERT', null, 'pending', false, 'online', 'customer', false], ['customer_pending', 'restaurant_request']],
    ['alta online confirmada', ['INSERT', null, 'confirmed', false, 'online', 'customer', false], ['customer_confirmed', 'restaurant_new']],
    ['alta por teléfono (equipo)', ['INSERT', null, 'confirmed', false, 'phone', 'staff', false], ['customer_confirmed']],
    ['walk-in', ['INSERT', null, 'seated', false, 'walk_in', 'staff', false], []],
    ['confirmar una pendiente', ['UPDATE', 'pending', 'confirmed', false, 'online', 'staff', false], ['customer_confirmed']],
    ['rechazar', ['UPDATE', 'pending', 'rejected', false, 'online', 'staff', false], ['customer_rejected']],
    ['cancela el restaurante', ['UPDATE', 'confirmed', 'cancelled_restaurant', false, 'phone', 'staff', false], ['customer_cancelled']],
    ['cancela el cliente desde el panel', ['UPDATE', 'confirmed', 'cancelled_customer', false, 'online', 'staff', false], ['customer_cancelled']],
    ['cancela el comensal con su enlace', ['UPDATE', 'confirmed', 'cancelled_customer', false, 'online', 'customer', false], ['customer_cancelled', 'restaurant_cancelled']],
    ['el panel cambia la hora', ['UPDATE', 'confirmed', 'confirmed', true, 'phone', 'staff', false], ['customer_modified']],
    ['el comensal cambia y queda pendiente', ['UPDATE', 'confirmed', 'pending', true, 'online', 'customer', false], ['customer_modified', 'restaurant_modified']],
    ['deshacer una cancelación', ['UPDATE', 'cancelled_restaurant', 'confirmed', false, 'phone', 'staff', false], ['customer_confirmed']],
    ['deshacer un rechazo de una pendiente', ['UPDATE', 'rejected', 'pending', false, 'online', 'staff', false], []],
    ['deshacer un no-show', ['UPDATE', 'no_show', 'confirmed', false, 'phone', 'staff', false], []],
    ['sentar', ['UPDATE', 'confirmed', 'seated', false, 'online', 'staff', false], []],
    ['cierre automático', ['UPDATE', 'seated', 'completed', false, 'online', 'system', false], []],
    ['cambiar la hora de una que ya está en mesa', ['UPDATE', 'seated', 'seated', true, 'phone', 'staff', false], []],
    ['activar los avisos en una confirmada', ['UPDATE', 'confirmed', 'confirmed', false, 'phone', 'staff', true], ['customer_confirmed']],
    ['solo cambian notas o mesas', ['UPDATE', 'confirmed', 'confirmed', false, 'phone', 'staff', false], []],
  ];
  for (const [name, args, expected] of cases) {
    it(name, () =>
      tx(async (c) => {
        expect((await c.query(KINDS, args)).rows[0].k).toEqual(expected);
      }));
  }
});

describe('las reglas de la app (src/lib/email/outbox-rules.ts) son las mismas que las de la BD', () => {
  it('en todas las combinaciones de alta y cambio', () =>
    tx(async (c) => {
      const { rows } = await c.query<{ op: string; o: string | null; n: string; moved: boolean; src: string; actor: string; notify: boolean; k: string[] }>(
        `select op, o::text, n::text, moved, src::text, actor, notify,
                public.reservation_email_kinds(op, o, n, moved, src, actor, notify)::text[] as k
           from (values ('INSERT'), ('UPDATE')) ops(op)
           cross join (select unnest(enum_range(null::public.reservation_status)) union all select null) olds(o)
           cross join unnest(enum_range(null::public.reservation_status)) news(n)
           cross join (values (false), (true)) m(moved)
           cross join unnest(enum_range(null::public.reservation_source)) s(src)
           cross join (values ('customer'), ('staff'), ('system')) a(actor)
           cross join (values (false), (true)) f(notify)
          where (op = 'INSERT') = (o is null)`,
      );
      expect(rows).toHaveLength(8 * 2 * 3 * 3 * 2 + 8 * 8 * 2 * 3 * 3 * 2);
      expect(RESERVATION_STATUSES).toHaveLength(8);
      expect(RESERVATION_SOURCES).toHaveLength(3);
      for (const r of rows) {
        const ts = emailKindsFor({
          op: r.op as 'INSERT' | 'UPDATE',
          oldStatus: r.o as never,
          newStatus: r.n as never,
          moved: r.moved,
          source: r.src as never,
          actor: r.actor as EmailActor,
          notifySwitchedOn: r.notify,
        });
        expect(ts, JSON.stringify(r)).toEqual(r.k);
      }
    }));
});

describe('encolado con cada alta y cambio (trigger)', () => {
  it('alta online pendiente hecha por el comensal: email al cliente y al restaurante', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await setActor(c, 'customer');
      const id = await onlineReservation(c, a, { status: 'pending' });
      expect(await outboxKinds(c, id)).toEqual(['customer_pending', 'restaurant_request']);
    }));

  it('sin marcar quién lo hace cuenta como el equipo: solo el del cliente', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const id = await onlineReservation(c, a, { status: 'pending' });
      expect(await outboxKinds(c, id)).toEqual(['customer_pending']);
    }));

  it('sin avisos o sin email del cliente no se anota nada para él', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await setActor(c, 'customer');
      const noEmail = await onlineReservation(c, a, { email: null, n: 2 });
      expect(await outboxKinds(c, noEmail)).toEqual(['restaurant_new']);
      const quiet = await insertReservation(c, a, { startsAt: NIGHT, customerId: await insertCustomer(c, a, { phone: '+34600000009', email: 'x@example.com' }) });
      expect(await outboxKinds(c, quiet)).toEqual([]);
    }));

  it('avisos al restaurante: apagados no se anotan; sin email de avisos usa el del local; sin ninguno, nada', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await setActor(c, 'customer');
      await c.query('insert into public.booking_settings (restaurant_id, notify_restaurant) values ($1, false)', [a]);
      expect(await outboxKinds(c, await onlineReservation(c, a, { n: 3 }))).toEqual(['customer_confirmed']);
      await c.query('update public.booking_settings set notify_restaurant = true where restaurant_id = $1', [a]);
      await setActor(c, 'customer');
      expect(await outboxKinds(c, await onlineReservation(c, a, { n: 4, email: 'b@example.com' }))).toEqual(['customer_confirmed', 'restaurant_new']);
      await setPublishedFields(c, a, null);
      await setActor(c, 'customer');
      expect(await outboxKinds(c, await onlineReservation(c, a, { n: 5, email: 'c@example.com' }))).toEqual(['customer_confirmed']);
      await c.query("update public.booking_settings set notification_email = 'avisos@resta.es' where restaurant_id = $1", [a]);
      await setActor(c, 'customer');
      expect(await outboxKinds(c, await onlineReservation(c, a, { n: 6, email: 'd@example.com' }))).toEqual(['customer_confirmed', 'restaurant_new']);
    }));

  it('cambiar hora o personas avisa; cambiar notas, duración o mesas no; los walk-ins nunca', () =>
    tx(async (c) => {
      const { a, table } = await setup(c);
      const id = await onlineReservation(c, a);
      await c.query("update public.reservations set notes = 'Trona', ends_at = ends_at + interval '15 minutes' where id = $1", [id]);
      await c.query('insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)', [id, table, a]);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed']);
      await c.query('update public.reservations set party_size = 3 where id = $1', [id]);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed', 'customer_modified']);
      const walkIn = await insertReservation(c, a, { startsAt: NIGHT, status: 'seated', source: 'walk_in', customerId: null });
      await c.query('update public.reservations set status = $2 where id = $1', [walkIn, 'completed']);
      expect(await outboxKinds(c, walkIn)).toEqual([]);
    }));

  it('activar los avisos en una reserva telefónica ya creada manda la confirmación', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const customerId = await insertCustomer(c, a, { email: 'ana@example.com' });
      const id = await insertReservation(c, a, { startsAt: NIGHT, customerId });
      await c.query('update public.reservations set notify_customer = true, manage_token_hash = $2 where id = $1', [id, fakeTokenHash(9)]);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed']);
    }));

  it('al borrar el restaurante se borra su cola', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      await onlineReservation(c, a);
      await asSuperuser(c);
      await c.query('delete from public.restaurants where id = $1', [a]);
      expect((await c.query('select count(*)::int as n from public.email_outbox')).rows[0].n).toBe(0);
    }));
});
