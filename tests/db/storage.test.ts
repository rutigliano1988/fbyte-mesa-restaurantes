import { afterAll, describe, expect, it } from 'vitest';
import { addMember, as, asSuperuser, createUser, expectDbError, insertRestaurant, pool, tx } from './helpers';

afterAll(() => pool.end());

const insertObject = "insert into storage.objects (bucket_id, name, owner) values ('restaurant-media', $1, $2)";

describe('Storage: bucket restaurant-media', () => {
  it('existe, es público y solo acepta WebP y JPEG de hasta 2 MB', () =>
    tx(async (c) => {
      const { rows } = await c.query(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'restaurant-media'",
      );
      expect(rows).toEqual([{ public: true, file_size_limit: '2097152', allowed_mime_types: ['image/webp', 'image/jpeg'] }]);
    }));

  it('storage.foldername() devuelve las carpetas de la ruta, como en Supabase', () =>
    tx(async (c) => {
      const { rows } = await c.query("select storage.foldername('abc/gallery/foto.webp') as parts");
      expect(rows[0].parts).toEqual(['abc', 'gallery']);
    }));

  it('el administrador sube y borra en la carpeta de su restaurante', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      await addMember(c, a, admin.id, 'admin');
      await as(c, admin);
      for (const name of [`${a}/logo-abc.webp`, `${a}/cover-abc.jpg`, `${a}/gallery/foto-1.webp`]) {
        expect((await c.query(insertObject, [name, admin.id])).rowCount).toBe(1);
      }
      const del = await c.query("delete from storage.objects where name = $1", [`${a}/gallery/foto-1.webp`]);
      expect(del.rowCount).toBe(1);
    }));

  it('nadie más sube: encargado, otro restaurante, rutas raras, restaurante desactivado o anon', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const off = await insertRestaurant(c, { name: 'Rest C', slug: 'rest-c', status: 'disabled' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, off, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');
      await as(c, manager);
      await expectDbError(c, insertObject, [`${a}/logo-abc.webp`, manager.id], /row-level security/);
      await as(c, admin);
      for (const name of [`${b}/logo-abc.webp`, `${a}/otra/foto.webp`, `${a}/logo-abc.png`, `${a}/logo-ABC.webp`, `${off}/logo-abc.webp`]) {
        await expectDbError(c, insertObject, [name, admin.id], /row-level security/);
      }
      await asSuperuser(c);
      await c.query("insert into storage.buckets (id, name) values ('otro', 'otro')");
      await as(c, admin);
      await expectDbError(
        c,
        "insert into storage.objects (bucket_id, name, owner) values ('otro', $1, $2)",
        [`${a}/logo-abc.webp`, admin.id],
        /row-level security/,
      );
      await as(c, null);
      await expectDbError(c, insertObject, [`${a}/logo-abc.webp`, null], /row-level security/);
    }));
});

describe('Storage: fotos de platos (Hito 3)', () => {
  it('Administrador y Encargado suben y borran fotos en dishes/', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const admin = await createUser(c, 'admin@example.com');
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, admin.id, 'admin');
      await addMember(c, a, manager.id, 'manager');
      for (const [u, name] of [
        [admin, `${a}/dishes/croquetas-1.webp`],
        [manager, `${a}/dishes/croquetas-2.jpg`],
      ] as const) {
        await as(c, u);
        expect((await c.query(insertObject, [name, u.id])).rowCount).toBe(1);
        expect((await c.query('delete from storage.objects where name = $1', [name])).rowCount).toBe(1);
      }
    }));

  it('ni Sala, ni otro restaurante, ni rutas raras, ni anon', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a' });
      const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b' });
      const manager = await createUser(c, 'enc@example.com');
      const staff = await createUser(c, 'sala@example.com');
      await addMember(c, a, manager.id, 'manager');
      await addMember(c, a, staff.id, 'staff');
      await as(c, staff);
      await expectDbError(c, insertObject, [`${a}/dishes/foto.webp`, staff.id], /row-level security/);
      await as(c, manager);
      for (const name of [`${b}/dishes/foto.webp`, `${a}/dishes/sub/foto.webp`, `${a}/dishes/FOTO.webp`, `${a}/dishes/foto.png`, `${a}/dishes.webp`]) {
        await expectDbError(c, insertObject, [name, manager.id], /row-level security/);
      }
      await as(c, null);
      await expectDbError(c, insertObject, [`${a}/dishes/foto.webp`, null], /row-level security/);
    }));

  it('el Encargado sigue sin tocar logo, portada ni galería', () =>
    tx(async (c) => {
      const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
      const manager = await createUser(c, 'enc@example.com');
      await addMember(c, a, manager.id, 'manager');
      await as(c, manager);
      for (const name of [`${a}/logo-abc.webp`, `${a}/cover-abc.jpg`, `${a}/gallery/foto-1.webp`]) {
        await expectDbError(c, insertObject, [name, manager.id], /row-level security/);
      }
    }));
});
