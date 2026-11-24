import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { addMember, as, asSuperuser, createUser, expectDbError, insertRestaurant, pool, tx, type TestUser } from './helpers';

afterAll(() => pool.end());

async function createRestaurantAs(c: pg.PoolClient, admin: TestUser, name: string, slug: string, email: string) {
  await as(c, admin);
  const { rows } = await c.query<{ restaurant_id: string; invitation_token: string }>(
    'select * from public.create_restaurant($1, $2, $3)',
    [name, slug, email],
  );
  return { restaurantId: rows[0].restaurant_id, token: rows[0].invitation_token };
}

describe('create_restaurant', () => {
  it('solo FByte puede crear restaurantes', () =>
    tx(async (c) => {
      const u = await createUser(c, 'ana@example.com');
      await as(c, u);
      await expectDbError(c, "select * from public.create_restaurant('Bar', 'bar-ana', 'ana@example.com')", [], /FORBIDDEN/);
    }));

  it('crea el restaurante en configuración, guarda el token hasheado y audita', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { restaurantId, token } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'Pepe@Example.com ');
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      await asSuperuser(c);
      const r = await c.query('select status from public.restaurants where id = $1', [restaurantId]);
      expect(r.rows[0].status).toBe('setup');
      const inv = await c.query('select email, role, token_hash from public.invitations where restaurant_id = $1', [restaurantId]);
      expect(inv.rows[0].email).toBe('pepe@example.com');
      expect(inv.rows[0].role).toBe('admin');
      expect(inv.rows[0].token_hash).not.toBe(token);
      const audit = await c.query('select action from public.admin_audit_log where restaurant_id = $1', [restaurantId]);
      expect(audit.rows).toEqual([{ action: 'restaurant.create' }]);
    }));

  it('rechaza emails no válidos', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await expectDbError(c, "select * from public.create_restaurant('Bar', 'bar-x', 'no-es-email')", [], /INVALID_EMAIL/);
    }));
});

describe('get_invitation y accept_invitation', () => {
  it('anon ve los datos de una invitación válida y si ya tiene cuenta', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { token } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'pepe@example.com');
      await as(c, null);
      let r = await c.query('select restaurant_name, email, role, has_account from public.get_invitation($1)', [token]);
      expect(r.rows).toEqual([{ restaurant_name: 'La Taberna', email: 'pepe@example.com', role: 'admin', has_account: false }]);
      await createUser(c, 'pepe@example.com');
      await as(c, null);
      r = await c.query('select has_account from public.get_invitation($1)', [token]);
      expect(r.rows[0].has_account).toBe(true);
      r = await c.query('select * from public.get_invitation($1)', ['token-falso']);
      expect(r.rowCount).toBe(0);
    }));

  it('acepta con el email correcto y no se puede reutilizar', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { restaurantId, token } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'pepe@example.com');
      const pepe = await createUser(c, 'pepe@example.com');
      await as(c, pepe);
      const r = await c.query<{ accept_invitation: string }>('select public.accept_invitation($1)', [token]);
      expect(r.rows[0].accept_invitation).toBe(restaurantId);
      const mine = await c.query('select role from public.my_restaurants()');
      expect(mine.rows).toEqual([{ role: 'admin' }]);
      await expectDbError(c, 'select public.accept_invitation($1)', [token], /INVALID_INVITATION/);
    }));

  it('rechaza si el email del usuario no coincide', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { token } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'pepe@example.com');
      const intruso = await createUser(c, 'intruso@example.com');
      await as(c, intruso);
      await expectDbError(c, 'select public.accept_invitation($1)', [token], /EMAIL_MISMATCH/);
    }));

  it('una invitación caducada no vale', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { restaurantId, token } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'pepe@example.com');
      await asSuperuser(c);
      await c.query("update public.invitations set expires_at = now() - interval '1 minute' where restaurant_id = $1", [restaurantId]);
      const pepe = await createUser(c, 'pepe@example.com');
      await as(c, pepe);
      expect((await c.query('select * from public.get_invitation($1)', [token])).rowCount).toBe(0);
      await expectDbError(c, 'select public.accept_invitation($1)', [token], /INVALID_INVITATION/);
    }));

  it('sin sesión no se puede aceptar', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { token } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'pepe@example.com');
      await as(c, null);
      await expectDbError(c, 'select public.accept_invitation($1)', [token], /permission denied|NOT_AUTHENTICATED/);
    }));
});

