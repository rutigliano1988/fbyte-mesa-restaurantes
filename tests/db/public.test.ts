import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DPA_VERSION } from '../../src/lib/legal/dpa';
import {
  addMember,
  as,
  asSuperuser,
  createUser,
  expectDbError,
  insertRestaurant,
  makePublishable,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

describe('restaurant_missing_fields y publish_restaurant', () => {
  it('lista lo que falta para publicar', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const staff = await createUser(c, 'sala@example.com');
      await addMember(c, a, staff.id, 'staff');
      await as(c, staff);
      let r = await c.query('select public.restaurant_missing_fields($1) as missing', [a]);
      expect(r.rows[0].missing).toEqual(['address_line', 'postal_code', 'city', 'contact', 'services', 'legal_name', 'tax_id']);
      await makePublishable(c, a);
      await as(c, staff);
      r = await c.query('select public.restaurant_missing_fields($1) as missing', [a]);
      expect(r.rows[0].missing).toEqual([]);
    }));

  it('el email de contacto sirve en lugar del teléfono', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      await makePublishable(c, a);
      await c.query("update public.restaurants set phone = null, contact_email = 'hola@pepe.es' where id = $1", [a]);
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      const r = await c.query('select public.restaurant_missing_fields($1) as missing', [a]);
      expect(r.rows[0].missing).toEqual([]);
    }));

  it('quien no es del restaurante no ve qué le falta', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const other = await createUser(c, 'otro@example.com');
      await as(c, other);
      await expectDbError(c, 'select public.restaurant_missing_fields($1)', [a], /FORBIDDEN/);
    }));

  it('el administrador publica aceptando el contrato y queda auditado', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await makePublishable(c, a);
      await as(c, admin);
      await c.query('select public.publish_restaurant($1, $2)', [a, DPA_VERSION]);
      await asSuperuser(c);
      const { rows } = await c.query(
        `select status, dpa_accepted_by, dpa_version, dpa_accepted_at is not null as accepted,
                published_at is not null as published
           from public.restaurants where id = $1`,
        [a],
      );
      expect(rows[0]).toEqual({ status: 'active', dpa_accepted_by: admin.id, dpa_version: DPA_VERSION, accepted: true, published: true });
      const audit = await c.query('select actor_id, action, details from public.admin_audit_log where restaurant_id = $1', [a]);
      expect(audit.rows).toEqual([{ actor_id: admin.id, action: 'restaurant.publish', details: { dpa_version: DPA_VERSION } }]);
    }));

  it('no publica si falta algo, con otra versión del contrato, sin ser administrador o dos veces', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');
      const sql = 'select public.publish_restaurant($1, $2)';
      await as(c, admin);
      await expectDbError(c, sql, [a, DPA_VERSION], /MISSING_FIELDS/);
      await makePublishable(c, a);
      await as(c, admin);
      await expectDbError(c, sql, [a, 'otra-version'], /DPA_VERSION/);
      await as(c, manager);
      await expectDbError(c, sql, [a, DPA_VERSION], /FORBIDDEN/);
      await as(c, admin);
      await c.query(sql, [a, DPA_VERSION]);
      await expectDbError(c, sql, [a, DPA_VERSION], /ALREADY_PUBLISHED/);
    }));

  it('el administrador de un restaurante desactivado no puede publicar', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'disabled' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await makePublishable(c, a);
      await as(c, admin);
      await expectDbError(c, 'select public.publish_restaurant($1, $2)', [a, DPA_VERSION], /FORBIDDEN/);
    }));

  it('FByte no activa un restaurante sin contrato, pero sí lo desactiva y lo reactiva', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await expectDbError(c, "select public.set_restaurant_status($1, 'active')", [a], /DPA_REQUIRED/);
      await makePublishable(c, a);
      await as(c, admin);
      await c.query('select public.publish_restaurant($1, $2)', [a, DPA_VERSION]);
      await as(c, fbyte);
      await c.query("select public.set_restaurant_status($1, 'disabled')", [a]);
      await c.query("select public.set_restaurant_status($1, 'active')", [a]);
      const { rows } = await c.query('select status from public.restaurants where id = $1', [a]);
      expect(rows[0].status).toBe('active');
    }));
});

