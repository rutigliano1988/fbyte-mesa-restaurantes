import { afterAll, describe, expect, it } from 'vitest';
import { RESERVED_SLUGS } from '../../src/lib/slug';
import { addMember, as, asSuperuser, createUser, expectDbError, insertRestaurant, pool, tx } from './helpers';

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
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
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

describe('borrados y aislamiento de escritura', () => {
  it('borrar un restaurante con administrador funciona y elimina sus miembros', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await asSuperuser(c);
      const res = await c.query('delete from public.restaurants where id = $1', [a]);
      expect(res.rowCount).toBe(1);
      const m = await c.query('select 1 from public.restaurant_members where restaurant_id = $1', [a]);
      expect(m.rowCount).toBe(0);
    }));

  it('borrar la cuenta del único administrador funciona', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await asSuperuser(c);
      const res = await c.query('delete from auth.users where id = $1', [admin.id]);
      expect(res.rowCount).toBe(1);
    }));

  it('el único administrador no puede borrar su propia pertenencia', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await expectDbError(
        c,
        'delete from public.restaurant_members where restaurant_id = $1 and user_id = $2',
        [a, admin.id],
        /LAST_ADMIN/,
      );
    }));

  it('solo el administrador borra miembros', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      const staff = await createUser(c, 'sala@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');
      await addMember(c, a, staff.id, 'staff');
      const del = 'delete from public.restaurant_members where restaurant_id = $1 and user_id = $2';
      await as(c, staff);
      expect((await c.query(del, [a, manager.id])).rowCount).toBe(0);
      await as(c, manager);
      expect((await c.query(del, [a, staff.id])).rowCount).toBe(0);
      await as(c, admin);
      expect((await c.query(del, [a, staff.id])).rowCount).toBe(1);
    }));

  it('un administrador no escribe en otro restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const ua = await createUser(c, 'ana@example.com');
      const ub = await createUser(c, 'beto@example.com');
      const sb = await createUser(c, 'sala-b@example.com');
      await addMember(c, a, ua.id, 'admin');
      await addMember(c, b, ub.id, 'admin');
      await addMember(c, b, sb.id, 'staff');
      await c.query(
        "insert into public.invitations (restaurant_id, email, role, token_hash) values ($1, 'x@example.com', 'staff', 'dummy-hash')",
        [b],
      );
      await as(c, ua);
      expect((await c.query("update public.restaurants set name = 'Rest X' where id = $1", [b])).rowCount).toBe(0);
      expect(
        (await c.query("update public.restaurant_members set role = 'manager' where restaurant_id = $1 and user_id = $2", [b, sb.id])).rowCount,
      ).toBe(0);
      expect(
        (await c.query('delete from public.restaurant_members where restaurant_id = $1 and user_id = $2', [b, sb.id])).rowCount,
      ).toBe(0);
      expect((await c.query('delete from public.invitations where restaurant_id = $1', [b])).rowCount).toBe(0);
    }));
});

describe('idiomas del restaurante', () => {
  it('rechaza un idioma por defecto desconocido', () =>
    tx(async (c) => {
      await expectDbError(
        c,
        "insert into public.restaurants (name, slug, default_locale, enabled_locales) values ('Rest X', 'rest-x', 'xx', '{es,xx}')",
        [],
        /restaurants_default_locale_check|restaurants_enabled_locales_check/,
      );
    }));

  it('rechaza idiomas activos sin castellano o sin el idioma por defecto', () =>
    tx(async (c) => {
      await expectDbError(
        c,
        "insert into public.restaurants (name, slug, default_locale, enabled_locales) values ('Rest X', 'rest-x', 'en', '{en}')",
        [],
        /restaurants_enabled_locales_es_check/,
      );
      await expectDbError(
        c,
        "insert into public.restaurants (name, slug, default_locale, enabled_locales) values ('Rest X', 'rest-x', 'en', '{es}')",
        [],
        /restaurants_default_locale_enabled_check/,
      );
      await expectDbError(
        c,
        "insert into public.restaurants (name, slug, enabled_locales) values ('Rest X', 'rest-x', '{es,zz}')",
        [],
        /restaurants_enabled_locales_check/,
      );
    }));

  it('acepta una combinación válida', () =>
    tx(async (c) => {
      const res = await c.query(
        "insert into public.restaurants (name, slug, default_locale, enabled_locales) values ('Rest X', 'rest-x', 'ca', '{es,ca,en}')",
      );
      expect(res.rowCount).toBe(1);
    }));
});

describe('invitaciones pendientes únicas', () => {
  it('no puede haber dos invitaciones pendientes para el mismo email y restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const ins = "insert into public.invitations (restaurant_id, email, role, token_hash) values ($1, 'x@example.com', 'staff', $2)";
      await c.query(ins, [a, 'hash-1']);
      await expectDbError(c, ins, [a, 'hash-2'], /invitations_pending_unique/);
      await c.query('update public.invitations set accepted_at = now() where restaurant_id = $1', [a]);
      expect((await c.query(ins, [a, 'hash-3'])).rowCount).toBe(1);
    }));
});

describe('privilegios de funciones (advisors)', () => {
  it('nadie ejecuta directamente las funciones de trigger', () =>
    tx(async (c) => {
      const fns = [
        'public.handle_new_user()',
        'public.protect_last_admin()',
        'public.check_slug_not_reserved()',
        'public.set_updated_at()',
      ];
      for (const role of ['anon', 'authenticated']) {
        for (const fn of fns) {
          const { rows } = await c.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute']);
          expect(rows[0].ok, `${role} → ${fn}`).toBe(false);
        }
      }
    }));

  it('los triggers siguen funcionando para usuarios autenticados', () =>
    tx(async (c) => {
      const u = await createUser(c, 'ana@example.com');
      await as(c, u);
      const res = await c.query("update public.profiles set full_name = 'Ana C' where user_id = $1 returning updated_at", [u.id]);
      expect(res.rowCount).toBe(1);
    }));

  it('las políticas de perfiles usan (select auth.uid())', () =>
    tx(async (c) => {
      const { rows } = await c.query<{ expr: string }>(
        "select coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr from pg_policies where schemaname = 'public' and tablename = 'profiles'",
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const { expr } of rows) {
        const total = expr.match(/auth\.uid\(\)/g)?.length ?? 0;
        const wrapped = expr.match(/SELECT auth\.uid\(\)/g)?.length ?? 0;
        expect(total).toBeGreaterThan(0);
        expect(wrapped).toBe(total);
      }
    }));
});
