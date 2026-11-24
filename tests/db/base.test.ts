import { afterAll, describe, expect, it } from 'vitest';
import { RESERVED_SLUGS } from '../../src/lib/slug';
import { addMember, as, createUser, expectDbError, insertRestaurant, pool, tx } from './helpers';

afterAll(() => pool.end());

describe('perfiles', () => {
  it('crea un perfil al registrar un usuario', () =>
    tx(async (c) => {
      const u = await createUser(c, 'ana@example.com', { fullName: 'Ana' });
      const { rows } = await c.query('select full_name, is_platform_admin from public.profiles where user_id = $1', [u.id]);
      expect(rows).toEqual([{ full_name: 'Ana', is_platform_admin: false }]);
    }));

  it('un usuario no puede hacerse superadmin a sí mismo', () =>
    tx(async (c) => {
      const u = await createUser(c, 'ana@example.com');
      await as(c, u);
      await expectDbError(c, 'update public.profiles set is_platform_admin = true where user_id = $1', [u.id], /permission denied/);
    }));

  it('un usuario puede cambiar su propio nombre', () =>
    tx(async (c) => {
      const u = await createUser(c, 'ana@example.com');
      await as(c, u);
      const res = await c.query("update public.profiles set full_name = 'Ana B' where user_id = $1", [u.id]);
      expect(res.rowCount).toBe(1);
    }));
});

describe('aislamiento entre restaurantes', () => {
  it('un miembro solo ve su restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const u = await createUser(c, 'ana@example.com');
      await addMember(c, a, u.id, 'staff');
      await as(c, u);
      const { rows } = await c.query('select slug from public.restaurants order by slug');
      expect(rows).toEqual([{ slug: 'rest-a' }]);
    }));

  it('un miembro no ve el equipo de otro restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const ua = await createUser(c, 'ana@example.com');
      const ub = await createUser(c, 'beto@example.com');
      await addMember(c, a, ua.id, 'admin');
      await addMember(c, b, ub.id, 'admin');
      await as(c, ua);
      const members = await c.query('select restaurant_id from public.restaurant_members');
      expect(members.rows).toEqual([{ restaurant_id: a }]);
      const profiles = await c.query('select user_id from public.profiles');
      expect(profiles.rows).toEqual([{ user_id: ua.id }]);
    }));

  it('anon no puede leer restaurantes', () =>
    tx(async (c) => {
      await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      await as(c, null);
      await expectDbError(c, 'select * from public.restaurants', [], /permission denied/);
    }));

  it('el superadmin ve todos los restaurantes', () =>
    tx(async (c) => {
      await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const admin = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, admin);
      const { rows } = await c.query('select count(*)::int as n from public.restaurants');
      expect(rows[0].n).toBe(2);
    }));

  it('nadie inserta miembros directamente (solo con invitación)', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const u = await createUser(c, 'ana@example.com');
      await addMember(c, a, u.id, 'admin');
      const otro = await createUser(c, 'otro@example.com');
      await as(c, u);
      await expectDbError(
        c,
        "insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'staff')",
        [a, otro.id],
        /permission denied/,
      );
    }));
});

describe('permisos por rol', () => {
  it('sala no puede editar el restaurante; el administrador sí', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const staff = await createUser(c, 'sala@example.com');
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, staff.id, 'staff');
      await addMember(c, a, admin.id, 'admin');
      await as(c, staff);
      expect((await c.query("update public.restaurants set name = 'Rest X' where id = $1", [a])).rowCount).toBe(0);
      await as(c, admin);
      expect((await c.query("update public.restaurants set name = 'Rest X' where id = $1", [a])).rowCount).toBe(1);
    }));

  it('nadie cambia el estado del restaurante con un update directo', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await expectDbError(c, "update public.restaurants set status = 'disabled' where id = $1", [a], /permission denied/);
    }));

  it('solo el administrador cambia roles y no puede quedarse sin administradores', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');

      await as(c, manager);
      const r1 = await c.query("update public.restaurant_members set role = 'admin' where user_id = $1", [manager.id]);
      expect(r1.rowCount).toBe(0);

      await as(c, admin);
      await expectDbError(
        c,
        "update public.restaurant_members set role = 'staff' where restaurant_id = $1 and user_id = $2",
        [a, admin.id],
        /LAST_ADMIN/,
      );
      const r2 = await c.query(
        "update public.restaurant_members set role = 'staff' where restaurant_id = $1 and user_id = $2",
        [a, manager.id],
      );
      expect(r2.rowCount).toBe(1);
    }));

  it('el token de una invitación no se puede leer', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await expectDbError(c, 'select token_hash from public.invitations', [], /permission denied/);
      await c.query('select id, email from public.invitations');
    }));
});

describe('restaurante desactivado', () => {
  it('el miembro sigue viendo el restaurante, pero no sus datos', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'disabled' });
      const u = await createUser(c, 'ana@example.com');
      await addMember(c, a, u.id, 'admin');
      await as(c, u);
      const r = await c.query('select status from public.restaurants');
      expect(r.rows).toEqual([{ status: 'disabled' }]);
      const m = await c.query('select * from public.restaurant_members');
      expect(m.rowCount).toBe(0);
      const mine = await c.query('select id, status, role from public.my_restaurants()');
      expect(mine.rows).toEqual([{ id: a, status: 'disabled', role: 'admin' }]);
    }));
});

describe('slugs', () => {
  it('rechaza slugs reservados y con formato inválido', () =>
    tx(async (c) => {
      await expectDbError(c, "insert into public.restaurants (name, slug) values ('Rest X', 'panel')", [], /SLUG_RESERVED/);
      await expectDbError(c, "insert into public.restaurants (name, slug) values ('Rest X', 'Mal Slug')", [], /restaurants_slug_check/);
    }));

  it('la lista de reservados coincide con la de la app', () =>
    tx(async (c) => {
      const { rows } = await c.query<{ slug: string }>('select slug from public.reserved_slugs order by slug');
      expect(rows.map((r) => r.slug)).toEqual([...RESERVED_SLUGS].sort());
    }));
});