describe('datos obligatorios de una web publicada', () => {
  /** Restaurante publicado por su administrador, con todos los datos. */
  async function published(c: pg.PoolClient) {
    const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
    const admin = await createUser(c, 'admin@example.com');
    await addMember(c, a, admin.id, 'admin');
    await makePublishable(c, a);
    await as(c, admin);
    await c.query('select public.publish_restaurant($1, $2)', [a, DPA_VERSION]);
    return { a, admin };
  }

  it('con la web publicada no se puede vaciar un dato legal o de contacto', () =>
    tx(async (c) => {
      const { a, admin } = await published(c);
      await as(c, admin);
      for (const set of [
        'tax_id = null',
        'legal_name = null',
        'address_line = null',
        'postal_code = null',
        'city = null',
        'phone = null, contact_email = null',
      ]) {
        await expectDbError(c, `update public.restaurants set ${set} where id = $1`, [a], /PUBLISHED_FIELDS_REQUIRED/);
      }
    }));

  it('con la web publicada se puede editar manteniendo los datos y cambiar el teléfono por un email', () =>
    tx(async (c) => {
      const { a, admin } = await published(c);
      await as(c, admin);
      const r = await c.query(
        "update public.restaurants set cuisine = 'Vasca', contact_email = 'hola@pepe.es', phone = null where id = $1",
        [a],
      );
      expect(r.rowCount).toBe(1);
    }));

  it('FByte desactiva una web publicada y la vuelve a activar con los datos completos', () =>
    tx(async (c) => {
      const { a } = await published(c);
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await c.query("select public.set_restaurant_status($1, 'disabled')", [a]);
      await c.query("select public.set_restaurant_status($1, 'setup')", [a]);
      await c.query("select public.set_restaurant_status($1, 'active')", [a]);
      const { rows } = await c.query('select status from public.restaurants where id = $1', [a]);
      expect(rows[0].status).toBe('active');
    }));

  it('no se reactiva una web a la que le falta un dato legal', () =>
    tx(async (c) => {
      const { a } = await published(c);
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await c.query("select public.set_restaurant_status($1, 'disabled')", [a]);
      await asSuperuser(c);
      await c.query('update public.restaurants set tax_id = null where id = $1', [a]);
      await as(c, fbyte);
      await expectDbError(c, "select public.set_restaurant_status($1, 'active')", [a], /PUBLISHED_FIELDS_REQUIRED/);
    }));
});