describe('create_invitation', () => {
  it('el administrador invita; sala no puede; no se invita a quien ya es miembro', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      const sala = await createUser(c, 'sala@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, sala.id, 'staff');

      await as(c, admin);
      const r = await c.query<{ create_invitation: string }>("select public.create_invitation($1, 'nuevo@example.com', 'manager')", [a]);
      expect(r.rows[0].create_invitation).toMatch(/^[0-9a-f]{64}$/);
      await expectDbError(c, "select public.create_invitation($1, 'SALA@example.com', 'staff')", [a], /ALREADY_MEMBER/);

      await as(c, sala);
      await expectDbError(c, "select public.create_invitation($1, 'otro@example.com', 'staff')", [a], /FORBIDDEN/);
    }));

  it('reinvitar invalida la invitación anterior', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      const t1 = (await c.query("select public.create_invitation($1, 'nuevo@example.com', 'staff') as t", [a])).rows[0].t;
      const t2 = (await c.query("select public.create_invitation($1, 'nuevo@example.com', 'staff') as t", [a])).rows[0].t;
      expect(t1).not.toBe(t2);
      expect((await c.query('select * from public.get_invitation($1)', [t1])).rowCount).toBe(0);
      expect((await c.query('select * from public.get_invitation($1)', [t2])).rowCount).toBe(1);
    }));
});

describe('set_restaurant_status, log_admin_view y restaurant_team', () => {
  it('solo FByte cambia el estado y queda auditado', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await expectDbError(c, "select public.set_restaurant_status($1, 'disabled')", [a], /FORBIDDEN/);

      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await c.query("select public.set_restaurant_status($1, 'disabled')", [a]);
      await c.query('select public.log_admin_view($1)', [a]);
      await asSuperuser(c);
      const s = await c.query('select status from public.restaurants where id = $1', [a]);
      expect(s.rows[0].status).toBe('disabled');
      const audit = await c.query('select action from public.admin_audit_log where restaurant_id = $1 order by id', [a]);
      expect(audit.rows.map((r) => r.action)).toEqual(['restaurant.status', 'support.view']);
    }));

  it('el equipo se ve con emails solo desde dentro', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com', { fullName: 'Ana Admin' });
      const fuera = await createUser(c, 'fuera@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      const r = await c.query('select full_name, email, role from public.restaurant_team($1)', [a]);
      expect(r.rows).toEqual([{ full_name: 'Ana Admin', email: 'admin@example.com', role: 'admin' }]);
      await as(c, fuera);
      await expectDbError(c, 'select * from public.restaurant_team($1)', [a], /FORBIDDEN/);
    }));
});

