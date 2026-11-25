import { afterAll, describe, expect, it } from 'vitest';
import { addMember, as, asSuperuser, createUser, expectDbError, insertRestaurant, pool, tx } from './helpers';

afterAll(() => pool.end());

describe('ficha del restaurante', () => {
  it('el administrador edita los datos nuevos; encargado y sala no', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      const staff = await createUser(c, 'sala@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');
      await addMember(c, a, staff.id, 'staff');
      const sql = "update public.restaurants set cuisine = 'Mediterránea', price_range = 2, city = 'Madrid' where id = $1";
      for (const u of [manager, staff]) {
        await as(c, u);
        expect((await c.query(sql, [a])).rowCount).toBe(0);
      }
      await as(c, admin);
      expect((await c.query(sql, [a])).rowCount).toBe(1);
    }));

  it('nadie cambia slug, publicación ni contrato con un update directo', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      for (const set of ["slug = 'otro-slug'", 'published_at = now()', 'dpa_accepted_at = now()', "dpa_version = 'x'"]) {
        await expectDbError(c, `update public.restaurants set ${set} where id = $1`, [a], /permission denied/);
      }
    }));

  it('valida los formatos de los datos públicos y fiscales', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      await asSuperuser(c);
      const bad: [string, RegExp][] = [
        ["postal_code = '53000'", /restaurants_postal_code_check/],
        ["postal_code = '2801'", /restaurants_postal_code_check/],
        ["tax_id = 'b12345674'", /restaurants_tax_id_check/],
        ["tax_id = '1234567'", /restaurants_tax_id_check/],
        ["accent_color = '#17317f'", /restaurants_accent_color_check/],
        ["website = 'http://pepe.es'", /restaurants_website_check/],
        ["instagram = 'https://instagram.com/pepe'", /restaurants_instagram_check/],
        ["tiktok = 'https://www.tiktok.com/pepe'", /restaurants_tiktok_check/],
        ["phone = '12345'", /restaurants_phone_check/],
        ["contact_email = 'Pepe@Example.com'", /restaurants_contact_email_check/],
        ['price_range = 5', /restaurants_price_range_check/],
        ["cuisine = '   '", /restaurants_cuisine_check/],
        ["logo_path = '00000000-0000-0000-0000-000000000000/logo-x.webp'", /restaurants_logo_path_check/],
      ];
      for (const [set, pattern] of bad) {
        await expectDbError(c, `update public.restaurants set ${set} where id = $1`, [a], pattern);
      }
      const ok = await c.query(
        `update public.restaurants
            set postal_code = '28013', tax_id = 'B12345674', accent_color = '#0A1330', website = 'https://pepe.es',
                instagram = 'https://www.instagram.com/pepe.bar', facebook = 'https://www.facebook.com/pepebar',
                tiktok = 'https://www.tiktok.com/@pepe_bar', phone = '+34910000000', contact_email = 'hola@pepe.es',
                logo_path = $2, cover_path = $3
          where id = $1`,
        [a, `${a}/logo-abc123.webp`, `${a}/cover-abc123.jpg`],
      );
      expect(ok.rowCount).toBe(1);
      const { rows } = await c.query('select accent_color from public.restaurants where id = $1', [a]);
      expect(rows[0].accent_color).toBe('#0A1330');
    }));

  it('el color de acento por defecto es el navy de FByte', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const { rows } = await c.query('select accent_color from public.restaurants where id = $1', [a]);
      expect(rows[0].accent_color).toBe('#17317F');
    }));
});

describe('descripciones por idioma', () => {
  it('save_restaurant_translations guarda, actualiza y borra los vacíos', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await c.query('select public.save_restaurant_translations($1, $2)', [a, { es: 'Cocina de mercado', en: 'Market food' }]);
      await c.query('select public.save_restaurant_translations($1, $2)', [a, { es: ' Cocina de mercado y vinos ', en: '  ' }]);
      const { rows } = await c.query('select locale, description from public.restaurant_translations order by locale');
      expect(rows).toEqual([{ locale: 'es', description: 'Cocina de mercado y vinos' }]);
    }));

  it('rechaza al encargado, idiomas desconocidos y textos de más de 1000 caracteres', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');
      const sql = 'select public.save_restaurant_translations($1, $2)';
      await as(c, manager);
      await expectDbError(c, sql, [a, { es: 'Hola' }], /FORBIDDEN/);
      await as(c, admin);
      await expectDbError(c, sql, [a, { pt: 'Olá' }], /restaurant_translations_locale_check/);
      await expectDbError(c, sql, [a, { es: 'a'.repeat(1001) }], /restaurant_translations_description_check/);
      await expectDbError(c, sql, [a, JSON.stringify(['es'])], /INVALID_INPUT/);
    }));

  it('un administrador no escribe descripciones de otro restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await expectDbError(c, 'select public.save_restaurant_translations($1, $2)', [b, { es: 'Hola' }], /FORBIDDEN/);
      await expectDbError(
        c,
        "insert into public.restaurant_translations (restaurant_id, locale, description) values ($1, 'es', 'Hola')",
        [b],
        /row-level security/,
      );
    }));
});