describe('get_public_restaurant', () => {
  /** Restaurante activo con descripción, fotos, un servicio y tres cierres (pasado, próximo y lejano). */
  async function publicRestaurant(c: pg.PoolClient): Promise<string> {
    const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
    await makePublishable(c, a);
    await c.query(
      `update public.restaurants
          set cuisine = 'Mediterránea', price_range = 2, instagram = 'https://www.instagram.com/resta',
              logo_path = $2, dpa_accepted_at = now(), dpa_version = 'x'
        where id = $1`,
      [a, `${a}/logo-abc.webp`],
    );
    await c.query(
      "insert into public.restaurant_translations (restaurant_id, locale, description) values ($1, 'es', 'Hola'), ($1, 'en', 'Hi')",
      [a],
    );
    await c.query('insert into public.restaurant_photos (restaurant_id, path, position) values ($1, $2, 1), ($1, $3, 0)', [
      a,
      `${a}/gallery/b.webp`,
      `${a}/gallery/a.webp`,
    ]);
    const madrid = "(now() at time zone 'Europe/Madrid')::date";
    await c.query(
      `insert into public.schedule_exceptions (restaurant_id, date_from, date_to, kind, note) values
         ($1, ${madrid} - 5, ${madrid} - 1, 'closed', 'Pasado'),
         ($1, ${madrid} + 3, ${madrid} + 4, 'closed', 'Puente'),
         ($1, ${madrid} + 120, ${madrid} + 121, 'closed', 'Lejos')`,
      [a],
    );
    return a;
  }

  it('anon ve los datos públicos de un restaurante activo, y nada más', () =>
    tx(async (c) => {
      const a = await publicRestaurant(c);
      await as(c, null);
      const { rows } = await c.query("select public.get_public_restaurant('rest-a') as data");
      const data = rows[0].data;
      expect(data).toMatchObject({
        id: a,
        slug: 'rest-a',
        name: 'Rest A',
        timezone: 'Europe/Madrid',
        enabled_locales: ['es'],
        cuisine: 'Mediterránea',
        price_range: 2,
        city: 'Madrid',
        phone: '910000000',
        accent_color: '#17317F',
        logo_path: `${a}/logo-abc.webp`,
        legal_name: 'Taberna Pepe SL',
        tax_id: 'B12345674',
        descriptions: { es: 'Hola' },
        photos: [`${a}/gallery/a.webp`, `${a}/gallery/b.webp`],
        services: [{ name: 'Comida', weekday: 1, start_minute: 780, end_minute: 960 }],
      });
      expect(data.exceptions.map((e: { note: string }) => e.note)).toEqual(['Puente']);
      for (const key of ['status', 'dpa_accepted_at', 'dpa_accepted_by', 'dpa_version', 'published_at', 'created_at']) {
        expect(data).not.toHaveProperty(key);
      }
    }));

  it('solo da descripciones de los idiomas activos', () =>
    tx(async (c) => {
      const a = await publicRestaurant(c);
      await as(c, null);
      let { rows } = await c.query("select public.get_public_restaurant('rest-a') as data");
      expect(rows[0].data.descriptions).toEqual({ es: 'Hola' });
      await asSuperuser(c);
      await c.query("update public.restaurants set enabled_locales = '{es,en}' where id = $1", [a]);
      await as(c, null);
      ({ rows } = await c.query("select public.get_public_restaurant('rest-a') as data"));
      expect(rows[0].data.descriptions).toEqual({ es: 'Hola', en: 'Hi' });
    }));

  it('da null para restaurantes en configuración, desactivados o que no existen', () =>
    tx(async (c) => {
      await insertRestaurant(c, { name: 'Rest S', slug: 'rest-s', status: 'setup' });
      await insertRestaurant(c, { name: 'Rest D', slug: 'rest-d', status: 'disabled' });
      await as(c, null);
      for (const slug of ['rest-s', 'rest-d', 'no-existe', '']) {
        const { rows } = await c.query('select public.get_public_restaurant($1) as data', [slug]);
        expect(rows[0].data, slug).toBeNull();
      }
    }));

  it('normaliza mayúsculas y espacios', () =>
    tx(async (c) => {
      await publicRestaurant(c);
      await as(c, null);
      const { rows } = await c.query("select public.get_public_restaurant(' REST-A ') ->> 'slug' as slug");
      expect(rows[0].slug).toBe('rest-a');
    }));

  it('una dirección antigua devuelve la redirección mientras el restaurante esté activo', () =>
    tx(async (c) => {
      const a = await publicRestaurant(c);
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await c.query("select public.change_slug($1, 'rest-a-nuevo')", [a]);
      await as(c, null);
      let r = await c.query("select public.get_public_restaurant('rest-a') as data");
      expect(r.rows[0].data).toEqual({ redirect: 'rest-a-nuevo' });
      await asSuperuser(c);
      await c.query("update public.restaurants set status = 'disabled' where id = $1", [a]);
      await as(c, null);
      r = await c.query("select public.get_public_restaurant('rest-a') as data");
      expect(r.rows[0].data).toBeNull();
    }));

  it('list_public_slugs solo da los restaurantes activos', () =>
    tx(async (c) => {
      await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      await insertRestaurant(c, { name: 'Rest S', slug: 'rest-s', status: 'setup' });
      await as(c, null);
      const { rows } = await c.query('select slug, enabled_locales from public.list_public_slugs()');
      expect(rows).toEqual([{ slug: 'rest-a', enabled_locales: ['es'] }]);
    }));
});

describe('privilegios del Hito 2', () => {
  it('anon solo ejecuta get_invitation, get_public_restaurant y list_public_slugs', () =>
    tx(async (c) => {
      const { rows } = await c.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
      );
      expect(rows.map((r) => r.proname)).toEqual(['get_invitation', 'get_public_restaurant', 'list_public_slugs']);
    }));

  it('anon no toca ninguna tabla nueva', () =>
    tx(async (c) => {
      for (const t of ['restaurant_translations', 'restaurant_photos', 'slug_redirects', 'services', 'schedule_exceptions']) {
        const { rows } = await c.query("select has_table_privilege('anon', $1, 'select, insert, update, delete') as ok", [
          `public.${t}`,
        ]);
        expect(rows[0].ok, t).toBe(false);
      }
    }));

  it('nadie ejecuta directamente los triggers nuevos', () =>
    tx(async (c) => {
      for (const role of ['anon', 'authenticated']) {
        for (const fn of [
          'public.limit_restaurant_photos()',
          'public.check_slug_not_redirected()',
          'public.check_published_fields()',
        ]) {
          const { rows } = await c.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute']);
          expect(rows[0].ok, `${role} → ${fn}`).toBe(false);
        }
      }
    }));
});