describe('refuerzos tras la revisión final', () => {
  it('no se invita en un restaurante desactivado ni en uno que no existe', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'disabled' });
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await expectDbError(c, "select public.create_invitation($1, 'nuevo@example.com', 'admin')", [a], /RESTAURANT_DISABLED/);
      await expectDbError(
        c,
        "select public.create_invitation($1, 'nuevo@example.com', 'admin')",
        ['00000000-0000-4000-8000-000000000000'],
        /NOT_FOUND/,
      );
    }));

  it('un usuario sin permiso recibe FORBIDDEN aunque el restaurante no exista', () =>
    tx(async (c) => {
      const u = await createUser(c, 'ana@example.com');
      await as(c, u);
      await expectDbError(
        c,
        "select public.create_invitation($1, 'nuevo@example.com', 'staff')",
        ['00000000-0000-4000-8000-000000000000'],
        /FORBIDDEN/,
      );
    }));

  it('set_restaurant_status sobre un restaurante que no existe da NOT_FOUND y no audita', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await expectDbError(
        c,
        "select public.set_restaurant_status($1, 'active')",
        ['00000000-0000-4000-8000-000000000000'],
        /NOT_FOUND/,
      );
      await asSuperuser(c);
      const audit = await c.query("select 1 from public.admin_audit_log where action = 'restaurant.status'");
      expect(audit.rowCount).toBe(0);
    }));

  it('FByte al reenviar la invitación de administrador borra todas las pendientes de administrador', () =>
    tx(async (c) => {
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      const { restaurantId, token: t1 } = await createRestaurantAs(c, fbyte, 'La Taberna', 'la-taberna', 'pepe@example.com');
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, restaurantId, admin.id, 'admin');
      await as(c, admin);
      // Una invitación de sala (no se toca) y otra de administrador creada por el propio restaurante.
      await c.query("select public.create_invitation($1, 'sala@example.com', 'staff')", [restaurantId]);
      await c.query("select public.create_invitation($1, 'otro-admin@example.com', 'admin')", [restaurantId]);

      await as(c, fbyte);
      const t2 = (await c.query("select public.create_invitation($1, 'nueva@example.com', 'admin') as t", [restaurantId])).rows[0].t;
      await asSuperuser(c);
      const pending = await c.query(
        'select email, role from public.invitations where restaurant_id = $1 and accepted_at is null order by email',
        [restaurantId],
      );
      expect(pending.rows).toEqual([
        { email: 'nueva@example.com', role: 'admin' },
        { email: 'sala@example.com', role: 'staff' },
      ]);
      await as(c, null);
      expect((await c.query('select * from public.get_invitation($1)', [t1])).rowCount).toBe(0);
      expect((await c.query('select * from public.get_invitation($1)', [t2])).rowCount).toBe(1);
    }));

  it('un administrador del restaurante que invita a otro administrador no borra las demás', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await c.query("select public.create_invitation($1, 'uno@example.com', 'admin')", [a]);
      await c.query("select public.create_invitation($1, 'dos@example.com', 'admin')", [a]);
      await asSuperuser(c);
      const pending = await c.query('select email from public.invitations where restaurant_id = $1 and accepted_at is null order by email', [a]);
      expect(pending.rows).toEqual([{ email: 'dos@example.com' }, { email: 'uno@example.com' }]);
    }));

  it('aceptar una invitación siendo ya miembro no cambia el rol', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      const token = (await c.query("select public.create_invitation($1, 'sala@example.com', 'admin') as t", [a])).rows[0].t;
      // Entre medias, la persona entra al equipo como sala por otra vía.
      const sala = await createUser(c, 'sala@example.com');
      await addMember(c, a, sala.id, 'staff');

      await as(c, sala);
      const r = await c.query<{ accept_invitation: string }>('select public.accept_invitation($1)', [token]);
      expect(r.rows[0].accept_invitation).toBe(a);
      await asSuperuser(c);
      const m = await c.query('select role from public.restaurant_members where restaurant_id = $1 and user_id = $2', [a, sala.id]);
      expect(m.rows).toEqual([{ role: 'staff' }]);
      const inv = await c.query('select accepted_at, accepted_by from public.invitations where restaurant_id = $1', [a]);
      expect(inv.rows[0].accepted_at).not.toBeNull();
      expect(inv.rows[0].accepted_by).toBe(sala.id);
    }));
});

describe('privilegios de ejecución', () => {
  it('authenticated no puede llamar a _new_invitation', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const u = await createUser(c, 'ana@example.com');
      await addMember(c, a, u.id, 'admin');
      await as(c, u);
      await expectDbError(c, "select public._new_invitation($1, 'x@example.com', 'admin')", [a], /permission denied/);
    }));

  const ANON_FORBIDDEN = [
    'public.create_restaurant(text, text, text)',
    'public.create_invitation(uuid, text, public.member_role)',
    'public.accept_invitation(text)',
    'public.set_restaurant_status(uuid, public.restaurant_status)',
    'public.log_admin_view(uuid)',
    'public.restaurant_team(uuid)',
    'public.my_restaurants()',
    'public._new_invitation(uuid, text, public.member_role)',
  ];

  it.each(ANON_FORBIDDEN)('anon no puede ejecutar %s', (fn) =>
    tx(async (c) => {
      const { rows } = await c.query("select has_function_privilege('anon', $1, 'execute') as ok", [fn]);
      expect(rows[0].ok).toBe(false);
    }));

  it('anon sí puede ejecutar get_invitation, y una llamada real a create_restaurant falla', () =>
    tx(async (c) => {
      const { rows } = await c.query("select has_function_privilege('anon', 'public.get_invitation(text)', 'execute') as ok");
      expect(rows[0].ok).toBe(true);
      await as(c, null);
      await c.query("select * from public.get_invitation('nada')");
      await expectDbError(c, "select * from public.create_restaurant('Bar', 'bar-x', 'x@example.com')", [], /permission denied/);
      await expectDbError(c, 'select * from public.my_restaurants()', [], /permission denied/);
    }));
});