describe('galería', () => {
  it('admite como mucho 12 fotos por restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      const ins = 'insert into public.restaurant_photos (restaurant_id, path, position) values ($1, $2, $3)';
      for (let i = 0; i < 12; i++) await c.query(ins, [a, `${a}/gallery/foto-${i}.webp`, i]);
      await expectDbError(c, ins, [a, `${a}/gallery/foto-12.webp`, 12], /PHOTO_LIMIT/);
    }));

  it('la foto tiene que estar en la carpeta del restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      await expectDbError(
        c,
        'insert into public.restaurant_photos (restaurant_id, path) values ($1, $2)',
        [a, `${b}/gallery/foto.webp`],
        /restaurant_photos_path_check/,
      );
    }));

  it('sala ve la galería pero no la cambia', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const staff = await createUser(c, 'sala@example.com');
      await addMember(c, a, staff.id, 'staff');
      await asSuperuser(c);
      await c.query('insert into public.restaurant_photos (restaurant_id, path) values ($1, $2)', [a, `${a}/gallery/foto.webp`]);
      await as(c, staff);
      expect((await c.query('select path from public.restaurant_photos')).rows).toHaveLength(1);
      expect((await c.query('update public.restaurant_photos set position = 3')).rowCount).toBe(0);
      expect((await c.query('delete from public.restaurant_photos')).rowCount).toBe(0);
      await expectDbError(
        c,
        'insert into public.restaurant_photos (restaurant_id, path) values ($1, $2)',
        [a, `${a}/gallery/otra.webp`],
        /row-level security/,
      );
    }));
});

describe('cambio de dirección (slug)', () => {
  it('guarda la anterior como redirección y deja volver a ella', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      const r = await c.query('select public.change_slug($1, $2) as slug', [a, ' Nuevo-Slug ']);
      expect(r.rows[0].slug).toBe('nuevo-slug');
      let redirects = await c.query('select old_slug from public.slug_redirects where restaurant_id = $1', [a]);
      expect(redirects.rows).toEqual([{ old_slug: 'rest-a' }]);
      await c.query('select public.change_slug($1, $2)', [a, 'rest-a']);
      redirects = await c.query('select old_slug from public.slug_redirects where restaurant_id = $1', [a]);
      expect(redirects.rows).toEqual([{ old_slug: 'nuevo-slug' }]);
      const same = await c.query('select public.change_slug($1, $2) as slug', [a, 'rest-a']);
      expect(same.rows[0].slug).toBe('rest-a');
    }));

  it('no deja usar la dirección actual o antigua de otro restaurante, ni una reservada', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const adminA = await createUser(c, 'a@example.com');
      const adminB = await createUser(c, 'b@example.com');
      await addMember(c, a, adminA.id, 'admin');
      await addMember(c, b, adminB.id, 'admin');
      await as(c, adminA);
      await c.query('select public.change_slug($1, $2)', [a, 'rest-a-nuevo']);
      await as(c, adminB);
      const sql = 'select public.change_slug($1, $2)';
      await expectDbError(c, sql, [b, 'rest-a'], /SLUG_TAKEN/);
      await expectDbError(c, sql, [b, 'rest-a-nuevo'], /restaurants_slug_key/);
      await expectDbError(c, sql, [b, 'panel'], /SLUG_RESERVED/);
      await expectDbError(c, sql, [b, 'mal slug'], /restaurants_slug_check/);
      const fbyte = await createUser(c, 'fbyte@example.com', { platformAdmin: true });
      await as(c, fbyte);
      await expectDbError(c, "select * from public.create_restaurant('Otro', 'rest-a', 'x@example.com')", [], /SLUG_TAKEN/);
    }));

  it('solo el administrador cambia la dirección y cada uno ve solo sus redirecciones', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, manager.id, 'manager');
      await asSuperuser(c);
      await c.query("insert into public.slug_redirects (old_slug, restaurant_id) values ('viejo-a', $1), ('viejo-b', $2)", [a, b]);
      await as(c, manager);
      await expectDbError(c, 'select public.change_slug($1, $2)', [a, 'otro-a'], /FORBIDDEN/);
      const { rows } = await c.query('select old_slug from public.slug_redirects');
      expect(rows).toEqual([{ old_slug: 'viejo-a' }]);
      await expectDbError(c, "insert into public.slug_redirects (old_slug, restaurant_id) values ('x-a', $1)", [a], /permission denied/);
    }));
});
