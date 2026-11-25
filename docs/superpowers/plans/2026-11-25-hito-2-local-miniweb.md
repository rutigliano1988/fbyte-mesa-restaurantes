# Mesa — Hito 2 (Local y mini-web): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada restaurante rellene su ficha (datos, fotos, idiomas, horario y cierres), la publique aceptando el contrato de encargado del tratamiento y tenga una mini-web pública `/[slug]` multidioma, rápida en el móvil y bien indexada.

**Architecture:** Igual que el Hito 1: la seguridad vive en Postgres (RLS + funciones `SECURITY DEFINER` con `search_path = ''`). El panel escribe con server actions y la sesión del usuario (también en Storage, cuyas políticas se prueban con un shim local). La mini-web lee solo por `get_public_restaurant(slug)` con un cliente **sin cookies** (anon), cachea con `unstable_cache` etiquetado y las server actions invalidan con `updateTag`. Las fotos se reducen y pasan a WebP en el navegador antes de subir. Toda la lógica (horarios, contraste, idiomas, CIF, redes, SEO) va en módulos puros con pruebas.

**Tech Stack:** Next.js 16.4.6 (App Router, `cacheComponents` desactivado) · React 19.3 · TypeScript · Tailwind CSS 4 · Supabase (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.2, Storage) · Zod 4.6 · Vitest 4.1 · pnpm 10 · Node 22 · PostgreSQL 16 (pruebas, con `btree_gist`).

**Spec:** `docs/superpowers/specs/2026-11-24-plataforma-restaurantes-design.md` (§4.4, §5, §7.1, §7.4, §7.6, §11, §12, §13) · **Decisiones del hito (mandan sobre la spec):** `docs/superpowers/specs/2026-11-25-hito-2-decisiones.md`

## Global Constraints

- Mercado España. Todo texto visible del panel, en castellano de España, con tuteo y la voz FByte: frases cortas, humanas, sin jerga ("Algo ha fallado. Vuelve a intentarlo en un momento.", nunca "Error 500"). Los textos de la interfaz pública salen de `src/lib/i18n/messages.ts` (es, en, ca, fr, de, it), con voz neutra.
- Nombre del producto **provisional** "Mesa": solo se escribe en `src/config/brand.ts`; el resto del código lo importa de ahí (`BRAND`).
- Colores FByte en el panel: `ink #0A1330`, `navy #17317F`, `navy-dark #0F2260`, `orange #FF7A1A`, `orange-dark #E8650A`, `peach #FFC48A`, `peach-soft #FFE9D6`, `paper #F8F5EF`, `muted #3A4157`. **Nunca texto blanco sobre naranja**; botón principal = fondo `orange`, texto `ink`. Tipografía Archivo con eje `wdth`.
- Páginas públicas: marca del restaurante (logo, portada y `accent_color`, por defecto `#17317F`) sobre diseño limpio y neutro; el texto sobre el acento es ink o blanco y debe llegar a **4,5:1** (WCAG AA); el panel no deja guardar un color que no llegue. Pie: `BRAND.poweredBy` ("Reservas y menú con Mesa · FByte Solutions", traducido por idioma) y enlace al aviso legal. **No** aparecen "Reservar" (Hito 4) ni "Ver carta" (Hito 3).
- Roles en BD: `admin` (Administrador), `manager` (Encargado), `staff` (Sala/Recepción). Ficha, fotos, idiomas, slug, datos fiscales y publicar → permiso `restaurant.edit` (solo `admin`). Horario y cierres → `settings.booking` (`admin` y `manager`). La BD es la fuente de verdad.
- Toda tabla nueva lleva `restaurant_id`, RLS activado y `revoke all … from anon, authenticated` antes de los `grant` concretos. **Anon solo ejecuta** `get_invitation` (Hito 1), `get_public_restaurant` y `list_public_slugs`, y no toca ninguna tabla nueva.
- Funciones `SECURITY DEFINER` siempre con `set search_path = ''` y nombres totalmente cualificados. Toda función nueva hace `revoke execute … from public, anon` (y `authenticated` si es de trigger).
- **Las migraciones ya aplicadas en Supabase no se editan** (`20261124000100_base.sql`, `20261124000200_invitations.sql`). Este hito añade `20261125000100_local.sql`, `20261125000200_horario.sql` y `20261125000300_publicar.sql`.
- Toda página nueva bajo `src/app/panel/[restaurantId]/` llama a `requirePanelAccess(restaurantId, permiso?)` de `@/lib/auth/guards` (AGENTS.md). Toda server action del panel pasa por `runPanelAction()` (que usa `requirePermission`: nada de escribir en modo soporte ni con el restaurante desactivado).
- La clave secreta de Supabase (`SUPABASE_SECRET_KEY`) nunca llega al navegador (`import 'server-only'`). La mini-web usa la *publishable key* sin cookies ni sesión; el proxy de sesión (`src/proxy.ts`) **no** cubre `/[slug]`.
- Horas como minutos desde medianoche: `start_minute` 0–1439, `end_minute` > inicio y ≤ 1800 (06:00 del día siguiente). Días ISO **1 = lunes … 7 = domingo**. Fechas en pantalla `dd/mm/aaaa`. Zonas `Europe/Madrid` y `Atlantic/Canary`.
- Idioma público: `?lang=` si está activo; si no, `Accept-Language` entre los activos; si no, `es`. **Sin cookie de idioma.** `hreflang` en metadatos y sitemap.
- Mapa: "Cómo llegar" abre `https://www.google.com/maps/dir/?api=1&destination=<dirección>`; el `<iframe>` (`https://www.google.com/maps?q=<dirección>&output=embed`) **solo** se carga al pulsar "Ver mapa". Sin `lat`/`lng`.
- Fotos: bucket público `restaurant-media`; rutas `{restaurant_id}/logo-*.webp`, `{restaurant_id}/cover-*.webp`, `{restaurant_id}/gallery/*.webp` (o `.jpg` si el navegador no sabe crear WebP); lado mayor máx. logo 512 px, portada 1920 px, galería 1600 px; calidad 0,82; máximo 2 MB por archivo y **12 fotos** de galería; origen JPEG, PNG o WebP; `serverActions.bodySizeLimit` = `4mb`.
- Textos legales (contrato de encargado `DPA_VERSION = '2026-11-borrador'` y aviso legal): plantillas marcadas **"PENDIENTE DE REVISIÓN LEGAL"**.
- Next.js 16 no es el que conoces: antes de usar una API, lee su guía en `node_modules/next/dist/docs/` (cada tarea indica cuáles). `updateTag` solo se puede llamar dentro de server actions. `params` y `searchParams` son promesas. `permanentRedirect` y `notFound` lanzan: no los metas en un `try`.
- Pruebas: `pnpm test:unit`, `pnpm test:db` (PostgreSQL 16 local en el puerto 54329, se resetea solo con el shim + todas las migraciones), `pnpm lint`, `pnpm typecheck`, `pnpm build`. Antes de este hito pasan **154** pruebas (99 unitarias + 55 de BD); al terminar deben pasar **301** (207 + 94).
- `pnpm build` sin `.env.local` necesita las mismas variables que la CI: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`.
- No hay claves reales de Supabase en el contenedor: **no** hay prueba e2e en este hito; al final hay una lista de comprobación manual para el usuario. Aplicar las migraciones en Supabase y desplegar lo hace el controlador después.
- Commits pequeños, uno por paso de "Commit". Mensajes en castellano.

---

## Decisiones de este plan (no estaban en el documento de decisiones)

1. **Etiquetas de caché por slug**, no por id: `public-restaurant:<slug>` + `public-restaurants` (todas las mini-webs y el sitemap). `unstable_cache` necesita las etiquetas *antes* de leer, y la página solo conoce el slug. Las acciones invalidan el slug actual; un cambio de slug, publicar o cambiar el estado invalidan también `public-restaurants`.
2. **La redirección del slug antiguo es 308** (`permanentRedirect` de Next). Para buscadores equivale a un 301. Conserva `?lang=`.
3. **JPEG de respaldo**: si el navegador no sabe crear WebP (Safari antiguo), se sube JPEG (fondo blanco). El bucket acepta `image/webp` e `image/jpeg`.
4. **FByte ya no activa restaurantes sin contrato**: `set_restaurant_status(…, 'active')` da `DPA_REQUIRED` si nadie lo aceptó. En el superadmin desaparece "Marcar como activo" y "Reactivar" devuelve a `setup` si el restaurante nunca se publicó.
5. **Aviso legal solo en castellano** (con una nota traducida en los demás idiomas). Las políticas completas llegan en el Hito 5.
6. **El idioma por defecto no se edita** en el panel (siempre `es`, como dice la decisión 6). El contenido público va dentro de `<div lang="…">` porque el layout raíz fija `<html lang="es">`.
7. `services` no lleva todavía `last_booking_time` ni `slot_interval_min` (YAGNI): los añade el Hito 4 en su migración.
8. El formulario de horario especial admite **dos servicios** (la BD admite hasta 6). La galería se ordena con botones ← → (sin arrastrar).
9. **Formularios del panel con `onSubmit` + `startTransition`** (componente `ActionForm`) en vez de `action={…}`: React 19 vacía los formularios enviados por `action` y se perdería lo escrito al haber errores.
10. El paso "Idiomas" del asistente se marca hecho cuando todos los idiomas activos tienen descripción. No hay vista previa de la mini-web antes de publicar.
11. `get_public_restaurant` devuelve los cierres que no han terminado de los **próximos 90 días** (fecha en la zona del restaurante); la caché se renueva como mucho cada hora y la página vuelve a filtrar con la fecha de hoy.

---

## Estructura de archivos del Hito 2

```
supabase/tests/auth_shim.sql                 (modificar) + shim mínimo de Storage (buckets, objects, foldername)
supabase/migrations/20261125000100_local.sql      Ficha: columnas, traducciones, galería, slug_redirects, change_slug, Storage
supabase/migrations/20261125000200_horario.sql    services y schedule_exceptions con RLS
supabase/migrations/20261125000300_publicar.sql   missing_fields, publish, set_restaurant_status, datos públicos
tests/db/helpers.ts                          (modificar) + makePublishable()
tests/db/local.test.ts | storage.test.ts | schedule.test.ts | public.test.ts
next.config.ts                               (modificar) serverActions.bodySizeLimit 4mb
docs/setup.md                                (modificar) migraciones nuevas, avisos esperados y Storage
src/lib/color.ts (+test)                     Contraste WCAG y tema de acento
src/lib/schedule.ts (+test)                  Minutos ↔ HH:MM, solapes, agrupar por día, fechas
src/lib/spain.ts (+test)                     CIF/NIF/NIE, código postal, teléfono
src/lib/social.ts (+test)                    Instagram/Facebook/TikTok y web → URL
src/lib/i18n/locales.ts (+test)              Idiomas y resolución ?lang / Accept-Language
src/lib/i18n/messages.ts (+test)             Textos públicos en 6 idiomas
src/lib/media.ts (+test)                     Bucket, rutas, URL pública, comprobación de subida
src/lib/images/compress.ts (+test)           Reducir y pasar a WebP en el navegador
src/lib/validation/local.ts (+test)          Esquemas Zod de la ficha
src/lib/validation/schedule.ts (+test)       Esquemas Zod de servicios y cierres
src/lib/forms.ts (+test)                     (modificar) + formStrings()
src/lib/db-errors.ts (+test)                 (modificar) códigos nuevos
src/lib/panel-nav.ts (+test)                 (modificar) Local y Horario
src/lib/onboarding.ts (+test)                Pasos del asistente y etiquetas de lo que falta
src/lib/legal/dpa.ts                         Contrato de encargado (plantilla) y versión
src/lib/legal/legal-notice.ts                Aviso legal (plantilla LSSI)
src/lib/legal/legal.test.ts
src/lib/public/tags.ts                       Etiquetas de caché
src/lib/public/restaurant-schema.ts (+test)  JSON público → objeto de la app
src/lib/public/fixtures.ts                   Restaurante de ejemplo para pruebas
src/lib/public/format.ts                     Precio, dirección, enlaces de mapa, ?lang
src/lib/public/seo.ts | jsonld.ts            hreflang, descripción, OG, JSON-LD
src/lib/public/seo.test.ts
src/lib/public/data.ts                       (server) getPublicRestaurant, getPublicSlugs, mediaUrl
src/lib/public/locale.ts                     (server) requestLocale()
src/lib/supabase/public.ts                   (server) cliente sin cookies
src/lib/local/data.ts                        (server) ficha y horario para el panel
src/lib/actions/run.ts                       (server) runPanelAction, refreshRestaurant
src/lib/actions/restaurant.ts | media.ts | schedule.ts | publish.ts   Server actions
src/components/forms/ActionForm.tsx          Formulario con server action y campos con errores
src/components/ui/SectionCard.tsx
src/components/local/{ImageUploader,ImageSlot,Gallery,AccentColorField}.tsx
src/components/schedule/{ServiceRow,ExceptionItem}.tsx
src/components/onboarding/{OnboardingChecklist,PublishCard}.tsx
src/components/public/{PublicShell,OpeningHours,MapEmbed}.tsx
src/app/panel/[restaurantId]/page.tsx        (modificar) asistente y publicar
src/app/panel/[restaurantId]/local/page.tsx
src/app/panel/[restaurantId]/horario/page.tsx
src/app/admin/restaurantes/[id]/{actions.ts,page.tsx}   (modificar) estado e invalidación
src/app/[slug]/page.tsx | aviso-legal/page.tsx | not-found.tsx
src/app/sitemap.ts | robots.ts
```

---

### Task 1: Shim de Storage y migración de la ficha del local

**Files:**
- Modify: `supabase/tests/auth_shim.sql` (añadir al final)
- Create: `supabase/migrations/20261125000100_local.sql`
- Test: `tests/db/local.test.ts`, `tests/db/storage.test.ts`

**Interfaces:**
- Consumes (Hito 1): `public.restaurants`, `public.has_role(uuid, member_role[])`, `public.is_member(uuid)`, `public.is_platform_admin()`, `public.set_updated_at()`, `public.check_slug_not_reserved()`; helpers de `tests/db/helpers.ts`: `tx`, `as`, `asSuperuser`, `createUser`, `insertRestaurant` (por defecto `status: 'active'`), `addMember`, `expectDbError`.
- Produces:
  - Columnas nuevas de `public.restaurants`: `cuisine text`, `price_range smallint` (1–4), `address_line`, `postal_code` (5 cifras, provincia 01–52), `city`, `phone` (`^\+?[0-9]{9,15}$`), `contact_email` (minúsculas), `website` (`https://…`), `instagram` (`https://www.instagram.com/<usuario>`), `facebook` (`https://www.facebook.com/…`), `tiktok` (`https://www.tiktok.com/@<usuario>`), `accent_color text not null default '#17317F'` (`^#[0-9A-F]{6}$`), `logo_path`, `cover_path` (en `{id}/logo-…` / `{id}/cover-…`), `legal_name`, `tax_id` (formato NIF/NIE/CIF en mayúsculas), `published_at`, `dpa_accepted_at`, `dpa_accepted_by`, `dpa_version`. `authenticated` puede actualizar las de la ficha (no `slug`, `status`, `published_at` ni `dpa_*`).
  - `public.restaurant_translations(restaurant_id, locale, description ≤ 1000)` (PK `restaurant_id, locale`).
  - `public.save_restaurant_translations(p_restaurant_id uuid, p_descriptions jsonb) returns void` — `{"es": "…", "en": ""}`; texto vacío borra ese idioma. Errores: `FORBIDDEN`, `INVALID_INPUT`.
  - `public.restaurant_photos(id, restaurant_id, path unique, position)`; máximo 12 (`PHOTO_LIMIT`).
  - `public.slug_redirects(old_slug pk, restaurant_id)` + trigger `SLUG_TAKEN`.
  - `public.change_slug(p_restaurant_id uuid, p_new_slug text) returns text` (slug nuevo normalizado). Errores: `FORBIDDEN`, `SLUG_TAKEN`, `SLUG_RESERVED`, `restaurants_slug_key`, `restaurants_slug_check`.
  - Bucket `restaurant-media` (público, 2 MB, `image/webp` e `image/jpeg`) y `public.can_manage_media(p_bucket_id text, p_name text) returns boolean`, usada por cuatro políticas `restaurant_media_*` de `storage.objects`.

Lee antes: la migración `supabase/migrations/20261124000100_base.sql` (estilo, helpers y privilegios) y `tests/db/base.test.ts`.

- [ ] **Step 1: Escribir las pruebas de la ficha (fallan)**

Create `tests/db/local.test.ts`:

```ts
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
```

- [ ] **Step 2: Escribir las pruebas de Storage (fallan)**

Create `tests/db/storage.test.ts`:

```ts
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
```

- [ ] **Step 3: Ejecutar y ver que fallan**

Run: `pnpm test:db`
Expected: FAIL en `local.test.ts` (`column "cuisine" of relation "restaurants" does not exist`, `function public.save_restaurant_translations(...) does not exist`…) y en `storage.test.ts` (`relation "storage.buckets" does not exist`). `base.test.ts` e `invitations.test.ts` siguen en verde.

- [ ] **Step 4: Añadir el shim de Storage**

Supabase ya tiene el esquema `storage`; el PostgreSQL de pruebas no. Añadir **al final** de `supabase/tests/auth_shim.sql` (no se aplica nunca en Supabase):

```sql

-- Storage de Supabase (mínimo): buckets, objects y storage.foldername(). Solo pruebas.
create schema if not exists storage;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

-- Igual que la de Supabase: carpetas de la ruta, sin el nombre del archivo.
create or replace function storage.foldername(name text) returns text[]
language plpgsql as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
```

`storage.foldername()` es copia de la de Supabase (`'abc/gallery/foto.webp'` → `{abc,gallery}`).

- [ ] **Step 5: Escribir la migración**

Create `supabase/migrations/20261125000100_local.sql`:

```sql
-- Mesa · Hito 2 · ficha del local: datos públicos, descripciones, galería, redirecciones de slug y Storage.

-- Datos nuevos del restaurante -------------------------------------------------------
alter table public.restaurants
  add column cuisine text
    constraint restaurants_cuisine_check check (length(trim(cuisine)) between 1 and 60),
  add column price_range smallint
    constraint restaurants_price_range_check check (price_range between 1 and 4),
  add column address_line text
    constraint restaurants_address_line_check check (length(trim(address_line)) between 3 and 200),
  add column postal_code text
    constraint restaurants_postal_code_check check (postal_code ~ '^(0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}$'),
  add column city text
    constraint restaurants_city_check check (length(trim(city)) between 2 and 100),
  add column phone text
    constraint restaurants_phone_check check (phone ~ '^\+?[0-9]{9,15}$'),
  add column contact_email text
    constraint restaurants_contact_email_check check (contact_email = lower(contact_email) and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column website text
    constraint restaurants_website_check check (website ~ '^https://\S+$' and length(website) <= 300),
  add column instagram text
    constraint restaurants_instagram_check check (instagram ~ '^https://www\.instagram\.com/[A-Za-z0-9._]{1,30}$'),
  add column facebook text
    constraint restaurants_facebook_check check (facebook ~ '^https://www\.facebook\.com/\S{1,100}$'),
  add column tiktok text
    constraint restaurants_tiktok_check check (tiktok ~ '^https://www\.tiktok\.com/@[A-Za-z0-9._]{2,24}$'),
  add column accent_color text not null default '#17317F'
    constraint restaurants_accent_color_check check (accent_color ~ '^#[0-9A-F]{6}$'),
  add column logo_path text,
  add column cover_path text,
  add column legal_name text
    constraint restaurants_legal_name_check check (length(trim(legal_name)) between 2 and 200),
  add column tax_id text
    constraint restaurants_tax_id_check check (tax_id ~ '^([0-9]{8}[A-Z]|[XYZKLM][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$'),
  add column published_at timestamptz,
  add column dpa_accepted_at timestamptz,
  add column dpa_accepted_by uuid references auth.users (id) on delete set null,
  add column dpa_version text;

-- Las imágenes del restaurante solo pueden estar en su carpeta.
alter table public.restaurants
  add constraint restaurants_logo_path_check
    check (logo_path ~ ('^' || id::text || '/logo-[a-z0-9-]+\.(webp|jpg)$')),
  add constraint restaurants_cover_path_check
    check (cover_path ~ ('^' || id::text || '/cover-[a-z0-9-]+\.(webp|jpg)$'));

-- El administrador edita la ficha; slug, estado, publicación y contrato van por funciones.
grant update (cuisine, price_range, address_line, postal_code, city, phone, contact_email, website,
  instagram, facebook, tiktok, accent_color, logo_path, cover_path, legal_name, tax_id)
  on public.restaurants to authenticated;

-- Descripción por idioma ------------------------------------------------------------
create table public.restaurant_translations (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  locale text not null
    constraint restaurant_translations_locale_check check (locale in ('es', 'en', 'ca', 'fr', 'de', 'it')),
  description text not null
    constraint restaurant_translations_description_check check (length(trim(description)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, locale)
);
create trigger restaurant_translations_updated_at before update on public.restaurant_translations
  for each row execute function public.set_updated_at();

/** Guarda las descripciones de golpe: {"es": "…", "en": ""}. Texto vacío = borrar ese idioma. */
create or replace function public.save_restaurant_translations(p_restaurant_id uuid, p_descriptions jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_locale text;
  v_text text;
begin
  if not public.has_role(p_restaurant_id, '{admin}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_descriptions) is distinct from 'object' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  for v_locale, v_text in select d.key, d.value from jsonb_each_text(p_descriptions) d loop
    v_text := nullif(trim(v_text), '');
    if v_text is null then
      delete from public.restaurant_translations t
       where t.restaurant_id = p_restaurant_id and t.locale = v_locale;
    else
      insert into public.restaurant_translations (restaurant_id, locale, description)
      values (p_restaurant_id, v_locale, v_text)
      on conflict (restaurant_id, locale) do update set description = excluded.description;
    end if;
  end loop;
end $$;

-- Galería ---------------------------------------------------------------------------
create table public.restaurant_photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  path text not null unique,
  position integer not null default 0 constraint restaurant_photos_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_photos_path_check
    check (path ~ ('^' || restaurant_id::text || '/gallery/[a-z0-9-]+\.(webp|jpg)$'))
);
create index restaurant_photos_restaurant_idx on public.restaurant_photos (restaurant_id, position);
create trigger restaurant_photos_updated_at before update on public.restaurant_photos
  for each row execute function public.set_updated_at();

/** Como mucho 12 fotos por restaurante (con bloqueo, para que dos subidas a la vez no pasen de 12). */
create or replace function public.limit_restaurant_photos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.restaurants r where r.id = new.restaurant_id for no key update;
  if (select count(*) from public.restaurant_photos p where p.restaurant_id = new.restaurant_id) >= 12 then
    raise exception 'PHOTO_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger restaurant_photos_limit before insert on public.restaurant_photos
  for each row execute function public.limit_restaurant_photos();

-- Direcciones antiguas (los QR impresos siguen funcionando) ---------------------------
create table public.slug_redirects (
  old_slug text primary key
    constraint slug_redirects_old_slug_check check (old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(old_slug) between 3 and 60),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index slug_redirects_restaurant_idx on public.slug_redirects (restaurant_id);

/** Un restaurante no puede quedarse con la dirección antigua de otro. */
create or replace function public.check_slug_not_redirected() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.slug_redirects s where s.old_slug = new.slug and s.restaurant_id <> new.id
  ) then
    raise exception 'SLUG_TAKEN' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger restaurants_slug_not_redirected before insert or update of slug on public.restaurants
  for each row execute function public.check_slug_not_redirected();

create or replace function public.change_slug(p_restaurant_id uuid, p_new_slug text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_new text := lower(trim(p_new_slug));
  v_old text;
begin
  if not public.has_role(p_restaurant_id, '{admin}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select r.slug into v_old from public.restaurants r where r.id = p_restaurant_id for update;
  if v_old = v_new then
    return v_new;
  end if;
  -- Volver a una dirección antigua propia: deja de ser redirección.
  delete from public.slug_redirects s where s.old_slug = v_new and s.restaurant_id = p_restaurant_id;
  update public.restaurants set slug = v_new where id = p_restaurant_id;
  insert into public.slug_redirects (old_slug, restaurant_id) values (v_old, p_restaurant_id);
  return v_new;
end $$;

-- Privilegios y RLS ------------------------------------------------------------------
alter table public.restaurant_translations enable row level security;
alter table public.restaurant_photos enable row level security;
alter table public.slug_redirects enable row level security;

revoke all on public.restaurant_translations, public.restaurant_photos, public.slug_redirects from anon, authenticated;

grant select, insert, delete on public.restaurant_translations to authenticated;
grant update (description) on public.restaurant_translations to authenticated;
create policy translations_select on public.restaurant_translations for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy translations_insert on public.restaurant_translations for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin}'));
create policy translations_update on public.restaurant_translations for update to authenticated
  using (public.has_role(restaurant_id, '{admin}')) with check (public.has_role(restaurant_id, '{admin}'));
create policy translations_delete on public.restaurant_translations for delete to authenticated
  using (public.has_role(restaurant_id, '{admin}'));

grant select, insert, delete on public.restaurant_photos to authenticated;
grant update (position) on public.restaurant_photos to authenticated;
create policy photos_select on public.restaurant_photos for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy photos_insert on public.restaurant_photos for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin}'));
create policy photos_update on public.restaurant_photos for update to authenticated
  using (public.has_role(restaurant_id, '{admin}')) with check (public.has_role(restaurant_id, '{admin}'));
create policy photos_delete on public.restaurant_photos for delete to authenticated
  using (public.has_role(restaurant_id, '{admin}'));

grant select on public.slug_redirects to authenticated;
create policy slug_redirects_select on public.slug_redirects for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());

-- Storage: bucket público con las fotos; solo el administrador sube y borra en su carpeta ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-media', 'restaurant-media', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- Ruta {restaurant_id}/logo-…, cover-… o gallery/… (.webp o .jpg) y ser administrador de ese restaurante.
create or replace function public.can_manage_media(p_bucket_id text, p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if p_bucket_id is distinct from 'restaurant-media' or p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo-[a-z0-9-]+|cover-[a-z0-9-]+|gallery/[a-z0-9-]+)\.(webp|jpg)$' then
    return false;
  end if;
  return public.has_role(((storage.foldername(p_name))[1])::uuid, '{admin}');
end $$;

create policy restaurant_media_select on storage.objects for select to authenticated
  using (public.can_manage_media(bucket_id, name));
create policy restaurant_media_insert on storage.objects for insert to authenticated
  with check (public.can_manage_media(bucket_id, name));
create policy restaurant_media_update on storage.objects for update to authenticated
  using (public.can_manage_media(bucket_id, name)) with check (public.can_manage_media(bucket_id, name));
create policy restaurant_media_delete on storage.objects for delete to authenticated
  using (public.can_manage_media(bucket_id, name));

-- Funciones: triggers para nadie; el resto, solo usuarios autenticados.
revoke execute on function public.limit_restaurant_photos(), public.check_slug_not_redirected()
  from public, anon, authenticated;
revoke execute on function public.save_restaurant_translations(uuid, jsonb), public.change_slug(uuid, text),
  public.can_manage_media(text, text)
  from public, anon;
grant execute on function public.save_restaurant_translations(uuid, jsonb), public.change_slug(uuid, text),
  public.can_manage_media(text, text)
  to authenticated;
```

Notas para quien implementa:
- `save_restaurant_translations` es `security invoker`: la RLS de `restaurant_translations` se aplica de verdad; `on conflict … do update set description` solo necesita `update (description)`.
- En los comentarios SQL no escribas `/*` dentro de un comentario `/** … */` (por ejemplo `gallery/*.webp`): PostgreSQL anida comentarios y la migración falla con `unterminated /* comment`.
- Las políticas de `storage.objects` van dirigidas a `authenticated`; anon no tiene ninguna, así que no sube nada. Lo público se lee por la URL pública del bucket, que no pasa por RLS.

- [ ] **Step 6: Ejecutar las pruebas de BD**

Run: `pnpm test:db`
Expected: PASS (`base`, `invitations`, `local` y `storage`).

- [ ] **Step 7: Commit**

```bash
git add supabase/tests/auth_shim.sql supabase/migrations/20261125000100_local.sql tests/db/local.test.ts tests/db/storage.test.ts
git commit -m "BD: ficha del local, descripciones, galería, redirecciones de slug y Storage"
```

---

### Task 2: Migración del horario: servicios y cierres

**Files:**
- Create: `supabase/migrations/20261125000200_horario.sql`
- Test: `tests/db/schedule.test.ts`

**Interfaces:**
- Consumes: helpers de BD del Hito 1 (`Role`, `TestUser` incluidos).
- Produces:
  - `public.services(id, restaurant_id, name ≤ 40, weekday 1–7, start_minute 0–1439, end_minute > start y ≤ 1800)`; restricción de exclusión `services_no_overlap` (mismo restaurante y día, rangos `[start, end)`); `services_range_check`.
  - `public.schedule_exception_kind` = `'closed' | 'custom'`; `public.schedule_exceptions(id, restaurant_id, date_from, date_to, kind, custom_services jsonb, note ≤ 140)` con `schedule_exceptions_dates_check` (fin ≥ inicio, ≤ 366 días), `schedule_exceptions_services_check` (`closed` ⇒ `[]`; `custom` ⇒ 1–6 servicios `{"name","start_minute","end_minute"}` válidos) y `schedule_exceptions_no_overlap`.
  - `public.valid_custom_services(jsonb) returns boolean` (inmutable, la usa el CHECK).
  - RLS: leen los miembros y FByte; escriben `admin` y `manager`.

- [ ] **Step 1: Escribir las pruebas (fallan)**

Create `tests/db/schedule.test.ts`:

```ts
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
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `pnpm test:db`
Expected: FAIL en `schedule.test.ts` con `relation "public.services" does not exist`.

- [ ] **Step 3: Escribir la migración**

Create `supabase/migrations/20261125000200_horario.sql`:

```sql
-- Mesa · Hito 2 · horario: servicios por día de la semana y cierres o días especiales.
-- Horas en minutos desde medianoche; end_minute puede pasar de 1440 (hasta las 06:00 del día siguiente).
-- Días ISO: 1 = lunes … 7 = domingo.
create extension if not exists btree_gist with schema extensions;

create type public.schedule_exception_kind as enum ('closed', 'custom');

create table public.services (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null constraint services_name_check check (length(trim(name)) between 1 and 40),
  weekday smallint not null constraint services_weekday_check check (weekday between 1 and 7),
  start_minute smallint not null constraint services_start_minute_check check (start_minute between 0 and 1439),
  end_minute smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_range_check check (end_minute > start_minute and end_minute <= 1800),
  constraint services_no_overlap exclude using gist (
    restaurant_id with =, weekday with =, int4range(start_minute, end_minute) with &&
  )
);
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

/** Servicios de un día especial: [{"name": "Cena", "start_minute": 1200, "end_minute": 1470}], como mucho 6. */
create or replace function public.valid_custom_services(p_services jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_services) is distinct from 'array' or jsonb_array_length(p_services) > 6 then false
  else not exists (
    select 1 from jsonb_array_elements(p_services) e(v)
    where case
      when jsonb_typeof(e.v) = 'object'
        and coalesce(jsonb_typeof(e.v -> 'name'), '') = 'string'
        and coalesce(jsonb_typeof(e.v -> 'start_minute'), '') = 'number'
        and coalesce(jsonb_typeof(e.v -> 'end_minute'), '') = 'number'
      then not (
        length(trim(e.v ->> 'name')) between 1 and 40
        and (e.v ->> 'start_minute')::numeric % 1 = 0
        and (e.v ->> 'end_minute')::numeric % 1 = 0
        and (e.v ->> 'start_minute')::numeric between 0 and 1439
        and (e.v ->> 'end_minute')::numeric > (e.v ->> 'start_minute')::numeric
        and (e.v ->> 'end_minute')::numeric <= 1800
      )
      else true
    end
  ) end
$$;

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  kind public.schedule_exception_kind not null default 'closed',
  custom_services jsonb not null default '[]'::jsonb,
  note text constraint schedule_exceptions_note_check check (length(trim(note)) between 1 and 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_exceptions_dates_check check (date_to >= date_from and date_to - date_from <= 366),
  constraint schedule_exceptions_services_check check (
    case when public.valid_custom_services(custom_services)
      then (kind = 'closed' and jsonb_array_length(custom_services) = 0)
        or (kind = 'custom' and jsonb_array_length(custom_services) >= 1)
      else false
    end
  ),
  constraint schedule_exceptions_no_overlap exclude using gist (
    restaurant_id with =, daterange(date_from, date_to, '[]') with &&
  )
);
create trigger schedule_exceptions_updated_at before update on public.schedule_exceptions
  for each row execute function public.set_updated_at();

-- Privilegios y RLS: leen los miembros (y FByte en soporte); editan Administrador y Encargado.
alter table public.services enable row level security;
alter table public.schedule_exceptions enable row level security;
revoke all on public.services, public.schedule_exceptions from anon, authenticated;

grant select, insert, delete on public.services to authenticated;
grant update (name, weekday, start_minute, end_minute) on public.services to authenticated;
create policy services_select on public.services for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy services_insert on public.services for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy services_update on public.services for update to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}')) with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy services_delete on public.services for delete to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}'));

grant select, insert, delete on public.schedule_exceptions to authenticated;
grant update (date_from, date_to, kind, custom_services, note) on public.schedule_exceptions to authenticated;
create policy exceptions_select on public.schedule_exceptions for select to authenticated
  using (public.is_member(restaurant_id) or public.is_platform_admin());
create policy exceptions_insert on public.schedule_exceptions for insert to authenticated
  with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy exceptions_update on public.schedule_exceptions for update to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}')) with check (public.has_role(restaurant_id, '{admin,manager}'));
create policy exceptions_delete on public.schedule_exceptions for delete to authenticated
  using (public.has_role(restaurant_id, '{admin,manager}'));

-- La usa una restricción CHECK: la ejecuta quien inserta.
revoke execute on function public.valid_custom_services(jsonb) from public, anon;
grant execute on function public.valid_custom_services(jsonb) to authenticated;
```

`btree_gist` hace falta para mezclar `=` (uuid, smallint) y `&&` (rangos) en la misma restricción de exclusión. En Supabase está disponible; se instala en el esquema `extensions`, como `pgcrypto`.

- [ ] **Step 4: Ejecutar las pruebas de BD**

Run: `pnpm test:db`
Expected: PASS (todas, incluida `schedule.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261125000200_horario.sql tests/db/schedule.test.ts
git commit -m "BD: servicios por día y cierres con RLS y sin solapes"
```

---

### Task 3: Publicar y datos públicos para anon

**Files:**
- Create: `src/lib/legal/dpa.ts`
- Create: `supabase/migrations/20261125000300_publicar.sql`
- Modify: `tests/db/helpers.ts` (añadir `makePublishable`)
- Test: `tests/db/public.test.ts`

**Interfaces:**
- Consumes: Tasks 1 y 2; `BRAND` de `src/config/brand.ts`.
- Produces:
  - `src/lib/legal/dpa.ts`: `DPA_VERSION = '2026-11-borrador'`, `DPA_TITLE = 'Contrato de encargado del tratamiento'`, `LEGAL_REVIEW_PENDING = 'PENDIENTE DE REVISIÓN LEGAL'`, `DPA_SECTIONS: { heading: string; body: string }[]`.
  - `public.restaurant_missing_fields(p_restaurant_id uuid) returns text[]` — códigos, en este orden: `address_line`, `postal_code`, `city`, `contact` (ni teléfono ni email), `services`, `legal_name`, `tax_id`. Para miembros y FByte (`FORBIDDEN` si no).
  - `public.publish_restaurant(p_restaurant_id uuid, p_dpa_version text) returns void` — solo `admin`; errores `FORBIDDEN`, `ALREADY_PUBLISHED`, `DPA_VERSION`, `MISSING_FIELDS` (con `detail` = códigos separados por comas). Deja `status = 'active'`, `published_at`, `dpa_accepted_at/by`, `dpa_version` y audita `restaurant.publish`.
  - `public.set_restaurant_status` (reemplazada): `'active'` sin contrato aceptado → `DPA_REQUIRED`.
  - `public.get_public_restaurant(p_slug text) returns jsonb` (anon) — `null`, `{"redirect": "<slug>"}` o `{ id, slug, name, timezone, enabled_locales, cuisine, price_range, address_line, postal_code, city, phone, contact_email, website, instagram, facebook, tiktok, accent_color, logo_path, cover_path, legal_name, tax_id, descriptions: {locale: texto}, photos: [path], services: [{name, weekday, start_minute, end_minute}], exceptions: [{date_from, date_to, kind, custom_services, note}] }`.
  - `public.list_public_slugs() returns table (slug text, enabled_locales text[], updated_at timestamptz)` (anon).
  - `makePublishable(c: pg.PoolClient, restaurantId: string): Promise<void>` en `tests/db/helpers.ts`.

- [ ] **Step 1: Texto y versión del contrato de encargado**

La prueba de BD importa `DPA_VERSION` para comprobar que la app y `publish_restaurant` usan la misma versión. Create `src/lib/legal/dpa.ts`:

```ts
import { BRAND } from '@/config/brand';

/** Debe coincidir con la versión que acepta public.publish_restaurant() (lo comprueba tests/db/public.test.ts). */
export const DPA_VERSION = '2026-11-borrador';

export const DPA_TITLE = 'Contrato de encargado del tratamiento';
export const LEGAL_REVIEW_PENDING = 'PENDIENTE DE REVISIÓN LEGAL';

/** Plantilla. Hay que revisarla con un abogado antes de vender el producto (spec §11). */
export const DPA_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Quién es quién',
    body: `Tu restaurante es el responsable de los datos de sus clientes. ${BRAND.company} es el encargado del tratamiento: trata esos datos solo para darte el servicio de ${BRAND.productName} y siguiendo tus instrucciones.`,
  },
  {
    heading: 'Qué datos y para qué',
    body: 'Datos de contacto de tus clientes (nombre, email y teléfono), sus reservas y las notas que añada tu equipo. Se usan para gestionar reservas, enviar los emails de la reserva y mostrarte estadísticas. Nada más.',
  },
  {
    heading: 'Cuánto tiempo',
    body: `Mientras uses ${BRAND.productName}. Los clientes sin actividad durante 3 años se anonimizan de forma automática. Al terminar el servicio, borramos los datos o te los devolvemos, como prefieras.`,
  },
  {
    heading: 'Cómo los protegemos',
    body: 'Los datos se guardan en la Unión Europea (Fráncfort), con acceso solo para las personas de tu equipo y con permisos por rol. Las personas de FByte que dan soporte tienen deber de confidencialidad y su acceso queda registrado.',
  },
  {
    heading: 'Subencargados',
    body: 'Supabase (base de datos y archivos, UE), Vercel (alojamiento de la web) y Resend (envío de emails). Te avisaremos antes de añadir o cambiar alguno.',
  },
  {
    heading: 'Derechos de tus clientes',
    body: `Si un cliente pide ver, corregir o borrar sus datos, ${BRAND.productName} te da las herramientas para hacerlo. Si nos llega a nosotros, te lo pasamos sin demora.`,
  },
  {
    heading: 'Si algo falla',
    body: 'Si hay una brecha de seguridad que afecte a tus datos, te avisamos sin dilación indebida y en menos de 48 horas, con lo que sepamos y las medidas tomadas.',
  },
];
```

- [ ] **Step 2: Añadir el helper `makePublishable`**

Añadir al final de `tests/db/helpers.ts`:

```ts

/** Deja el restaurante listo para publicar: dirección, contacto, datos fiscales y un servicio. */
export async function makePublishable(c: pg.PoolClient, restaurantId: string): Promise<void> {
  await asSuperuser(c);
  await c.query(
    `update public.restaurants
        set address_line = 'Calle Mayor 1', postal_code = '28013', city = 'Madrid', phone = '910000000',
            legal_name = 'Taberna Pepe SL', tax_id = 'B12345674'
      where id = $1`,
    [restaurantId],
  );
  await c.query(
    "insert into public.services (restaurant_id, name, weekday, start_minute, end_minute) values ($1, 'Comida', 1, 780, 960)",
    [restaurantId],
  );
}
```

`B12345674` es un CIF de prueba con dígito de control correcto.

- [ ] **Step 3: Escribir las pruebas (fallan)**

Create `tests/db/public.test.ts`:

```ts
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
        descriptions: { es: 'Hola', en: 'Hi' },
        photos: [`${a}/gallery/a.webp`, `${a}/gallery/b.webp`],
        services: [{ name: 'Comida', weekday: 1, start_minute: 780, end_minute: 960 }],
      });
      expect(data.exceptions.map((e: { note: string }) => e.note)).toEqual(['Puente']);
      for (const key of ['status', 'dpa_accepted_at', 'dpa_accepted_by', 'dpa_version', 'published_at', 'created_at']) {
        expect(data).not.toHaveProperty(key);
      }
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
        for (const fn of ['public.limit_restaurant_photos()', 'public.check_slug_not_redirected()']) {
          const { rows } = await c.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute']);
          expect(rows[0].ok, `${role} → ${fn}`).toBe(false);
        }
      }
    }));
});
```

- [ ] **Step 4: Ejecutar y ver que fallan**

Run: `pnpm test:db`
Expected: FAIL en `public.test.ts` (`function public.restaurant_missing_fields(uuid) does not exist`, `function public.get_public_restaurant(unknown) does not exist`…).

- [ ] **Step 5: Escribir la migración**

Create `supabase/migrations/20261125000300_publicar.sql`:

```sql
-- Mesa · Hito 2 · publicar la mini-web y datos públicos para anon.

/** Lo que falta para poder publicar (vacío = se puede publicar). */
create or replace function public.restaurant_missing_fields(p_restaurant_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants%rowtype;
  v_missing text[] := '{}';
begin
  if not (public.is_member(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.restaurants x where x.id = p_restaurant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.address_line is null then v_missing := array_append(v_missing, 'address_line'); end if;
  if r.postal_code is null then v_missing := array_append(v_missing, 'postal_code'); end if;
  if r.city is null then v_missing := array_append(v_missing, 'city'); end if;
  if r.phone is null and r.contact_email is null then v_missing := array_append(v_missing, 'contact'); end if;
  if not exists (select 1 from public.services s where s.restaurant_id = r.id) then
    v_missing := array_append(v_missing, 'services');
  end if;
  if r.legal_name is null then v_missing := array_append(v_missing, 'legal_name'); end if;
  if r.tax_id is null then v_missing := array_append(v_missing, 'tax_id'); end if;
  return v_missing;
end $$;

/** El administrador publica: acepta el contrato de encargado del tratamiento y pasa a 'active'. */
create or replace function public.publish_restaurant(p_restaurant_id uuid, p_dpa_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.restaurant_status;
  v_missing text[];
begin
  if not public.has_role(p_restaurant_id, '{admin}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select r.status into v_status from public.restaurants r where r.id = p_restaurant_id for update;
  if v_status = 'active' then
    raise exception 'ALREADY_PUBLISHED' using errcode = 'P0001';
  end if;
  -- Debe coincidir con DPA_VERSION de src/lib/legal/dpa.ts.
  if p_dpa_version is distinct from '2026-11-borrador' then
    raise exception 'DPA_VERSION' using errcode = '22023';
  end if;
  v_missing := public.restaurant_missing_fields(p_restaurant_id);
  if cardinality(v_missing) > 0 then
    raise exception 'MISSING_FIELDS' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
  end if;
  update public.restaurants
     set status = 'active', published_at = now(), dpa_accepted_at = now(),
         dpa_accepted_by = auth.uid(), dpa_version = p_dpa_version
   where id = p_restaurant_id;
  insert into public.admin_audit_log (actor_id, action, restaurant_id, details)
  values (auth.uid(), 'restaurant.publish', p_restaurant_id, jsonb_build_object('dpa_version', p_dpa_version));
end $$;

/** FByte ya no activa restaurantes sin contrato aceptado: publicar es cosa del restaurante. */
create or replace function public.set_restaurant_status(p_restaurant_id uuid, p_status public.restaurant_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dpa timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select r.dpa_accepted_at into v_dpa from public.restaurants r where r.id = p_restaurant_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_status = 'active' and v_dpa is null then
    raise exception 'DPA_REQUIRED' using errcode = 'P0001';
  end if;
  update public.restaurants set status = p_status where id = p_restaurant_id;
  insert into public.admin_audit_log (actor_id, action, restaurant_id, details)
  values (auth.uid(), 'restaurant.status', p_restaurant_id, jsonb_build_object('status', p_status));
end $$;

/**
 * Mini-web: datos públicos de un restaurante activo, {"redirect": "<slug>"} si es una dirección antigua,
 * o null. Nunca devuelve equipo, invitaciones, auditoría ni datos del contrato.
 */
create or replace function public.get_public_restaurant(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  r public.restaurants%rowtype;
  v_target text;
  v_today date;
begin
  select * into r from public.restaurants x where x.slug = v_slug and x.status = 'active';
  if not found then
    select x.slug into v_target
      from public.slug_redirects s join public.restaurants x on x.id = s.restaurant_id
     where s.old_slug = v_slug and x.status = 'active';
    if found then
      return jsonb_build_object('redirect', v_target);
    end if;
    return null;
  end if;
  v_today := (now() at time zone r.timezone)::date;
  return jsonb_build_object(
    'id', r.id,
    'slug', r.slug,
    'name', r.name,
    'timezone', r.timezone,
    'enabled_locales', to_jsonb(r.enabled_locales),
    'cuisine', r.cuisine,
    'price_range', r.price_range,
    'address_line', r.address_line,
    'postal_code', r.postal_code,
    'city', r.city,
    'phone', r.phone,
    'contact_email', r.contact_email,
    'website', r.website,
    'instagram', r.instagram,
    'facebook', r.facebook,
    'tiktok', r.tiktok,
    'accent_color', r.accent_color,
    'logo_path', r.logo_path,
    'cover_path', r.cover_path,
    'legal_name', r.legal_name,
    'tax_id', r.tax_id,
    'descriptions', coalesce((
      select jsonb_object_agg(t.locale, t.description)
        from public.restaurant_translations t where t.restaurant_id = r.id
    ), '{}'::jsonb),
    'photos', coalesce((
      select jsonb_agg(p.path order by p.position, p.created_at)
        from public.restaurant_photos p where p.restaurant_id = r.id
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', s.name, 'weekday', s.weekday, 'start_minute', s.start_minute, 'end_minute', s.end_minute
             ) order by s.weekday, s.start_minute)
        from public.services s where s.restaurant_id = r.id
    ), '[]'::jsonb),
    -- Cierres y días especiales que no han terminado, de los próximos 90 días (fechas en la zona del restaurante).
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date_from', e.date_from, 'date_to', e.date_to, 'kind', e.kind,
               'custom_services', e.custom_services, 'note', e.note
             ) order by e.date_from)
        from public.schedule_exceptions e
       where e.restaurant_id = r.id and e.date_to >= v_today and e.date_from <= v_today + 90
    ), '[]'::jsonb)
  );
end $$;

/** Para sitemap.xml: restaurantes activos. */
create or replace function public.list_public_slugs()
returns table (slug text, enabled_locales text[], updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.slug, r.enabled_locales, r.updated_at from public.restaurants r where r.status = 'active' order by r.slug
$$;

revoke execute on function public.restaurant_missing_fields(uuid), public.publish_restaurant(uuid, text),
  public.get_public_restaurant(text), public.list_public_slugs()
  from public, anon;
grant execute on function public.restaurant_missing_fields(uuid), public.publish_restaurant(uuid, text)
  to authenticated;
grant execute on function public.get_public_restaurant(text), public.list_public_slugs() to anon, authenticated;
```

`create or replace function public.set_restaurant_status` conserva los permisos que le dio el Hito 1 (no hace falta repetir los `grant`). El JSON de `get_public_restaurant` **no** lleva `status`, `published_at`, `dpa_*` ni `created_at`.

- [ ] **Step 6: Ejecutar todas las pruebas de BD**

Run: `pnpm test:db`
Expected: PASS — 6 archivos, **94** pruebas.

- [ ] **Step 7: Commit**

```bash
git add src/lib/legal/dpa.ts tests/db/helpers.ts tests/db/public.test.ts supabase/migrations/20261125000300_publicar.sql
git commit -m "BD: publicar con contrato aceptado y datos públicos de la mini-web"
```

---

### Task 4: Lógica pura: contraste, horarios, datos españoles y redes

**Files:**
- Create: `src/lib/color.ts`, `src/lib/schedule.ts`, `src/lib/spain.ts`, `src/lib/social.ts`
- Test: `src/lib/color.test.ts`, `src/lib/schedule.test.ts`, `src/lib/spain.test.ts`, `src/lib/social.test.ts`

**Interfaces:**
- Produces:
  - `color.ts`: `DEFAULT_ACCENT = '#17317F'`, `INK = '#0A1330'`, `WHITE = '#FFFFFF'`, `MIN_CONTRAST = 4.5`, `normalizeHex(input: string): string | null`, `relativeLuminance(hex: string): number`, `contrastRatio(a: string, b: string): number`, `readableTextOn(bg: string): '#0A1330' | '#FFFFFF'`, `type AccentTheme = { accent; onAccent; accentText; meetsAA: boolean }`, `accentTheme(input: string | null | undefined): AccentTheme`.
  - `schedule.ts`: `WEEKDAYS = [1..7] as const`, `type Weekday`, `WEEKDAY_LABELS_ES: Record<Weekday, string>`, `MINUTES_PER_DAY = 1440`, `MAX_END_MINUTE = 1800`, `type ServiceSlot = { id?: string; name: string; weekday: number; startMinute: number; endMinute: number }`, `type CustomService = { name; startMinute; endMinute }`, `type ScheduleException = { dateFrom: string; dateTo: string; kind: 'closed' | 'custom'; customServices: CustomService[]; note: string | null }`, `isWeekday(n)`, `minutesToTime(m): string`, `timeToMinutes(t): number | null`, `toServiceRange(start, end): { startMinute; endMinute } | null`, `formatRange(start, end): string` (con `–`), `findOverlap(existing: ServiceSlot[], candidate: ServiceSlot): ServiceSlot | null`, `groupByWeekday<T>(items: T[]): Record<Weekday, T[]>`, `todayInTimeZone(tz, now?): string` (AAAA-MM-DD), `formatDateEs(iso): string` (dd/mm/aaaa), `daysBetween(a, b): number`, `upcomingExceptions<T>(items: T[], today: string, limit = 6): T[]`.
  - `spain.ts`: `normalizeTaxId(s)`, `isValidTaxId(s)`, `isValidPostalCode(s)`, `normalizePhone(s)`, `isValidPhone(s)`, `formatPhone(s)`.
  - `social.ts`: `type SocialNetwork = 'instagram' | 'facebook' | 'tiktok'`, `normalizeSocial(network, input): string | null`, `normalizeWebsite(input): string | null`, `socialHandle(url): string`.

- [ ] **Step 1: Escribir las pruebas (fallan)**

Create `src/lib/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { accentTheme, contrastRatio, DEFAULT_ACCENT, INK, normalizeHex, readableTextOn, WHITE } from './color';

describe('normalizeHex', () => {
  it('acepta #RRGGBB con o sin almohadilla y lo pasa a mayúsculas', () => {
    expect(normalizeHex('#17317f')).toBe('#17317F');
    expect(normalizeHex(' ff7a1a ')).toBe('#FF7A1A');
  });

  it('rechaza lo que no es un color de 6 cifras', () => {
    for (const bad of ['#FFF', 'rojo', '#GGGGGG', '#1234567', '']) expect(normalizeHex(bad)).toBeNull();
  });
});

describe('contraste WCAG', () => {
  it('blanco sobre negro es 21:1 y un color consigo mismo 1:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#17317F', '#17317F')).toBeCloseTo(1, 5);
  });

  it('elige blanco sobre navy e ink sobre naranja y melocotón', () => {
    expect(readableTextOn('#17317F')).toBe(WHITE);
    expect(readableTextOn('#FF7A1A')).toBe(INK);
    expect(readableTextOn('#FFC48A')).toBe(INK);
  });
});

describe('accentTheme', () => {
  it('sin color usa el navy de FByte', () => {
    expect(accentTheme(null)).toEqual({ accent: DEFAULT_ACCENT, onAccent: WHITE, accentText: DEFAULT_ACCENT, meetsAA: true });
  });

  it('un acento claro se usa de fondo, pero los enlaces van en ink', () => {
    expect(accentTheme('#ffc48a')).toEqual({ accent: '#FFC48A', onAccent: INK, accentText: INK, meetsAA: true });
  });

  it('un gris medio no llega a 4,5:1 ni con ink ni con blanco', () => {
    expect(accentTheme('#7A7A7A').meetsAA).toBe(false);
  });
});
```

Create `src/lib/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  findOverlap,
  formatDateEs,
  formatRange,
  groupByWeekday,
  minutesToTime,
  timeToMinutes,
  todayInTimeZone,
  toServiceRange,
  upcomingExceptions,
  type ServiceSlot,
} from './schedule';

describe('minutos ↔ HH:MM', () => {
  it('convierte en los dos sentidos', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(785)).toBe('13:05');
    expect(minutesToTime(1439)).toBe('23:59');
    expect(timeToMinutes('13:05')).toBe(785);
    expect(timeToMinutes(' 00:00 ')).toBe(0);
  });

  it('pasada la medianoche muestra la hora del día siguiente', () => {
    expect(minutesToTime(1440)).toBe('00:00');
    expect(minutesToTime(1470)).toBe('00:30');
    expect(minutesToTime(1800)).toBe('06:00');
  });

  it('rechaza horas mal escritas', () => {
    for (const bad of ['24:00', '9:30', '12:60', 'mediodía', '']) expect(timeToMinutes(bad)).toBeNull();
  });
});

describe('toServiceRange', () => {
  it('un servicio normal', () => {
    expect(toServiceRange('13:00', '16:00')).toEqual({ startMinute: 780, endMinute: 960 });
  });

  it('una cena que acaba después de medianoche', () => {
    expect(toServiceRange('20:00', '00:30')).toEqual({ startMinute: 1200, endMinute: 1470 });
    expect(toServiceRange('22:00', '06:00')).toEqual({ startMinute: 1320, endMinute: 1800 });
  });

  it('rechaza horas iguales, finales después de las 06:00 y horas mal escritas', () => {
    expect(toServiceRange('13:00', '13:00')).toBeNull();
    expect(toServiceRange('22:00', '06:30')).toBeNull();
    expect(toServiceRange('13', '16:00')).toBeNull();
  });

  it('formatRange lo muestra con guion', () => {
    expect(formatRange(1200, 1470)).toBe('20:00–00:30');
  });
});

describe('findOverlap', () => {
  const comida: ServiceSlot = { id: 'a', name: 'Comida', weekday: 1, startMinute: 780, endMinute: 960 };

  it('detecta solapes el mismo día y permite que se toquen', () => {
    expect(findOverlap([comida], { name: 'X', weekday: 1, startMinute: 900, endMinute: 1000 })).toBe(comida);
    expect(findOverlap([comida], { name: 'X', weekday: 1, startMinute: 960, endMinute: 1000 })).toBeNull();
    expect(findOverlap([comida], { name: 'X', weekday: 2, startMinute: 780, endMinute: 960 })).toBeNull();
  });

  it('una cena que pasa de medianoche choca con un servicio de madrugada del día siguiente', () => {
    const cena: ServiceSlot = { name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1530 };
    expect(findOverlap([cena], { name: 'Madrugada', weekday: 6, startMinute: 0, endMinute: 120 })).toBe(cena);
    expect(findOverlap([cena], { name: 'Desayuno', weekday: 6, startMinute: 90, endMinute: 200 })).toBeNull();
  });

  it('el domingo por la noche choca con el lunes de madrugada', () => {
    const domingo: ServiceSlot = { name: 'Cena', weekday: 7, startMinute: 1380, endMinute: 1500 };
    expect(findOverlap([domingo], { name: 'X', weekday: 1, startMinute: 0, endMinute: 30 })).toBe(domingo);
  });

  it('al editar, no se compara consigo mismo', () => {
    expect(findOverlap([comida], { ...comida, endMinute: 990 })).toBeNull();
  });
});

describe('agrupar y fechas', () => {
  it('groupByWeekday ordena por hora', () => {
    const g = groupByWeekday([
      { weekday: 1, startMinute: 1200 },
      { weekday: 1, startMinute: 780 },
      { weekday: 3, startMinute: 600 },
    ]);
    expect(g[1].map((s) => s.startMinute)).toEqual([780, 1200]);
    expect(g[3]).toHaveLength(1);
    expect(g[7]).toEqual([]);
  });

  it('todayInTimeZone usa la zona del restaurante', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(todayInTimeZone('Europe/Madrid', now)).toBe('2027-01-01');
    expect(todayInTimeZone('Atlantic/Canary', now)).toBe('2026-12-31');
  });

  it('formatDateEs y daysBetween', () => {
    expect(formatDateEs('2026-12-24')).toBe('24/12/2026');
    expect(daysBetween('2026-12-24', '2026-12-26')).toBe(2);
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2);
  });

  it('upcomingExceptions quita lo pasado y ordena', () => {
    const list = [
      { dateFrom: '2026-12-31', dateTo: '2026-12-31' },
      { dateFrom: '2026-11-01', dateTo: '2026-11-02' },
      { dateFrom: '2026-11-24', dateTo: '2026-11-26' },
    ];
    expect(upcomingExceptions(list, '2026-11-25').map((e) => e.dateFrom)).toEqual(['2026-11-24', '2026-12-31']);
  });
});
```

Create `src/lib/spain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPhone, isValidPhone, isValidPostalCode, isValidTaxId, normalizePhone, normalizeTaxId } from './spain';

describe('CIF, NIF y NIE', () => {
  it('acepta documentos con el control correcto', () => {
    for (const ok of ['12345678Z', 'X1234567L', 'Y1234567X', 'Z1234567R', 'B12345674', 'A28015865', 'Q1234567D', 'G12345674', 'G1234567D', 'K1234567L']) {
      expect(isValidTaxId(ok), ok).toBe(true);
    }
  });

  it('rechaza controles incorrectos y formatos raros', () => {
    for (const bad of ['12345678A', 'X1234567A', 'B12345675', 'B1234567D', 'Q12345674', '1234567Z', 'I12345674', '']) {
      expect(isValidTaxId(bad), bad).toBe(false);
    }
  });

  it('normaliza espacios, puntos, guiones y minúsculas', () => {
    expect(normalizeTaxId(' b-12.345.674 ')).toBe('B12345674');
    expect(isValidTaxId('12.345.678-z')).toBe(true);
  });
});

describe('código postal', () => {
  it('5 cifras con provincia 01–52', () => {
    expect(isValidPostalCode('28013')).toBe(true);
    expect(isValidPostalCode('07001')).toBe(true);
    expect(isValidPostalCode('52001')).toBe(true);
    for (const bad of ['00123', '53001', '2801', '280130', 'abcde']) expect(isValidPostalCode(bad), bad).toBe(false);
  });
});

describe('teléfono', () => {
  it('normaliza y valida', () => {
    expect(normalizePhone('910 00 00 00')).toBe('910000000');
    expect(normalizePhone('0034 (910) 000-000')).toBe('+34910000000');
    expect(isValidPhone('+34 600 11 22 33')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
  });

  it('formatea los números españoles de 9 cifras', () => {
    expect(formatPhone('910000000')).toBe('910 000 000');
    expect(formatPhone('+34600112233')).toBe('+34 600 112 233');
    expect(formatPhone('+4930123456')).toBe('+4930123456');
  });
});
```

Create `src/lib/social.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeSocial, normalizeWebsite, socialHandle } from './social';

describe('normalizeSocial', () => {
  it('Instagram: usuario, @usuario o enlace', () => {
    const want = 'https://www.instagram.com/la.taberna_pepe';
    for (const input of ['la.taberna_pepe', '@la.taberna_pepe', 'instagram.com/la.taberna_pepe/', 'https://www.instagram.com/la.taberna_pepe?igsh=abc']) {
      expect(normalizeSocial('instagram', input), input).toBe(want);
    }
  });

  it('TikTok siempre lleva @ en la URL', () => {
    expect(normalizeSocial('tiktok', 'pepebar')).toBe('https://www.tiktok.com/@pepebar');
    expect(normalizeSocial('tiktok', 'https://www.tiktok.com/@pepebar/video/123')).toBe('https://www.tiktok.com/@pepebar');
  });

  it('Facebook: página o perfil por id', () => {
    expect(normalizeSocial('facebook', 'm.facebook.com/Taberna-Pepe')).toBe('https://www.facebook.com/Taberna-Pepe');
    expect(normalizeSocial('facebook', 'https://www.facebook.com/profile.php?id=100064123456')).toBe(
      'https://www.facebook.com/profile.php?id=100064123456',
    );
  });

  it('rechaza otras webs y usuarios imposibles', () => {
    expect(normalizeSocial('instagram', 'https://twitter.com/pepe')).toBeNull();
    expect(normalizeSocial('instagram', 'pepe bar')).toBeNull();
    expect(normalizeSocial('tiktok', 'a')).toBeNull();
    expect(normalizeSocial('facebook', 'facebook.com/profile.php')).toBeNull();
    expect(normalizeSocial('instagram', '')).toBeNull();
  });
});

describe('normalizeWebsite', () => {
  it('añade https y pasa http a https', () => {
    expect(normalizeWebsite('pepe.es')).toBe('https://pepe.es');
    expect(normalizeWebsite('http://www.pepe.es/carta')).toBe('https://www.pepe.es/carta');
    expect(normalizeWebsite('https://pepe.es/')).toBe('https://pepe.es');
  });

  it('rechaza lo que no es una web', () => {
    for (const bad of ['pepe', 'ftp://pepe.es', 'https://user:pass@pepe.es', 'pepe .es', '']) {
      expect(normalizeWebsite(bad), bad).toBeNull();
    }
  });
});

it('socialHandle muestra el usuario', () => {
  expect(socialHandle('https://www.instagram.com/pepe')).toBe('@pepe');
  expect(socialHandle('https://www.tiktok.com/@pepe')).toBe('@pepe');
  expect(socialHandle('https://www.facebook.com/profile.php?id=123456')).toBe('Facebook');
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `pnpm test:unit`
Expected: FAIL — no se resuelven `./color`, `./schedule`, `./spain` ni `./social`.

- [ ] **Step 3: Implementar**

Create `src/lib/color.ts`:

```ts
export const DEFAULT_ACCENT = '#17317F';
export const INK = '#0A1330';
export const WHITE = '#FFFFFF';
/** Contraste mínimo WCAG AA para texto normal. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9A-F]{6}$/;

/** '#abc123', 'ABC123' → '#ABC123'. null si no es un color #RRGGBB. */
export function normalizeHex(input: string): string | null {
  const value = input.trim().toUpperCase();
  const withHash = value.startsWith('#') ? value : `#${value}`;
  return HEX.test(withHash) ? withHash : null;
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const color = normalizeHex(hex);
  if (!color) throw new Error(`Color no válido: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto sobre un fondo de color: ink o blanco, el que más contraste dé. */
export function readableTextOn(background: string): typeof INK | typeof WHITE {
  return contrastRatio(background, INK) >= contrastRatio(background, WHITE) ? INK : WHITE;
}

export type AccentTheme = {
  /** Fondo de los botones. */
  accent: string;
  /** Texto encima del acento (ink o blanco). */
  onAccent: string;
  /** Color para enlaces y títulos sobre blanco: el acento si contrasta lo bastante, si no, ink. */
  accentText: string;
  /** El texto sobre el acento llega a 4,5:1. */
  meetsAA: boolean;
};

export function accentTheme(input: string | null | undefined): AccentTheme {
  const accent = (input && normalizeHex(input)) || DEFAULT_ACCENT;
  const onAccent = readableTextOn(accent);
  return {
    accent,
    onAccent,
    accentText: contrastRatio(accent, WHITE) >= MIN_CONTRAST ? accent : INK,
    meetsAA: contrastRatio(accent, onAccent) >= MIN_CONTRAST,
  };
}
```

Create `src/lib/schedule.ts`:

```ts
/** Días ISO: 1 = lunes … 7 = domingo. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS_ES: Record<Weekday, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const MINUTES_PER_DAY = 1440;
/** Un servicio puede acabar como muy tarde a las 06:00 del día siguiente. */
export const MAX_END_MINUTE = 1800;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export type ServiceSlot = { id?: string; name: string; weekday: number; startMinute: number; endMinute: number };
export type CustomService = { name: string; startMinute: number; endMinute: number };
export type ScheduleException = {
  dateFrom: string;
  dateTo: string;
  kind: 'closed' | 'custom';
  customServices: CustomService[];
  note: string | null;
};

export function isWeekday(value: number): value is Weekday {
  return (WEEKDAYS as readonly number[]).includes(value);
}

/** 785 → '13:05'; 1470 → '00:30' (las horas de después de medianoche se muestran como del día siguiente). */
export function minutesToTime(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** '13:05' → 785. null si no es una hora HH:MM válida. */
export function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Horas del formulario → minutos. Si el fin es anterior al inicio, es del día siguiente:
 * '20:00'–'00:30' → 1200–1470. null si alguna hora no vale, si son iguales o si acaba después de las 06:00.
 */
export function toServiceRange(start: string, end: string): { startMinute: number; endMinute: number } | null {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null || s === e) return null;
  const endMinute = e < s ? e + MINUTES_PER_DAY : e;
  if (endMinute > MAX_END_MINUTE) return null;
  return { startMinute: s, endMinute };
}

/** 1200, 1470 → '20:00–00:30'. */
export function formatRange(startMinute: number, endMinute: number): string {
  return `${minutesToTime(startMinute)}–${minutesToTime(endMinute)}`;
}

/** Primer servicio de la lista que se solapa con el candidato, contando lo que pasa de medianoche (también de domingo a lunes). */
export function findOverlap(existing: ServiceSlot[], candidate: ServiceSlot): ServiceSlot | null {
  const c0 = (candidate.weekday - 1) * MINUTES_PER_DAY + candidate.startMinute;
  const c1 = c0 + (candidate.endMinute - candidate.startMinute);
  for (const s of existing) {
    if (candidate.id && s.id === candidate.id) continue;
    const s0 = (s.weekday - 1) * MINUTES_PER_DAY + s.startMinute;
    const s1 = s0 + (s.endMinute - s.startMinute);
    for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
      if (c0 < s1 + shift && s0 + shift < c1) return s;
    }
  }
  return null;
}

/** Agrupa por día de la semana y ordena por hora de inicio. */
export function groupByWeekday<T extends { weekday: number; startMinute: number }>(items: T[]): Record<Weekday, T[]> {
  const out = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] } as Record<Weekday, T[]>;
  for (const item of items) if (isWeekday(item.weekday)) out[item.weekday].push(item);
  for (const day of WEEKDAYS) out[day].sort((a, b) => a.startMinute - b.startMinute);
  return out;
}

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria del restaurante. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** '2026-12-24' → '24/12/2026'. */
export function formatDateEs(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Cierres que no han terminado, por orden de inicio. */
export function upcomingExceptions<T extends { dateFrom: string; dateTo: string }>(items: T[], today: string, limit = 6): T[] {
  return items
    .filter((e) => e.dateTo >= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
    .slice(0, limit);
}
```

Create `src/lib/spain.ts`:

```ts
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';

/** ' b-12.345.674 ' → 'B12345674'. */
export function normalizeTaxId(input: string): string {
  return input.toUpperCase().replace(/[\s.-]/g, '');
}

function cifControlOk(type: string, digits: string, control: string): boolean {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const doubled = d * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += d;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = CIF_LETTERS[digit];
  if ('PQRSNW'.includes(type)) return control === letter;
  if ('ABEH'.includes(type)) return control === String(digit);
  return control === String(digit) || control === letter;
}

/** NIF (DNI), NIE (X/Y/Z), NIF especiales (K/L/M) y CIF, con su dígito o letra de control. */
export function isValidTaxId(input: string): boolean {
  const v = normalizeTaxId(input);
  let m: RegExpExecArray | null;
  if ((m = /^(\d{8})([A-Z])$/.exec(v))) return DNI_LETTERS[Number(m[1]) % 23] === m[2];
  if ((m = /^([XYZ])(\d{7})([A-Z])$/.exec(v))) return DNI_LETTERS[Number(`${'XYZ'.indexOf(m[1])}${m[2]}`) % 23] === m[3];
  if ((m = /^([KLM])(\d{7})([A-Z])$/.exec(v))) return DNI_LETTERS[Number(m[2]) % 23] === m[3];
  if ((m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v))) return cifControlOk(m[1], m[2], m[3]);
  return false;
}

/** 5 cifras y una provincia que existe (01–52). */
export function isValidPostalCode(input: string): boolean {
  return /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(input.trim());
}

/** Quita espacios, puntos, guiones y paréntesis; '0034…' → '+34…'. */
export function normalizePhone(input: string): string {
  const v = input.trim().replace(/[\s.()-]/g, '');
  return v.startsWith('00') ? `+${v.slice(2)}` : v;
}

export function isValidPhone(input: string): boolean {
  return /^\+?\d{9,15}$/.test(normalizePhone(input));
}

/** '910000000' → '910 000 000'; '+34910000000' → '+34 910 000 000'. */
export function formatPhone(phone: string): string {
  const m = /^(\+34)?(\d{3})(\d{3})(\d{3})$/.exec(phone);
  if (!m) return phone;
  return `${m[1] ? `${m[1]} ` : ''}${m[2]} ${m[3]} ${m[4]}`;
}
```

Create `src/lib/social.ts`:

```ts
export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok';

const RULES: Record<SocialNetwork, { hosts: string[]; base: string; handle: RegExp; at: boolean }> = {
  instagram: {
    hosts: ['instagram.com', 'www.instagram.com', 'm.instagram.com'],
    base: 'https://www.instagram.com/',
    handle: /^[A-Za-z0-9._]{1,30}$/,
    at: false,
  },
  facebook: {
    hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'es-es.facebook.com', 'fb.com', 'www.fb.com'],
    base: 'https://www.facebook.com/',
    handle: /^[A-Za-z0-9.-]{2,100}$/,
    at: false,
  },
  tiktok: {
    hosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
    base: 'https://www.tiktok.com/',
    handle: /^[A-Za-z0-9._]{2,24}$/,
    at: true,
  },
};

/**
 * '@pepe', 'pepe', 'instagram.com/pepe/', 'https://www.instagram.com/pepe?igsh=x' → 'https://www.instagram.com/pepe'.
 * Facebook admite también 'profile.php?id=123'. null si no se reconoce (llámala con texto no vacío).
 */
export function normalizeSocial(network: SocialNetwork, input: string): string | null {
  const rule = RULES[network];
  const value = input.trim();
  if (!value) return null;
  let handle: string;
  if (/^https?:\/\//i.test(value) || value.includes('/')) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (!rule.hosts.includes(url.hostname.toLowerCase())) return null;
    const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
    if (network === 'facebook' && segment === 'profile.php') {
      const id = url.searchParams.get('id');
      return id && /^\d{5,20}$/.test(id) ? `${rule.base}profile.php?id=${id}` : null;
    }
    handle = decodeURIComponent(segment);
  } else {
    handle = value;
  }
  handle = handle.replace(/^@/, '');
  if (!rule.handle.test(handle)) return null;
  return `${rule.base}${rule.at ? '@' : ''}${handle}`;
}

/** 'pepe.es' → 'https://pepe.es'; 'http://…' se pasa a https. null si no es una web válida. */
export function normalizeWebsite(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value.replace(/^http:\/\//i, 'https://') : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
  const out = url.pathname === '/' && !url.search && !url.hash ? url.origin : url.toString();
  return out.length <= 300 ? out : null;
}

/** Para mostrar: 'https://www.instagram.com/pepe' → '@pepe'. */
export function socialHandle(url: string): string {
  const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'profile.php') return 'Facebook';
  return path.startsWith('@') ? path : `@${path}`;
}
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `pnpm test:unit`
Expected: PASS (todas las suites, incluidas las cuatro nuevas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/lib/color.test.ts src/lib/schedule.ts src/lib/schedule.test.ts src/lib/spain.ts src/lib/spain.test.ts src/lib/social.ts src/lib/social.test.ts
git commit -m "Lógica pura: contraste del acento, horarios, CIF y redes sociales"
```

---

### Task 5: Idiomas de la mini-web: resolución y mensajes en seis idiomas

**Files:**
- Create: `src/lib/i18n/locales.ts`, `src/lib/i18n/messages.ts`
- Test: `src/lib/i18n/locales.test.ts`, `src/lib/i18n/messages.test.ts`

**Interfaces:**
- Consumes: `BRAND.poweredBy`, `BRAND.productName`, `BRAND.company`.
- Produces:
  - `locales.ts`: `LOCALES = ['es','en','ca','fr','de','it'] as const`, `type Locale`, `DEFAULT_LOCALE: Locale = 'es'`, `LOCALE_NAMES` (endónimos), `LOCALE_LABELS_ES` (para el panel), `isLocale(v): v is Locale`, `sortLocales(values: readonly string[]): Locale[]`, `parseAcceptLanguage(header): string[]`, `resolveLocale({ lang?, acceptLanguage?, enabled }): Locale`.
  - `messages.ts`: `type PublicMessages` (claves: `directions`, `viewMap`, `mapNotice`, `mapTitle(name)`, `about`, `gallery`, `hours`, `closed`, `noHours`, `weekdays` [7], `upcoming`, `closedOn(from, to)`, `specialOn(from, to)`, `contact`, `address`, `phone`, `call`, `email`, `website`, `social`, `language`, `price`, `legalNotice`, `legalSpanishOnly`, `backToRestaurant`, `poweredBy(product, company)`, `logoAlt(name)`, `coverAlt(name)`, `photoAlt(name, n)`), `MESSAGES: Record<Locale, PublicMessages>`, `getMessages(locale)`.

- [ ] **Step 1: Escribir las pruebas (fallan)**

Create `src/lib/i18n/locales.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isLocale, parseAcceptLanguage, resolveLocale, sortLocales } from './locales';

describe('parseAcceptLanguage', () => {
  it('ordena por calidad y respeta el orden ante empates', () => {
    expect(parseAcceptLanguage('fr;q=0.5, ca-ES, en;q=0.8, de')).toEqual(['ca-es', 'de', 'en', 'fr']);
  });

  it('ignora comodines, calidades 0 y cabeceras vacías', () => {
    expect(parseAcceptLanguage('*, en;q=0, it;q=abc')).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe('resolveLocale', () => {
  const enabled = ['es', 'en', 'ca'];

  it('?lang= manda si el idioma está activo', () => {
    expect(resolveLocale({ lang: 'EN', acceptLanguage: 'ca', enabled })).toBe('en');
  });

  it('?lang= de un idioma no activo se ignora', () => {
    expect(resolveLocale({ lang: 'fr', acceptLanguage: 'ca-ES', enabled })).toBe('ca');
    expect(resolveLocale({ lang: 'xx', acceptLanguage: null, enabled })).toBe('es');
  });

  it('usa el primer idioma del navegador que esté activo', () => {
    expect(resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9,en-GB;q=0.8', enabled })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'ca-ES-valencia', enabled })).toBe('ca');
  });

  it('el respaldo es el castellano', () => {
    expect(resolveLocale({ acceptLanguage: 'ja', enabled })).toBe('es');
    expect(resolveLocale({ enabled: ['es'] })).toBe('es');
  });
});

it('isLocale y sortLocales', () => {
  expect(isLocale('ca')).toBe(true);
  expect(isLocale('pt')).toBe(false);
  expect(sortLocales(['it', 'pt', 'es', 'it', 'en'])).toEqual(['es', 'en', 'it']);
});
```

Create `src/lib/i18n/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LOCALES } from './locales';
import { getMessages, MESSAGES } from './messages';

describe('mensajes de la mini-web', () => {
  it('hay mensajes para los seis idiomas, con siete días y sin textos vacíos', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      const m = getMessages(locale);
      expect(m.weekdays, locale).toHaveLength(7);
      for (const [key, value] of Object.entries(m)) {
        if (key === 'legalSpanishOnly' && locale === 'es') continue;
        if (typeof value === 'string') expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('los textos con datos los incluyen', () => {
    expect(getMessages('es').closedOn('24/12/2026', '26/12/2026')).toBe('Cerrado del 24/12/2026 al 26/12/2026');
    expect(getMessages('es').closedOn('24/12/2026', '24/12/2026')).toBe('Cerrado el 24/12/2026');
    expect(getMessages('en').specialOn('31/12/2026', '31/12/2026')).toBe('Special hours on 31/12/2026');
    expect(getMessages('ca').poweredBy('Mesa', 'FByte Solutions')).toBe('Reserves i carta amb Mesa · FByte Solutions');
    expect(getMessages('es').poweredBy('Mesa', 'FByte Solutions')).toBe('Reservas y menú con Mesa · FByte Solutions');
  });

  it('el pie en castellano coincide con el de la marca', async () => {
    const { BRAND } = await import('@/config/brand');
    expect(getMessages('es').poweredBy(BRAND.productName, BRAND.company)).toBe(BRAND.poweredBy);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `pnpm test:unit src/lib/i18n`
Expected: FAIL — no se resuelven `./locales` ni `./messages`.

- [ ] **Step 3: Implementar la resolución del idioma**

Create `src/lib/i18n/locales.ts`:

```ts
export const LOCALES = ['es', 'en', 'ca', 'fr', 'de', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
/** El castellano siempre está activo y es el idioma de respaldo. */
export const DEFAULT_LOCALE: Locale = 'es';

/** Nombre de cada idioma en ese idioma (selector de la mini-web). */
export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  ca: 'Català',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
};

/** Nombre en castellano (panel). */
export const LOCALE_LABELS_ES: Record<Locale, string> = {
  es: 'Castellano',
  en: 'Inglés',
  ca: 'Catalán',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Quita lo desconocido y los repetidos, y ordena como LOCALES (castellano primero). */
export function sortLocales(values: readonly string[]): Locale[] {
  return LOCALES.filter((l) => values.includes(l));
}

/** 'ca-ES,ca;q=0.9,en;q=0.5' → ['ca-es', 'ca', 'en'] por preferencia. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((x) => x.tag !== '' && x.tag !== '*' && x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((x) => x.tag);
}

/**
 * Idioma de la mini-web: ?lang= si está activo; si no, el primero del navegador que esté activo;
 * si no, castellano. Sin cookies.
 */
export function resolveLocale(input: {
  lang?: string | null;
  acceptLanguage?: string | null;
  enabled: readonly string[];
}): Locale {
  const enabled = sortLocales(input.enabled);
  const lang = input.lang?.trim().toLowerCase();
  if (isLocale(lang) && enabled.includes(lang)) return lang;
  for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
    const base = tag.split('-')[0];
    if (isLocale(base) && enabled.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}
```

- [ ] **Step 4: Escribir los mensajes (todos los idiomas, completos)**

Create `src/lib/i18n/messages.ts`:

```ts
import type { Locale } from './locales';

/** Textos de la interfaz pública (mini-web). Los textos del restaurante los escribe el restaurante. */
export type PublicMessages = {
  directions: string;
  viewMap: string;
  mapNotice: string;
  mapTitle: (name: string) => string;
  about: string;
  gallery: string;
  hours: string;
  closed: string;
  noHours: string;
  /** Lunes … domingo. */
  weekdays: readonly [string, string, string, string, string, string, string];
  upcoming: string;
  closedOn: (from: string, to: string) => string;
  specialOn: (from: string, to: string) => string;
  contact: string;
  address: string;
  phone: string;
  call: string;
  email: string;
  website: string;
  social: string;
  language: string;
  price: string;
  legalNotice: string;
  legalSpanishOnly: string;
  backToRestaurant: string;
  poweredBy: (product: string, company: string) => string;
  logoAlt: (name: string) => string;
  coverAlt: (name: string) => string;
  photoAlt: (name: string, n: number) => string;
};

const es: PublicMessages = {
  directions: 'Cómo llegar',
  viewMap: 'Ver mapa',
  mapNotice: 'El mapa lo carga Google Maps, que puede usar cookies.',
  mapTitle: (name) => `Mapa de ${name}`,
  about: 'Sobre nosotros',
  gallery: 'Fotos',
  hours: 'Horario',
  closed: 'Cerrado',
  noHours: 'Consulta el horario con el restaurante.',
  weekdays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
  upcoming: 'Próximos cierres y horarios especiales',
  closedOn: (from, to) => (from === to ? `Cerrado el ${from}` : `Cerrado del ${from} al ${to}`),
  specialOn: (from, to) => (from === to ? `Horario especial el ${from}` : `Horario especial del ${from} al ${to}`),
  contact: 'Contacto',
  address: 'Dirección',
  phone: 'Teléfono',
  call: 'Llamar',
  email: 'Email',
  website: 'Web',
  social: 'Síguenos',
  language: 'Idioma',
  price: 'Precio',
  legalNotice: 'Aviso legal',
  legalSpanishOnly: '',
  backToRestaurant: 'Volver a la web del restaurante',
  poweredBy: (product, company) => `Reservas y menú con ${product} · ${company}`,
  logoAlt: (name) => `Logo de ${name}`,
  coverAlt: (name) => `Foto de ${name}`,
  photoAlt: (name, n) => `Foto ${n} de ${name}`,
};

const en: PublicMessages = {
  directions: 'Get directions',
  viewMap: 'Show map',
  mapNotice: 'The map is loaded from Google Maps, which may use cookies.',
  mapTitle: (name) => `Map of ${name}`,
  about: 'About us',
  gallery: 'Photos',
  hours: 'Opening hours',
  closed: 'Closed',
  noHours: 'Please ask the restaurant for its opening hours.',
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  upcoming: 'Upcoming closures and special hours',
  closedOn: (from, to) => (from === to ? `Closed on ${from}` : `Closed from ${from} to ${to}`),
  specialOn: (from, to) => (from === to ? `Special hours on ${from}` : `Special hours from ${from} to ${to}`),
  contact: 'Contact',
  address: 'Address',
  phone: 'Phone',
  call: 'Call',
  email: 'Email',
  website: 'Website',
  social: 'Follow us',
  language: 'Language',
  price: 'Price',
  legalNotice: 'Legal notice',
  legalSpanishOnly: 'This legal notice is only available in Spanish.',
  backToRestaurant: 'Back to the restaurant',
  poweredBy: (product, company) => `Bookings and menu by ${product} · ${company}`,
  logoAlt: (name) => `${name} logo`,
  coverAlt: (name) => `Photo of ${name}`,
  photoAlt: (name, n) => `Photo ${n} of ${name}`,
};

const ca: PublicMessages = {
  directions: 'Com arribar-hi',
  viewMap: 'Veure el mapa',
  mapNotice: 'El mapa el carrega Google Maps, que pot fer servir galetes.',
  mapTitle: (name) => `Mapa de ${name}`,
  about: 'Qui som',
  gallery: 'Fotos',
  hours: 'Horari',
  closed: 'Tancat',
  noHours: 'Consulta l’horari amb el restaurant.',
  weekdays: ['Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte', 'Diumenge'],
  upcoming: 'Propers tancaments i horaris especials',
  closedOn: (from, to) => (from === to ? `Tancat el ${from}` : `Tancat del ${from} al ${to}`),
  specialOn: (from, to) => (from === to ? `Horari especial el ${from}` : `Horari especial del ${from} al ${to}`),
  contact: 'Contacte',
  address: 'Adreça',
  phone: 'Telèfon',
  call: 'Trucar',
  email: 'Correu electrònic',
  website: 'Web',
  social: 'Segueix-nos',
  language: 'Idioma',
  price: 'Preu',
  legalNotice: 'Avís legal',
  legalSpanishOnly: 'Aquest avís legal només està disponible en castellà.',
  backToRestaurant: 'Tornar al web del restaurant',
  poweredBy: (product, company) => `Reserves i carta amb ${product} · ${company}`,
  logoAlt: (name) => `Logotip de ${name}`,
  coverAlt: (name) => `Foto de ${name}`,
  photoAlt: (name, n) => `Foto ${n} de ${name}`,
};

const fr: PublicMessages = {
  directions: 'Itinéraire',
  viewMap: 'Voir la carte',
  mapNotice: 'La carte est chargée depuis Google Maps, qui peut utiliser des cookies.',
  mapTitle: (name) => `Carte de ${name}`,
  about: 'À propos',
  gallery: 'Photos',
  hours: 'Horaires',
  closed: 'Fermé',
  noHours: 'Renseignez-vous auprès du restaurant pour les horaires.',
  weekdays: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  upcoming: 'Prochaines fermetures et horaires spéciaux',
  closedOn: (from, to) => (from === to ? `Fermé le ${from}` : `Fermé du ${from} au ${to}`),
  specialOn: (from, to) => (from === to ? `Horaires spéciaux le ${from}` : `Horaires spéciaux du ${from} au ${to}`),
  contact: 'Contact',
  address: 'Adresse',
  phone: 'Téléphone',
  call: 'Appeler',
  email: 'E-mail',
  website: 'Site web',
  social: 'Suivez-nous',
  language: 'Langue',
  price: 'Prix',
  legalNotice: 'Mentions légales',
  legalSpanishOnly: 'Ces mentions légales ne sont disponibles qu’en espagnol.',
  backToRestaurant: 'Retour au restaurant',
  poweredBy: (product, company) => `Réservations et menu avec ${product} · ${company}`,
  logoAlt: (name) => `Logo de ${name}`,
  coverAlt: (name) => `Photo de ${name}`,
  photoAlt: (name, n) => `Photo ${n} de ${name}`,
};

const de: PublicMessages = {
  directions: 'Route planen',
  viewMap: 'Karte anzeigen',
  mapNotice: 'Die Karte wird von Google Maps geladen, das Cookies verwenden kann.',
  mapTitle: (name) => `Karte von ${name}`,
  about: 'Über uns',
  gallery: 'Fotos',
  hours: 'Öffnungszeiten',
  closed: 'Geschlossen',
  noHours: 'Bitte fragen Sie das Restaurant nach den Öffnungszeiten.',
  weekdays: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  upcoming: 'Kommende Schließtage und Sonderöffnungszeiten',
  closedOn: (from, to) => (from === to ? `Geschlossen am ${from}` : `Geschlossen vom ${from} bis ${to}`),
  specialOn: (from, to) => (from === to ? `Sonderöffnungszeiten am ${from}` : `Sonderöffnungszeiten vom ${from} bis ${to}`),
  contact: 'Kontakt',
  address: 'Adresse',
  phone: 'Telefon',
  call: 'Anrufen',
  email: 'E-Mail',
  website: 'Website',
  social: 'Folgen Sie uns',
  language: 'Sprache',
  price: 'Preis',
  legalNotice: 'Impressum',
  legalSpanishOnly: 'Dieses Impressum ist nur auf Spanisch verfügbar.',
  backToRestaurant: 'Zurück zum Restaurant',
  poweredBy: (product, company) => `Reservierungen und Speisekarte mit ${product} · ${company}`,
  logoAlt: (name) => `Logo von ${name}`,
  coverAlt: (name) => `Foto von ${name}`,
  photoAlt: (name, n) => `Foto ${n} von ${name}`,
};

const it: PublicMessages = {
  directions: 'Indicazioni',
  viewMap: 'Mostra la mappa',
  mapNotice: 'La mappa viene caricata da Google Maps, che può usare cookie.',
  mapTitle: (name) => `Mappa di ${name}`,
  about: 'Chi siamo',
  gallery: 'Foto',
  hours: 'Orari',
  closed: 'Chiuso',
  noHours: 'Chiedi gli orari al ristorante.',
  weekdays: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
  upcoming: 'Prossime chiusure e orari speciali',
  closedOn: (from, to) => (from === to ? `Chiuso il ${from}` : `Chiuso dal ${from} al ${to}`),
  specialOn: (from, to) => (from === to ? `Orario speciale il ${from}` : `Orario speciale dal ${from} al ${to}`),
  contact: 'Contatti',
  address: 'Indirizzo',
  phone: 'Telefono',
  call: 'Chiama',
  email: 'Email',
  website: 'Sito web',
  social: 'Seguici',
  language: 'Lingua',
  price: 'Prezzo',
  legalNotice: 'Note legali',
  legalSpanishOnly: 'Queste note legali sono disponibili solo in spagnolo.',
  backToRestaurant: 'Torna al ristorante',
  poweredBy: (product, company) => `Prenotazioni e menù con ${product} · ${company}`,
  logoAlt: (name) => `Logo di ${name}`,
  coverAlt: (name) => `Foto di ${name}`,
  photoAlt: (name, n) => `Foto ${n} di ${name}`,
};

export const MESSAGES: Record<Locale, PublicMessages> = { es, en, ca, fr, de, it };

export function getMessages(locale: Locale): PublicMessages {
  return MESSAGES[locale];
}
```

- [ ] **Step 5: Ejecutar las pruebas**

Run: `pnpm test:unit src/lib/i18n`
Expected: PASS (`locales.test.ts` y `messages.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n
git commit -m "Idiomas de la mini-web: ?lang, Accept-Language y textos en seis idiomas"
```

---

### Task 6: Imágenes: rutas del bucket y compresión en el navegador

**Files:**
- Create: `src/lib/media.ts`, `src/lib/images/compress.ts`
- Test: `src/lib/media.test.ts`, `src/lib/images/compress.test.ts`

**Interfaces:**
- Produces:
  - `media.ts`: `MEDIA_BUCKET = 'restaurant-media'`, `MEDIA_KINDS = ['logo','cover','gallery'] as const`, `type MediaKind`, `UPLOAD_TYPES = ['image/webp','image/jpeg']`, `MAX_UPLOAD_BYTES = 2097152`, `MAX_GALLERY_PHOTOS = 12`, `isMediaKind(v)`, `extensionFor(mime): 'webp' | 'jpg' | null`, `mediaPath(restaurantId, kind, ext, id): string`, `isRestaurantMediaPath(restaurantId, path): boolean`, `publicMediaUrl(supabaseUrl, path): string`, `checkUpload({ type, size }): string | null`.
  - `images/compress.ts`: `MAX_SIDE: Record<MediaKind, number>` (512 / 1920 / 1600), `ACCEPTED_SOURCE_TYPES`, `MAX_SOURCE_BYTES` (20 MB), `QUALITY_STEPS = [0.82, 0.72, 0.62]`, `fitWithin(w, h, maxSide): { width; height }`, `checkSourceFile({ type, size }): string | null`, `compressImage(file: File, kind: MediaKind): Promise<Blob>` (solo navegador; lanza `IMAGE_TOO_BIG` o `IMAGE_ENCODE_FAILED`).

- [ ] **Step 1: Escribir las pruebas (fallan)**

Create `src/lib/media.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkUpload, extensionFor, isMediaKind, isRestaurantMediaPath, mediaPath, publicMediaUrl } from './media';

const rid = '11111111-1111-4111-8111-111111111111';
const fid = '22222222-2222-4222-8222-222222222222';

describe('rutas de Storage', () => {
  it('mediaPath sigue el formato del bucket', () => {
    expect(mediaPath(rid, 'logo', 'webp', fid)).toBe(`${rid}/logo-${fid}.webp`);
    expect(mediaPath(rid, 'cover', 'jpg', fid)).toBe(`${rid}/cover-${fid}.jpg`);
    expect(mediaPath(rid, 'gallery', 'webp', fid)).toBe(`${rid}/gallery/${fid}.webp`);
  });

  it('isRestaurantMediaPath acepta solo rutas de ese restaurante', () => {
    expect(isRestaurantMediaPath(rid, mediaPath(rid, 'gallery', 'webp', fid))).toBe(true);
    expect(isRestaurantMediaPath(rid, `${fid}/logo-x.webp`)).toBe(false);
    expect(isRestaurantMediaPath(rid, `${rid}/logo-x.png`)).toBe(false);
    expect(isRestaurantMediaPath(rid, `${rid}/otra/x.webp`)).toBe(false);
    expect(isRestaurantMediaPath('no-uuid', 'no-uuid/logo-x.webp')).toBe(false);
  });

  it('publicMediaUrl apunta al bucket público', () => {
    expect(publicMediaUrl('https://abc.supabase.co/', `${rid}/logo-x.webp`)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/restaurant-media/${rid}/logo-x.webp`,
    );
  });
});

describe('subidas', () => {
  it('extensionFor e isMediaKind', () => {
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBeNull();
    expect(isMediaKind('cover')).toBe(true);
    expect(isMediaKind('avatar')).toBe(false);
  });

  it('checkUpload rechaza formatos, vacíos y archivos de más de 2 MB', () => {
    expect(checkUpload({ type: 'image/webp', size: 300_000 })).toBeNull();
    expect(checkUpload({ type: 'image/png', size: 300_000 })).toBe('Ese formato de imagen no vale. Usa JPG, PNG o WebP.');
    expect(checkUpload({ type: 'image/jpeg', size: 0 })).toBe('La imagen está vacía. Prueba con otra.');
    expect(checkUpload({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toBe('La imagen pesa demasiado. Prueba con otra más pequeña.');
  });
});
```

Create `src/lib/images/compress.test.ts` (solo la parte pura; `compressImage` usa canvas y se prueba a mano en el navegador, ver la lista final):

```ts
import { describe, expect, it } from 'vitest';
import { checkSourceFile, fitWithin, MAX_SIDE } from './compress';

describe('fitWithin', () => {
  it('reduce manteniendo la proporción', () => {
    expect(fitWithin(4000, 3000, MAX_SIDE.cover)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000, MAX_SIDE.gallery)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(1024, 1024, MAX_SIDE.logo)).toEqual({ width: 512, height: 512 });
  });

  it('nunca agranda ni deja lados de 0 px', () => {
    expect(fitWithin(300, 200, MAX_SIDE.cover)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(10000, 1, MAX_SIDE.logo)).toEqual({ width: 512, height: 1 });
  });

  it('falla con tamaños imposibles', () => {
    expect(() => fitWithin(0, 100, 512)).toThrow();
  });
});

describe('checkSourceFile', () => {
  it('acepta JPEG, PNG y WebP de hasta 20 MB', () => {
    expect(checkSourceFile({ type: 'image/png', size: 5_000_000 })).toBeNull();
    expect(checkSourceFile({ type: 'image/gif', size: 1000 })).toBe('Ese formato no vale. Sube una foto JPG, PNG o WebP.');
    expect(checkSourceFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 })).toBe('La foto pesa más de 20 MB. Prueba con otra.');
  });
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `pnpm test:unit src/lib/media.test.ts src/lib/images`
Expected: FAIL — no se resuelven `./media` ni `./compress`.

- [ ] **Step 3: Implementar**

Create `src/lib/media.ts`:

```ts
export const MEDIA_BUCKET = 'restaurant-media';
export const MEDIA_KINDS = ['logo', 'cover', 'gallery'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Lo que llega al servidor: el navegador ya lo ha pasado a WebP (o JPEG si no sabe hacer WebP). */
export const UPLOAD_TYPES = ['image/webp', 'image/jpeg'] as const;
/** Igual que file_size_limit del bucket. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_GALLERY_PHOTOS = 12;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

export function extensionFor(mime: string): 'webp' | 'jpg' | null {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return null;
}

/** {restaurante}/logo-{id}.webp, {restaurante}/cover-{id}.webp o {restaurante}/gallery/{id}.webp. */
export function mediaPath(restaurantId: string, kind: MediaKind, ext: 'webp' | 'jpg', id: string): string {
  return kind === 'gallery' ? `${restaurantId}/gallery/${id}.${ext}` : `${restaurantId}/${kind}-${id}.${ext}`;
}

/** Misma regla que la RLS de Storage (public.can_manage_media) y los CHECK de la BD. */
export function isRestaurantMediaPath(restaurantId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(restaurantId)) return false;
  return new RegExp(`^${restaurantId}/(logo-[a-z0-9-]+|cover-[a-z0-9-]+|gallery/[a-z0-9-]+)\\.(webp|jpg)$`).test(path);
}

export function publicMediaUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Comprobación en el servidor del archivo ya comprimido. null si vale. */
export function checkUpload(file: { type: string; size: number }): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return 'Ese formato de imagen no vale. Usa JPG, PNG o WebP.';
  if (file.size === 0) return 'La imagen está vacía. Prueba con otra.';
  if (file.size > MAX_UPLOAD_BYTES) return 'La imagen pesa demasiado. Prueba con otra más pequeña.';
  return null;
}
```

Create `src/lib/images/compress.ts` (no toca el DOM al importarse, así que se puede probar en Node):

```ts
import { MAX_UPLOAD_BYTES, type MediaKind } from '@/lib/media';

/** Lado mayor máximo tras reducir, en píxeles. */
export const MAX_SIDE: Record<MediaKind, number> = { logo: 512, cover: 1920, gallery: 1600 };
export const ACCEPTED_SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const QUALITY_STEPS = [0.82, 0.72, 0.62] as const;

/** Tamaño final manteniendo la proporción; nunca agranda. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error('Tamaño de imagen no válido');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Antes de comprimir: tipo y tamaño de la foto original. null si vale. */
export function checkSourceFile(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_SOURCE_TYPES as readonly string[]).includes(file.type)) return 'Ese formato no vale. Sube una foto JPG, PNG o WebP.';
  if (file.size > MAX_SOURCE_BYTES) return 'La foto pesa más de 20 MB. Prueba con otra.';
  return null;
}

/**
 * Solo navegador: reduce la foto y la pasa a WebP (calidad 0,82; baja si aún pesa más de 2 MB).
 * Si el navegador no sabe crear WebP, usa JPEG con fondo blanco.
 */
export async function compressImage(file: File, kind: MediaKind): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE[kind]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    let encoded = false;
    for (const type of ['image/webp', 'image/jpeg'] as const) {
      ctx.clearRect(0, 0, width, height);
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
        if (!blob || blob.type !== type) break;
        encoded = true;
        if (blob.size <= MAX_UPLOAD_BYTES) return blob;
      }
    }
    throw new Error(encoded ? 'IMAGE_TOO_BIG' : 'IMAGE_ENCODE_FAILED');
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `pnpm test:unit src/lib/media.test.ts src/lib/images`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media.ts src/lib/media.test.ts src/lib/images
git commit -m "Imágenes: rutas del bucket y reducción a WebP en el navegador"
```

---

### Task 7: Validación, errores de BD y navegación del panel

**Files:**
- Create: `src/lib/validation/local.ts`, `src/lib/validation/schedule.ts`
- Modify: `src/lib/forms.ts`, `src/lib/db-errors.ts`, `src/lib/panel-nav.ts`
- Test: `src/lib/validation/local.test.ts`, `src/lib/validation/schedule.test.ts`, `src/lib/forms.test.ts`, `src/lib/db-errors.test.ts`, `src/lib/panel-nav.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5; `slugSchema` de `src/lib/validation/schemas.ts`; `fieldErrorsFrom` y `FormState` de `src/lib/forms.ts`.
- Produces:
  - `forms.ts`: `formStrings<K extends string>(fd: FormData, keys: readonly K[]): Record<K, string>`.
  - `validation/local.ts`: `basicsSchema` (campos `name`, `cuisine`, `priceRange`, `timezone`, `description_es` … `description_it` → `{ name; cuisine: string | null; priceRange: number | null; timezone; description_xx: string }`), `contactSchema` (`addressLine`, `postalCode`, `city`, `phone`, `contactEmail`, `website`, todos `string | null`), `socialSchema` (`instagram`, `facebook`, `tiktok` → URL o `null`), `accentColorSchema` (`accentColor` → `#RRGGBB` con contraste AA), `languagesSchema` (`locales` → `Locale[]` con `es` siempre), `changeSlugSchema` (`slug`), `legalSchema` (`legalName`, `taxId`), `publishSchema` (`accept: 'on'`).
  - `validation/schedule.ts`: `serviceSchema` (`name`, `start`, `end` → `{ name; startMinute; endMinute }`), `newServicesSchema` (+ `weekdays` → `number[]` sin repetir), `exceptionSchema` (`dateFrom`, `dateTo`, `kind`, `note`, `name1/start1/end1`, `name2/start2/end2` → `{ dateFrom; dateTo; kind; note; customServices: { name; start_minute; end_minute }[] }`).
  - `db-errors.ts`: mensajes para `SLUG_TAKEN`, `PHOTO_LIMIT`, `services_no_overlap`, `services_range_check`, `schedule_exceptions_no_overlap`, `schedule_exceptions_dates_check`, `MISSING_FIELDS`, `ALREADY_PUBLISHED`, `DPA_VERSION`, `DPA_REQUIRED`, CHECK de `tax_id`, `postal_code`, `accent_color`, `enabled_locales_es`, y errores de Storage (tamaño y tipo).
  - `panel-nav.ts`: Inicio · Local (`restaurant.edit`) · Horario (`settings.booking`) · Equipo (`users.manage`).

- [ ] **Step 1: Escribir las pruebas nuevas (fallan)**

Create `src/lib/validation/local.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '../forms';
import { accentColorSchema, basicsSchema, contactSchema, languagesSchema, legalSchema, publishSchema, socialSchema } from './local';

const noDescriptions = { description_es: '', description_en: '', description_ca: '', description_fr: '', description_de: '', description_it: '' };

describe('basicsSchema', () => {
  it('normaliza y convierte el precio', () => {
    const r = basicsSchema.parse({ name: ' La Taberna ', cuisine: '', priceRange: '2', timezone: 'Atlantic/Canary', ...noDescriptions });
    expect(r).toMatchObject({ name: 'La Taberna', cuisine: null, priceRange: 2, timezone: 'Atlantic/Canary' });
  });

  it('rechaza descripciones de más de 1000 caracteres', () => {
    const r = basicsSchema.safeParse({ name: 'Bar', cuisine: '', priceRange: '', timezone: 'Europe/Madrid', ...noDescriptions, description_en: 'a'.repeat(1001) });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).description_en).toBe('La descripción puede tener como mucho 1000 caracteres.');
  });
});

describe('contactSchema', () => {
  it('normaliza teléfono, email y web; lo vacío queda en null', () => {
    const r = contactSchema.parse({ addressLine: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', phone: '910 00 00 00', contactEmail: ' Hola@Pepe.es ', website: 'pepe.es' });
    expect(r).toEqual({ addressLine: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', phone: '910000000', contactEmail: 'hola@pepe.es', website: 'https://pepe.es' });
    const empty = contactSchema.parse({ addressLine: '', postalCode: '', city: '', phone: '', contactEmail: '', website: '' });
    expect(Object.values(empty).every((v) => v === null)).toBe(true);
  });

  it('mensajes en castellano', () => {
    const r = contactSchema.safeParse({ addressLine: 'C', postalCode: '99999', city: 'M', phone: '123', contactEmail: 'no', website: 'no es web' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error)).toEqual({
      addressLine: 'Escribe la calle y el número.',
      postalCode: 'El código postal tiene 5 cifras (por ejemplo, 28013).',
      city: 'Escribe la ciudad.',
      phone: 'Ese teléfono no parece correcto. Escribe 9 cifras, con +34 delante si quieres.',
      contactEmail: 'Ese email no parece correcto.',
      website: 'Esa web no parece correcta (por ejemplo, https://turestaurante.es).',
    });
  });
});

describe('redes, color, idiomas, datos fiscales y publicar', () => {
  it('socialSchema convierte usuarios en enlaces', () => {
    expect(socialSchema.parse({ instagram: '@pepe', facebook: '', tiktok: 'pepebar' })).toEqual({
      instagram: 'https://www.instagram.com/pepe',
      facebook: null,
      tiktok: 'https://www.tiktok.com/@pepebar',
    });
    expect(socialSchema.safeParse({ instagram: 'twitter.com/pepe', facebook: '', tiktok: '' }).success).toBe(false);
  });

  it('accentColorSchema exige contraste', () => {
    expect(accentColorSchema.parse({ accentColor: '#ff7a1a' })).toEqual({ accentColor: '#FF7A1A' });
    const r = accentColorSchema.safeParse({ accentColor: '#7A7A7A' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).accentColor).toBe('Con ese color, el texto de los botones no se lee bien. Elige uno más claro o más oscuro.');
  });

  it('languagesSchema siempre incluye el castellano', () => {
    expect(languagesSchema.parse({ locales: ['it', 'en'] })).toEqual({ locales: ['es', 'en', 'it'] });
    expect(languagesSchema.parse({ locales: [] })).toEqual({ locales: ['es'] });
    expect(languagesSchema.safeParse({ locales: ['pt'] }).success).toBe(false);
  });

  it('legalSchema valida el CIF', () => {
    expect(legalSchema.parse({ legalName: 'Taberna Pepe SL', taxId: 'b-12345674' })).toEqual({ legalName: 'Taberna Pepe SL', taxId: 'B12345674' });
    const r = legalSchema.safeParse({ legalName: '', taxId: 'B12345675' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).taxId).toBe('Ese CIF, NIF o NIE no parece correcto. Revisa las letras y los números.');
  });

  it('publishSchema exige aceptar el contrato', () => {
    expect(publishSchema.safeParse({ accept: 'on' }).success).toBe(true);
    const r = publishSchema.safeParse({ accept: undefined });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).accept).toBe('Tienes que aceptar el contrato para publicar.');
  });
});
```

Create `src/lib/validation/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '../forms';
import { exceptionSchema, newServicesSchema, serviceSchema } from './schedule';

const emptyServices = { name1: '', start1: '', end1: '', name2: '', start2: '', end2: '' };

describe('servicios', () => {
  it('newServicesSchema: varios días y cena después de medianoche', () => {
    expect(newServicesSchema.parse({ name: ' Cena ', start: '20:00', end: '00:30', weekdays: ['5', '6', '5'] })).toEqual({
      name: 'Cena',
      weekdays: [5, 6],
      startMinute: 1200,
      endMinute: 1470,
    });
  });

  it('errores por campo en castellano', () => {
    const r = newServicesSchema.safeParse({ name: '', start: '9', end: '16:00', weekdays: [] });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error)).toEqual({
      name: 'Ponle nombre al servicio (por ejemplo, Comida o Cena).',
      weekdays: 'Elige al menos un día.',
    });
    const r2 = serviceSchema.safeParse({ name: 'Cena', start: '22:00', end: '07:00' });
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(fieldErrorsFrom(r2.error).end).toBe('Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.');
  });

  it('serviceSchema avisa de una hora mal escrita', () => {
    const r = serviceSchema.safeParse({ name: 'Comida', start: '9', end: '16:00' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).start).toBe('Escribe la hora así: 13:30.');
  });
});

describe('exceptionSchema', () => {
  it('un cierre de un solo día no necesita fecha final', () => {
    expect(exceptionSchema.parse({ dateFrom: '2026-12-25', dateTo: '', kind: 'closed', note: ' Navidad ', ...emptyServices })).toEqual({
      dateFrom: '2026-12-25',
      dateTo: '2026-12-25',
      kind: 'closed',
      note: 'Navidad',
      customServices: [],
    });
  });

  it('un horario especial con dos servicios', () => {
    const r = exceptionSchema.parse({
      dateFrom: '2026-12-31',
      dateTo: '2026-12-31',
      kind: 'custom',
      note: '',
      name1: 'Comida',
      start1: '13:00',
      end1: '16:00',
      name2: 'Cotillón',
      start2: '21:00',
      end2: '03:00',
    });
    expect(r.customServices).toEqual([
      { name: 'Comida', start_minute: 780, end_minute: 960 },
      { name: 'Cotillón', start_minute: 1260, end_minute: 1620 },
    ]);
  });

  it('rechaza fechas al revés, horarios especiales vacíos y servicios solapados', () => {
    const bad = exceptionSchema.safeParse({ dateFrom: '2026-12-26', dateTo: '2026-12-24', kind: 'custom', note: '', ...emptyServices });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(fieldErrorsFrom(bad.error)).toEqual({ dateTo: 'La fecha final no puede ser anterior a la inicial.' });

    const empty = exceptionSchema.safeParse({ dateFrom: '2026-12-24', dateTo: '', kind: 'custom', note: '', ...emptyServices });
    expect(empty.success).toBe(false);
    if (empty.success) return;
    expect(fieldErrorsFrom(empty.error)).toEqual({ name1: 'Añade al menos un servicio para el horario especial.' });

    const overlap = exceptionSchema.safeParse({
      dateFrom: '2026-12-24',
      dateTo: '',
      kind: 'custom',
      note: '',
      name1: 'A',
      start1: '13:00',
      end1: '16:00',
      name2: 'B',
      start2: '15:00',
      end2: '17:00',
    });
    expect(overlap.success).toBe(false);
    if (overlap.success) return;
    expect(fieldErrorsFrom(overlap.error)).toEqual({ end2: 'Los dos servicios se solapan.' });
  });
});
```

Replace `src/lib/forms.test.ts` with:

```ts
import { expect, it } from 'vitest';
import { z } from 'zod';
import { fieldErrorsFrom, formStrings } from './forms';

it('devuelve el primer error de cada campo', () => {
  const schema = z.object({ a: z.string().min(2, 'corto').regex(/x/, 'sin x'), b: z.string() });
  const r = schema.safeParse({ a: 'y', b: 'ok' });
  expect(r.success).toBe(false);
  if (!r.success) expect(fieldErrorsFrom(r.error)).toEqual({ a: 'corto' });
});

it('formStrings lee texto y deja en blanco lo que falta o es un archivo', () => {
  const fd = new FormData();
  fd.set('name', 'La Taberna');
  fd.set('file', new Blob(['x']), 'x.webp');
  expect(formStrings(fd, ['name', 'city', 'file'])).toEqual({ name: 'La Taberna', city: '', file: '' });
});
```

Replace `src/lib/db-errors.test.ts` with:

```ts
import { expect, it } from 'vitest';
import { mapDbError } from './db-errors';

it.each([
  ['FORBIDDEN', 'No tienes permiso para hacer esto.'],
  ['SLUG_RESERVED', 'Esa dirección está reservada. Prueba con otra.'],
  ['duplicate key value violates unique constraint "restaurants_slug_key"', 'Ya hay un restaurante con esa dirección. Prueba con otra.'],
  ['ALREADY_MEMBER', 'Esa persona ya forma parte del equipo.'],
  ['LAST_ADMIN', 'Tiene que quedar al menos un administrador.'],
  ['INVALID_INVITATION', 'Esta invitación ya no es válida. Pide que te la reenvíen.'],
  ['EMAIL_MISMATCH', 'Esta invitación es para otro email. Entra con la cuenta correcta.'],
  ['INVALID_EMAIL', 'Ese email no parece correcto.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_slug_check"', 'La dirección solo puede llevar minúsculas, números y guiones.'],
  ['RESTAURANT_DISABLED', 'Este restaurante está desactivado. Reactívalo antes de invitar a nadie.'],
  ['NOT_FOUND', 'No encontramos ese restaurante.'],
  ['NOT_AUTHENTICATED', 'Tu sesión ha caducado. Vuelve a entrar.'],
  ['SLUG_TAKEN', 'Esa dirección ya la usa otro restaurante. Prueba con otra.'],
  ['PHOTO_LIMIT', 'Ya tienes 12 fotos en la galería. Borra alguna para subir otra.'],
  ['conflicting key value violates exclusion constraint "services_no_overlap"', 'Ese servicio se solapa con otro del mismo día.'],
  ['new row for relation "services" violates check constraint "services_range_check"', 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.'],
  ['conflicting key value violates exclusion constraint "schedule_exceptions_no_overlap"', 'Ya hay un cierre u horario especial en esas fechas.'],
  ['new row for relation "schedule_exceptions" violates check constraint "schedule_exceptions_dates_check"', 'Revisa las fechas: la final no puede ser anterior a la inicial (y como mucho, un año).'],
  ['MISSING_FIELDS', 'Todavía faltan datos para publicar. Revisa la lista.'],
  ['ALREADY_PUBLISHED', 'Tu web ya está publicada.'],
  ['DPA_VERSION', 'El contrato ha cambiado. Recarga la página y vuelve a aceptarlo.'],
  ['DPA_REQUIRED', 'Este restaurante aún no ha aceptado el contrato. Lo publica su administrador desde el panel.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_tax_id_check"', 'Ese CIF, NIF o NIE no parece correcto.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_postal_code_check"', 'El código postal tiene 5 cifras (por ejemplo, 28013).'],
  ['new row for relation "restaurants" violates check constraint "restaurants_accent_color_check"', 'Elige un color válido.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_enabled_locales_es_check"', 'El castellano siempre tiene que estar activo.'],
  ['The object exceeded the maximum allowed size', 'La imagen pesa demasiado. Prueba con otra más pequeña.'],
  ['mime type image/gif is not supported', 'Ese formato de imagen no vale. Usa JPG, PNG o WebP.'],
  ['new row violates row-level security policy for table "objects"', 'No tienes permiso para hacer esto.'],
])('%s → mensaje claro', (raw, msg) => {
  expect(mapDbError(raw)).toBe(msg);
});

it('cualquier otro error da un mensaje genérico', () => {
  expect(mapDbError('connection reset')).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
  expect(mapDbError(undefined)).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
});
```

Replace `src/lib/panel-nav.test.ts` with:

```ts
import { expect, it } from 'vitest';
import { panelNav } from './panel-nav';

const id = '11111111-1111-1111-1111-111111111111';

it('el administrador ve Inicio, Local, Horario y Equipo', () => {
  expect(panelNav(id, 'admin')).toEqual([
    { href: `/panel/${id}`, label: 'Inicio' },
    { href: `/panel/${id}/local`, label: 'Local' },
    { href: `/panel/${id}/horario`, label: 'Horario' },
    { href: `/panel/${id}/usuarios`, label: 'Equipo' },
  ]);
});

it('el encargado ve Horario, pero no Local ni Equipo', () => {
  expect(panelNav(id, 'manager').map((i) => i.label)).toEqual(['Inicio', 'Horario']);
});

it('sala solo ve Inicio', () => {
  expect(panelNav(id, 'staff').map((i) => i.label)).toEqual(['Inicio']);
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `pnpm test:unit`
Expected: FAIL — no se resuelven `./local` ni `./schedule`; `formStrings` no existe; los códigos nuevos de `db-errors` dan el mensaje genérico; `panelNav` no incluye Local ni Horario.

- [ ] **Step 3: Añadir `formStrings` al final de `src/lib/forms.ts`**

```ts
/** Lee campos de texto de un FormData; los que faltan (o son archivos) llegan como ''. */
export function formStrings<K extends string>(fd: FormData, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = fd.get(key);
    out[key] = typeof value === 'string' ? value : '';
  }
  return out;
}
```

- [ ] **Step 4: Ampliar `src/lib/db-errors.ts`**

Replace the whole file with:

```ts
const GENERIC = 'Algo ha fallado. Vuelve a intentarlo en un momento.';

const RULES: [RegExp, string][] = [
  [/FORBIDDEN|permission denied|row-level security/i, 'No tienes permiso para hacer esto.'],
  [/SLUG_RESERVED/, 'Esa dirección está reservada. Prueba con otra.'],
  [/restaurants_slug_key/, 'Ya hay un restaurante con esa dirección. Prueba con otra.'],
  [/restaurants_slug_check/, 'La dirección solo puede llevar minúsculas, números y guiones.'],
  [/ALREADY_MEMBER/, 'Esa persona ya forma parte del equipo.'],
  [/LAST_ADMIN/, 'Tiene que quedar al menos un administrador.'],
  [/INVALID_INVITATION/, 'Esta invitación ya no es válida. Pide que te la reenvíen.'],
  [/EMAIL_MISMATCH/, 'Esta invitación es para otro email. Entra con la cuenta correcta.'],
  [/INVALID_EMAIL/, 'Ese email no parece correcto.'],
  [/RESTAURANT_DISABLED/, 'Este restaurante está desactivado. Reactívalo antes de invitar a nadie.'],
  [/\bNOT_FOUND\b/, 'No encontramos ese restaurante.'],
  [/NOT_AUTHENTICATED/, 'Tu sesión ha caducado. Vuelve a entrar.'],
  // Hito 2: ficha, fotos, horario y publicación
  [/SLUG_TAKEN/, 'Esa dirección ya la usa otro restaurante. Prueba con otra.'],
  [/PHOTO_LIMIT/, 'Ya tienes 12 fotos en la galería. Borra alguna para subir otra.'],
  [/services_no_overlap/, 'Ese servicio se solapa con otro del mismo día.'],
  [/services_range_check/, 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.'],
  [/schedule_exceptions_no_overlap/, 'Ya hay un cierre u horario especial en esas fechas.'],
  [/schedule_exceptions_dates_check/, 'Revisa las fechas: la final no puede ser anterior a la inicial (y como mucho, un año).'],
  [/MISSING_FIELDS/, 'Todavía faltan datos para publicar. Revisa la lista.'],
  [/ALREADY_PUBLISHED/, 'Tu web ya está publicada.'],
  [/DPA_VERSION/, 'El contrato ha cambiado. Recarga la página y vuelve a aceptarlo.'],
  [/DPA_REQUIRED/, 'Este restaurante aún no ha aceptado el contrato. Lo publica su administrador desde el panel.'],
  [/restaurants_tax_id_check/, 'Ese CIF, NIF o NIE no parece correcto.'],
  [/restaurants_postal_code_check/, 'El código postal tiene 5 cifras (por ejemplo, 28013).'],
  [/restaurants_accent_color_check/, 'Elige un color válido.'],
  [/restaurants_enabled_locales_es_check/, 'El castellano siempre tiene que estar activo.'],
  [/exceeded the maximum allowed size|payload too large/i, 'La imagen pesa demasiado. Prueba con otra más pequeña.'],
  [/mime type/i, 'Ese formato de imagen no vale. Usa JPG, PNG o WebP.'],
];

export function mapDbError(message: string | null | undefined): string {
  if (!message) return GENERIC;
  for (const [pattern, text] of RULES) if (pattern.test(message)) return text;
  return GENERIC;
}
```

El orden importa: la primera regla que encaja gana (la de permisos sigue la primera, y cubre también la RLS de Storage).

- [ ] **Step 5: Añadir Local y Horario a la navegación**

Replace `src/lib/panel-nav.ts` with:

```ts
import { can, type Permission, type Role } from './permissions';

export type NavItem = { href: string; label: string };

// Cada hito añade aquí sus secciones (Local, Menú, Reservas, Clientes, Estadísticas).
const ITEMS: { path: string; label: string; permission: Permission | null }[] = [
  { path: '', label: 'Inicio', permission: null },
  { path: '/local', label: 'Local', permission: 'restaurant.edit' },
  { path: '/horario', label: 'Horario', permission: 'settings.booking' },
  { path: '/usuarios', label: 'Equipo', permission: 'users.manage' },
];

export function panelNav(restaurantId: string, role: Role): NavItem[] {
  return ITEMS.filter((i) => i.permission === null || can(role, i.permission)).map((i) => ({
    href: `/panel/${restaurantId}${i.path}`,
    label: i.label,
  }));
}
```

- [ ] **Step 6: Esquemas de la ficha**

Create `src/lib/validation/local.ts`:

```ts
import { z } from 'zod';
import { accentTheme, normalizeHex } from '@/lib/color';
import { LOCALES, sortLocales } from '@/lib/i18n/locales';
import { normalizeSocial, normalizeWebsite, type SocialNetwork } from '@/lib/social';
import { isValidPhone, isValidPostalCode, isValidTaxId, normalizePhone, normalizeTaxId } from '@/lib/spain';
import { slugSchema } from './schemas';

const REQUIRED = 'Este campo es obligatorio.';

/** Texto opcional: '' → null. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((v) => (v === '' ? null : v));

const description = z.string().trim().max(1000, 'La descripción puede tener como mucho 1000 caracteres.');

export const basicsSchema = z.object({
  name: z
    .string({ error: REQUIRED })
    .trim()
    .min(2, 'Escribe el nombre del restaurante (mínimo 2 letras).')
    .max(120, 'El nombre puede tener como mucho 120 caracteres.'),
  cuisine: optionalText(60, 'El tipo de cocina puede tener como mucho 60 caracteres.'),
  priceRange: z
    .enum(['', '1', '2', '3', '4'], { error: 'Elige un rango de precio.' })
    .transform((v) => (v === '' ? null : Number(v))),
  timezone: z.enum(['Europe/Madrid', 'Atlantic/Canary'], { error: 'Elige dónde está tu restaurante.' }),
  description_es: description,
  description_en: description,
  description_ca: description,
  description_fr: description,
  description_de: description,
  description_it: description,
});

export const contactSchema = z.object({
  addressLine: optionalText(200, 'La dirección puede tener como mucho 200 caracteres.').refine(
    (v) => v === null || v.length >= 3,
    'Escribe la calle y el número.',
  ),
  postalCode: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isValidPostalCode(v), 'El código postal tiene 5 cifras (por ejemplo, 28013).'),
  city: optionalText(100, 'La ciudad puede tener como mucho 100 caracteres.').refine(
    (v) => v === null || v.length >= 2,
    'Escribe la ciudad.',
  ),
  phone: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : normalizePhone(v)))
    .refine((v) => v === null || isValidPhone(v), 'Ese teléfono no parece correcto. Escribe 9 cifras, con +34 delante si quieres.'),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Ese email no parece correcto.'),
  website: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const url = normalizeWebsite(v);
      if (!url) {
        ctx.addIssue({ code: 'custom', message: 'Esa web no parece correcta (por ejemplo, https://turestaurante.es).' });
        return z.NEVER;
      }
      return url;
    }),
});

const social = (network: SocialNetwork, message: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const url = normalizeSocial(network, v);
      if (!url) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return url;
    });

export const socialSchema = z.object({
  instagram: social('instagram', 'Escribe tu usuario de Instagram (por ejemplo, @turestaurante) o el enlace a tu perfil.'),
  facebook: social('facebook', 'Pega el enlace a tu página de Facebook.'),
  tiktok: social('tiktok', 'Escribe tu usuario de TikTok (por ejemplo, @turestaurante) o el enlace a tu perfil.'),
});

export const accentColorSchema = z.object({
  accentColor: z.string({ error: REQUIRED }).transform((v, ctx) => {
    const hex = normalizeHex(v);
    if (!hex) {
      ctx.addIssue({ code: 'custom', message: 'Elige un color válido.' });
      return z.NEVER;
    }
    if (!accentTheme(hex).meetsAA) {
      ctx.addIssue({
        code: 'custom',
        message: 'Con ese color, el texto de los botones no se lee bien. Elige uno más claro o más oscuro.',
      });
      return z.NEVER;
    }
    return hex;
  }),
});

/** El castellano siempre va incluido. */
export const languagesSchema = z.object({
  locales: z.array(z.enum(LOCALES, { error: 'Elige idiomas de la lista.' })).transform((l) => sortLocales(['es', ...l])),
});

export const changeSlugSchema = z.object({ slug: slugSchema });

export const legalSchema = z.object({
  legalName: optionalText(200, 'La razón social puede tener como mucho 200 caracteres.').refine(
    (v) => v === null || v.length >= 2,
    'Escribe la razón social (o tu nombre si eres autónomo).',
  ),
  taxId: z
    .string()
    .transform((v) => normalizeTaxId(v))
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isValidTaxId(v), 'Ese CIF, NIF o NIE no parece correcto. Revisa las letras y los números.'),
});

export const publishSchema = z.object({
  accept: z.literal('on', { error: 'Tienes que aceptar el contrato para publicar.' }),
});
```

- [ ] **Step 7: Esquemas del horario**

Create `src/lib/validation/schedule.ts`:

```ts
import { z } from 'zod';
import { daysBetween, timeToMinutes, toServiceRange } from '@/lib/schedule';

const REQUIRED = 'Este campo es obligatorio.';
const BAD_TIME = 'Escribe la hora así: 13:30.';
const BAD_RANGE = 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const serviceName = z
  .string({ error: REQUIRED })
  .trim()
  .min(1, 'Ponle nombre al servicio (por ejemplo, Comida o Cena).')
  .max(40, 'El nombre puede tener como mucho 40 caracteres.');

type RangeCtx = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

function rangeOrIssue(start: string, end: string, ctx: RangeCtx, startKey: string, endKey: string) {
  if (timeToMinutes(start) === null) ctx.addIssue({ code: 'custom', path: [startKey], message: BAD_TIME });
  if (timeToMinutes(end) === null) ctx.addIssue({ code: 'custom', path: [endKey], message: BAD_TIME });
  if (timeToMinutes(start) === null || timeToMinutes(end) === null) return null;
  const range = toServiceRange(start, end);
  if (!range) ctx.addIssue({ code: 'custom', path: [endKey], message: BAD_RANGE });
  return range;
}

/** Editar un servicio: nombre y horas. */
export const serviceSchema = z
  .object({ name: serviceName, start: z.string({ error: REQUIRED }), end: z.string({ error: REQUIRED }) })
  .transform((v, ctx) => {
    const range = rangeOrIssue(v.start, v.end, ctx, 'start', 'end');
    if (!range) return z.NEVER;
    return { name: v.name, ...range };
  });

/** Crear un servicio en uno o varios días a la vez. */
export const newServicesSchema = z
  .object({
    name: serviceName,
    start: z.string({ error: REQUIRED }),
    end: z.string({ error: REQUIRED }),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, 'Elige al menos un día.'),
  })
  .transform((v, ctx) => {
    const range = rangeOrIssue(v.start, v.end, ctx, 'start', 'end');
    if (!range) return z.NEVER;
    return { name: v.name, weekdays: [...new Set(v.weekdays)].sort(), ...range };
  });

/** Cierre (closed) u horario especial (custom) de una fecha o un rango de fechas, con hasta dos servicios. */
export const exceptionSchema = z
  .object({
    dateFrom: z.string({ error: REQUIRED }).regex(ISO_DATE, 'Elige una fecha.'),
    dateTo: z.string().trim(),
    kind: z.enum(['closed', 'custom'], { error: 'Elige si cierras o abres con otro horario.' }),
    note: z
      .string()
      .trim()
      .max(140, 'La nota puede tener como mucho 140 caracteres.')
      .transform((v) => (v === '' ? null : v)),
    name1: z.string().trim(),
    start1: z.string().trim(),
    end1: z.string().trim(),
    name2: z.string().trim(),
    start2: z.string().trim(),
    end2: z.string().trim(),
  })
  .transform((v, ctx) => {
    const dateTo = v.dateTo === '' ? v.dateFrom : v.dateTo;
    let ok = true;
    if (!ISO_DATE.test(dateTo)) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Elige una fecha.' });
      ok = false;
    } else if (dateTo < v.dateFrom) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'La fecha final no puede ser anterior a la inicial.' });
      ok = false;
    } else if (daysBetween(v.dateFrom, dateTo) > 366) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Como mucho, un año seguido.' });
      ok = false;
    }
    const customServices: { name: string; start_minute: number; end_minute: number }[] = [];
    if (v.kind === 'custom') {
      const rows = [
        { n: '1', name: v.name1, start: v.start1, end: v.end1 },
        { n: '2', name: v.name2, start: v.start2, end: v.end2 },
      ];
      for (const row of rows) {
        if (!row.name && !row.start && !row.end) continue;
        if (!row.name) {
          ctx.addIssue({ code: 'custom', path: [`name${row.n}`], message: 'Ponle nombre al servicio.' });
          ok = false;
          continue;
        }
        const range = rangeOrIssue(row.start, row.end, ctx, `start${row.n}`, `end${row.n}`);
        if (!range) {
          ok = false;
          continue;
        }
        customServices.push({ name: row.name.slice(0, 40), start_minute: range.startMinute, end_minute: range.endMinute });
      }
      const [a, b] = customServices;
      if (a && b && a.start_minute < b.end_minute && b.start_minute < a.end_minute) {
        ctx.addIssue({ code: 'custom', path: ['end2'], message: 'Los dos servicios se solapan.' });
        ok = false;
      }
      if (ok && customServices.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['name1'], message: 'Añade al menos un servicio para el horario especial.' });
        ok = false;
      }
    }
    if (!ok) return z.NEVER;
    return { dateFrom: v.dateFrom, dateTo, kind: v.kind, note: v.note, customServices };
  });
```

- [ ] **Step 8: Ejecutar las pruebas**

Run: `pnpm test:unit`
Expected: PASS (todas las suites unitarias).

- [ ] **Step 9: Commit**

```bash
git add src/lib/forms.ts src/lib/forms.test.ts src/lib/db-errors.ts src/lib/db-errors.test.ts src/lib/panel-nav.ts src/lib/panel-nav.test.ts src/lib/validation/local.ts src/lib/validation/local.test.ts src/lib/validation/schedule.ts src/lib/validation/schedule.test.ts
git commit -m "Validación de ficha y horario, errores nuevos y secciones Local y Horario"
```

---

### Task 8: Datos públicos: formato, SEO, JSON-LD, aviso legal y lectura cacheada

**Files:**
- Create: `src/lib/public/tags.ts`, `src/lib/public/restaurant-schema.ts`, `src/lib/public/fixtures.ts`, `src/lib/public/format.ts`, `src/lib/public/seo.ts`, `src/lib/public/jsonld.ts`, `src/lib/legal/legal-notice.ts`
- Create (servidor, sin prueba unitaria): `src/lib/supabase/public.ts`, `src/lib/public/data.ts`, `src/lib/public/locale.ts`
- Test: `src/lib/public/restaurant-schema.test.ts`, `src/lib/public/seo.test.ts`, `src/lib/legal/legal.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6; `serverEnv()` de `src/lib/env.ts`; `isValidSlug` de `src/lib/slug.ts`.
- Produces:
  - `tags.ts`: `PUBLIC_ALL_TAG = 'public-restaurants'`, `publicRestaurantTag(slug): string` (`public-restaurant:<slug>`).
  - `restaurant-schema.ts`: `type PublicRestaurant = { id; slug; name; timezone; enabledLocales: Locale[]; cuisine; priceRange; addressLine; postalCode; city; phone; contactEmail; website; instagram; facebook; tiktok; accentColor; logoPath; coverPath; legalName; taxId; descriptions: Partial<Record<Locale, string>>; photos: string[]; services: ServiceSlot[]; exceptions: ScheduleException[] }`, `type PublicLookup = { kind: 'restaurant'; restaurant } | { kind: 'redirect'; slug } | null`, `parsePublicLookup(data: unknown): PublicLookup`, `descriptionFor(r, locale): string | null`.
  - `fixtures.ts`: `SAMPLE_RESTAURANT: PublicRestaurant`.
  - `format.ts`: `priceLabel(n)`, `fullAddress({ addressLine, postalCode, city })`, `directionsUrl(address)`, `mapEmbedUrl(address)`, `withLang(path, locale)`.
  - `seo.ts`: `publicUrl(site, path, locale)`, `languageAlternates(site, path, enabled): Record<string, string>` (con `x-default`), `metaDescription(r, locale)`, `OG_LOCALE: Record<Locale, string>`.
  - `jsonld.ts`: `restaurantJsonLd(r, { url, mediaUrl }): Record<string, unknown>`, `jsonLdScript(data): string`.
  - `legal/legal-notice.ts`: `legalNoticeSections(r): { heading; body }[]`.
  - `supabase/public.ts`: `createPublicClient()` (publishable key, sin sesión).
  - `public/data.ts`: `getPublicRestaurant(slug): Promise<PublicLookup>` (React `cache` + `unstable_cache`, etiquetas `[publicRestaurantTag(slug), PUBLIC_ALL_TAG]`, `revalidate: 3600`), `type PublicSlug = { slug; enabledLocales; updatedAt }`, `getPublicSlugs(): Promise<PublicSlug[]>`, `mediaUrl(path): string`.
  - `public/locale.ts`: `requestLocale(lang: string | undefined, enabled: readonly Locale[]): Promise<Locale>`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`, `headers.md` y `01-app/02-guides/json-ld.md`. `unstable_cache` no puede leer `cookies()` ni `headers()` dentro: el idioma se resuelve fuera y la caché solo depende del slug.

- [ ] **Step 1: Escribir las pruebas (fallan)**

Create `src/lib/public/fixtures.ts` (datos de ejemplo que comparten las pruebas):

```ts
import type { PublicRestaurant } from './restaurant-schema';

/** Restaurante de ejemplo para las pruebas unitarias. */
export const SAMPLE_RESTAURANT: PublicRestaurant = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'la-taberna',
  name: 'La Taberna de Pepe',
  timezone: 'Europe/Madrid',
  enabledLocales: ['es', 'en'],
  cuisine: 'Mediterránea',
  priceRange: 2,
  addressLine: 'Calle Mayor 1',
  postalCode: '28013',
  city: 'Madrid',
  phone: '910000000',
  contactEmail: 'hola@lataberna.es',
  website: 'https://lataberna.es',
  instagram: 'https://www.instagram.com/latabernapepe',
  facebook: null,
  tiktok: null,
  accentColor: '#17317F',
  logoPath: '11111111-1111-4111-8111-111111111111/logo-a.webp',
  coverPath: '11111111-1111-4111-8111-111111111111/cover-b.webp',
  legalName: 'Taberna Pepe SL',
  taxId: 'B12345674',
  descriptions: { es: 'Cocina de mercado en el centro.', en: 'Market cuisine downtown.' },
  photos: ['11111111-1111-4111-8111-111111111111/gallery/c.webp'],
  services: [
    { name: 'Comida', weekday: 1, startMinute: 780, endMinute: 960 },
    { name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1470 },
  ],
  exceptions: [
    { dateFrom: '2026-12-24', dateTo: '2026-12-26', kind: 'closed', customServices: [], note: 'Navidad' },
    {
      dateFrom: '2026-12-31',
      dateTo: '2026-12-31',
      kind: 'custom',
      customServices: [{ name: 'Cena', startMinute: 1260, endMinute: 1620 }],
      note: null,
    },
  ],
};
```

Create `src/lib/public/restaurant-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SAMPLE_RESTAURANT } from './fixtures';
import { descriptionFor, parsePublicLookup } from './restaurant-schema';
import { publicRestaurantTag } from './tags';

const raw = {
  id: SAMPLE_RESTAURANT.id,
  slug: 'la-taberna',
  name: 'La Taberna de Pepe',
  timezone: 'Europe/Madrid',
  enabled_locales: ['en', 'es'],
  cuisine: 'Mediterránea',
  price_range: 2,
  address_line: 'Calle Mayor 1',
  postal_code: '28013',
  city: 'Madrid',
  phone: '910000000',
  contact_email: 'hola@lataberna.es',
  website: 'https://lataberna.es',
  instagram: 'https://www.instagram.com/latabernapepe',
  facebook: null,
  tiktok: null,
  accent_color: '#17317F',
  logo_path: SAMPLE_RESTAURANT.logoPath,
  cover_path: SAMPLE_RESTAURANT.coverPath,
  legal_name: 'Taberna Pepe SL',
  tax_id: 'B12345674',
  descriptions: { es: 'Cocina de mercado en el centro.', en: 'Market cuisine downtown.' },
  photos: SAMPLE_RESTAURANT.photos,
  services: [
    { name: 'Comida', weekday: 1, start_minute: 780, end_minute: 960 },
    { name: 'Cena', weekday: 5, start_minute: 1200, end_minute: 1470 },
  ],
  exceptions: [
    { date_from: '2026-12-24', date_to: '2026-12-26', kind: 'closed', custom_services: [], note: 'Navidad' },
    { date_from: '2026-12-31', date_to: '2026-12-31', kind: 'custom', custom_services: [{ name: 'Cena', start_minute: 1260, end_minute: 1620 }], note: null },
  ],
};

describe('parsePublicLookup', () => {
  it('convierte el JSON de la BD al formato de la app', () => {
    expect(parsePublicLookup(raw)).toEqual({ kind: 'restaurant', restaurant: SAMPLE_RESTAURANT });
  });

  it('reconoce redirecciones y restaurantes que no existen', () => {
    expect(parsePublicLookup({ redirect: 'nuevo-slug' })).toEqual({ kind: 'redirect', slug: 'nuevo-slug' });
    expect(parsePublicLookup(null)).toBeNull();
  });

  it('falla si la BD devuelve algo inesperado', () => {
    expect(() => parsePublicLookup({ ...raw, services: [{ weekday: 9 }] })).toThrow();
  });
});

it('descriptionFor cae al castellano si falta el idioma', () => {
  expect(descriptionFor(SAMPLE_RESTAURANT, 'en')).toBe('Market cuisine downtown.');
  expect(descriptionFor(SAMPLE_RESTAURANT, 'fr')).toBe('Cocina de mercado en el centro.');
  expect(descriptionFor({ ...SAMPLE_RESTAURANT, descriptions: {} }, 'fr')).toBeNull();
});

it('publicRestaurantTag usa la dirección pública', () => {
  expect(publicRestaurantTag('la-taberna')).toBe('public-restaurant:la-taberna');
});
```

Create `src/lib/public/seo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SAMPLE_RESTAURANT } from './fixtures';
import { directionsUrl, fullAddress, mapEmbedUrl, priceLabel, withLang } from './format';
import { jsonLdScript, restaurantJsonLd } from './jsonld';
import { languageAlternates, metaDescription, OG_LOCALE } from './seo';

const site = 'https://mesa.example.com';

describe('formato público', () => {
  it('precio, dirección y enlaces de mapa', () => {
    expect(priceLabel(3)).toBe('€€€');
    expect(priceLabel(null)).toBeNull();
    expect(fullAddress(SAMPLE_RESTAURANT)).toBe('Calle Mayor 1, 28013 Madrid');
    expect(fullAddress({ addressLine: null, postalCode: null, city: 'Madrid' })).toBe('Madrid');
    expect(directionsUrl('Calle Mayor 1, 28013 Madrid')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Calle%20Mayor%201%2C%2028013%20Madrid%2C%20Espa%C3%B1a',
    );
    expect(mapEmbedUrl('Calle Mayor 1')).toBe('https://www.google.com/maps?q=Calle%20Mayor%201%2C%20Espa%C3%B1a&output=embed');
  });

  it('withLang solo añade ?lang= si no es castellano', () => {
    expect(withLang('/la-taberna', 'es')).toBe('/la-taberna');
    expect(withLang('/la-taberna', 'en')).toBe('/la-taberna?lang=en');
    expect(withLang('/la-taberna', null)).toBe('/la-taberna');
  });
});

describe('SEO', () => {
  it('hreflang por idioma activo y x-default', () => {
    expect(languageAlternates(site, '/la-taberna', ['es', 'en'])).toEqual({
      es: `${site}/la-taberna`,
      en: `${site}/la-taberna?lang=en`,
      'x-default': `${site}/la-taberna`,
    });
  });

  it('Open Graph usa idioma_PAÍS', () => {
    expect(OG_LOCALE).toEqual({ es: 'es_ES', en: 'en_GB', ca: 'ca_ES', fr: 'fr_FR', de: 'de_DE', it: 'it_IT' });
  });

  it('metaDescription usa la descripción del idioma y recorta a 160', () => {
    expect(metaDescription(SAMPLE_RESTAURANT, 'en')).toBe('Market cuisine downtown.');
    const long = { ...SAMPLE_RESTAURANT, descriptions: { es: 'a '.repeat(200) } };
    expect(metaDescription(long, 'es').length).toBeLessThanOrEqual(160);
    expect(metaDescription({ ...SAMPLE_RESTAURANT, descriptions: {} }, 'es')).toBe('La Taberna de Pepe · Mediterránea · Madrid');
  });
});

describe('JSON-LD', () => {
  const ld = restaurantJsonLd(SAMPLE_RESTAURANT, { url: `${site}/la-taberna`, mediaUrl: (p) => `https://cdn.test/${p}` });

  it('describe el restaurante con dirección, contacto y precio', () => {
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: 'La Taberna de Pepe',
      servesCuisine: 'Mediterránea',
      priceRange: '€€',
      telephone: '910000000',
      address: { '@type': 'PostalAddress', streetAddress: 'Calle Mayor 1', postalCode: '28013', addressLocality: 'Madrid', addressCountry: 'ES' },
      sameAs: ['https://www.instagram.com/latabernapepe'],
    });
    expect(ld.image).toEqual([`https://cdn.test/${SAMPLE_RESTAURANT.coverPath}`, `https://cdn.test/${SAMPLE_RESTAURANT.photos[0]}`]);
  });

  it('incluye el horario y los cierres', () => {
    expect(ld.openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '13:00', closes: '16:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Friday', opens: '20:00', closes: '00:30' },
    ]);
    expect(ld.specialOpeningHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', validFrom: '2026-12-24', validThrough: '2026-12-26', opens: '00:00', closes: '00:00' },
      { '@type': 'OpeningHoursSpecification', validFrom: '2026-12-31', validThrough: '2026-12-31', opens: '21:00', closes: '03:00' },
    ]);
  });

  it('jsonLdScript no deja cerrar la etiqueta script', () => {
    expect(jsonLdScript({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });
});
```

Create `src/lib/legal/legal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SAMPLE_RESTAURANT } from '@/lib/public/fixtures';
import { DPA_SECTIONS, DPA_VERSION } from './dpa';
import { legalNoticeSections } from './legal-notice';

describe('textos legales', () => {
  it('el contrato tiene versión y secciones', () => {
    expect(DPA_VERSION).toBe('2026-11-borrador');
    expect(DPA_SECTIONS.length).toBeGreaterThan(3);
    expect(DPA_SECTIONS.map((s) => s.body).join(' ')).toContain('Supabase');
  });

  it('el aviso legal lleva los datos LSSI del restaurante', () => {
    const text = legalNoticeSections(SAMPLE_RESTAURANT).map((s) => s.body).join(' ');
    expect(text).toContain('Taberna Pepe SL');
    expect(text).toContain('B12345674');
    expect(text).toContain('Calle Mayor 1, 28013 Madrid');
    expect(text).toContain('hola@lataberna.es');
  });

  it('sin razón social usa el nombre del restaurante', () => {
    const text = legalNoticeSections({ ...SAMPLE_RESTAURANT, legalName: null, taxId: null }).map((s) => s.body).join(' ');
    expect(text).toContain('pertenece a La Taberna de Pepe, con CIF/NIF —');
  });
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `pnpm test:unit src/lib/public src/lib/legal`
Expected: FAIL — no se resuelven `./restaurant-schema`, `./tags`, `./format`, `./jsonld`, `./seo` ni `./legal-notice`.

- [ ] **Step 3: Etiquetas de caché y esquema del JSON público**

Create `src/lib/public/tags.ts`:

```ts
/** Etiqueta de caché de todas las mini-webs (y del sitemap). */
export const PUBLIC_ALL_TAG = 'public-restaurants';

/** Etiqueta de caché de una mini-web, por su dirección pública. */
export function publicRestaurantTag(slug: string): string {
  return `public-restaurant:${slug}`;
}
```

Create `src/lib/public/restaurant-schema.ts`:

```ts
import { z } from 'zod';
import type { Locale } from '@/lib/i18n/locales';
import { sortLocales } from '@/lib/i18n/locales';

const minutes = z.number().int();

const service = z
  .object({ name: z.string(), weekday: z.number().int().min(1).max(7), start_minute: minutes, end_minute: minutes })
  .transform((s) => ({ name: s.name, weekday: s.weekday, startMinute: s.start_minute, endMinute: s.end_minute }));

const customService = z
  .object({ name: z.string(), start_minute: minutes, end_minute: minutes })
  .transform((s) => ({ name: s.name, startMinute: s.start_minute, endMinute: s.end_minute }));

const exception = z
  .object({
    date_from: z.string(),
    date_to: z.string(),
    kind: z.enum(['closed', 'custom']),
    custom_services: z.array(customService),
    note: z.string().nullable(),
  })
  .transform((e) => ({
    dateFrom: e.date_from,
    dateTo: e.date_to,
    kind: e.kind,
    customServices: e.custom_services,
    note: e.note,
  }));

const text = z.string().nullable();

/** JSON de public.get_public_restaurant() (snake_case) → objeto de la app (camelCase). */
const restaurantSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    enabled_locales: z.array(z.string()),
    cuisine: text,
    price_range: z.number().int().min(1).max(4).nullable(),
    address_line: text,
    postal_code: text,
    city: text,
    phone: text,
    contact_email: text,
    website: text,
    instagram: text,
    facebook: text,
    tiktok: text,
    accent_color: z.string(),
    logo_path: text,
    cover_path: text,
    legal_name: text,
    tax_id: text,
    descriptions: z.record(z.string(), z.string()),
    photos: z.array(z.string()),
    services: z.array(service),
    exceptions: z.array(exception),
  })
  .transform((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    timezone: r.timezone,
    enabledLocales: sortLocales(r.enabled_locales),
    cuisine: r.cuisine,
    priceRange: r.price_range,
    addressLine: r.address_line,
    postalCode: r.postal_code,
    city: r.city,
    phone: r.phone,
    contactEmail: r.contact_email,
    website: r.website,
    instagram: r.instagram,
    facebook: r.facebook,
    tiktok: r.tiktok,
    accentColor: r.accent_color,
    logoPath: r.logo_path,
    coverPath: r.cover_path,
    legalName: r.legal_name,
    taxId: r.tax_id,
    descriptions: r.descriptions as Partial<Record<Locale, string>>,
    photos: r.photos,
    services: r.services,
    exceptions: r.exceptions,
  }));

export type PublicRestaurant = z.output<typeof restaurantSchema>;
export type PublicLookup = { kind: 'restaurant'; restaurant: PublicRestaurant } | { kind: 'redirect'; slug: string } | null;

const redirectSchema = z.object({ redirect: z.string() });

export function parsePublicLookup(data: unknown): PublicLookup {
  if (data === null || data === undefined) return null;
  const redirect = redirectSchema.safeParse(data);
  if (redirect.success) return { kind: 'redirect', slug: redirect.data.redirect };
  return { kind: 'restaurant', restaurant: restaurantSchema.parse(data) };
}

/** Descripción en el idioma pedido o, si falta, en castellano. */
export function descriptionFor(r: PublicRestaurant, locale: Locale): string | null {
  return r.descriptions[locale] ?? r.descriptions.es ?? null;
}
```

- [ ] **Step 4: Formato, SEO y JSON-LD**

Create `src/lib/public/format.ts`:

```ts
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

/** 2 → '€€'. */
export function priceLabel(priceRange: number | null): string | null {
  return priceRange ? '€'.repeat(priceRange) : null;
}

/** 'Calle Mayor 1, 28013 Madrid'. null si no hay nada. */
export function fullAddress(r: { addressLine: string | null; postalCode: string | null; city: string | null }): string | null {
  const tail = [r.postalCode, r.city].filter(Boolean).join(' ');
  const parts = [r.addressLine, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Abre Google Maps con la ruta hasta el restaurante (sin geocodificar: usa la dirección escrita). */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address}, España`)}`;
}

/** Mapa incrustado. Solo se carga cuando el comensal pulsa "Ver mapa". */
export function mapEmbedUrl(address: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${address}, España`)}&output=embed`;
}

/** Ruta con ?lang= salvo para el castellano. */
export function withLang(path: string, locale: Locale | null | undefined): string {
  return !locale || locale === DEFAULT_LOCALE ? path : `${path}?lang=${locale}`;
}
```

Create `src/lib/public/seo.ts`:

```ts
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { withLang } from './format';
import { descriptionFor, type PublicRestaurant } from './restaurant-schema';

export function publicUrl(siteUrl: string, path: string, locale: Locale): string {
  return `${siteUrl}${withLang(path, locale)}`;
}

/** hreflang: una URL por idioma activo y x-default en castellano. */
export function languageAlternates(siteUrl: string, path: string, enabled: readonly Locale[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of enabled) out[locale] = publicUrl(siteUrl, path, locale);
  out['x-default'] = publicUrl(siteUrl, path, DEFAULT_LOCALE);
  return out;
}

/** Descripción para buscadores: la del restaurante o, si no hay, tipo de cocina y ciudad. Máximo 160 caracteres. */
export function metaDescription(r: PublicRestaurant, locale: Locale): string {
  const text = descriptionFor(r, locale) ?? [r.name, r.cuisine, r.city].filter(Boolean).join(' · ');
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 159).trimEnd()}…` : clean;
}

/** Open Graph usa idioma_PAÍS. */
export const OG_LOCALE: Record<Locale, string> = {
  es: 'es_ES',
  en: 'en_GB',
  ca: 'ca_ES',
  fr: 'fr_FR',
  de: 'de_DE',
  it: 'it_IT',
};
```

Create `src/lib/public/jsonld.ts`:

```ts
import { minutesToTime } from '@/lib/schedule';
import { priceLabel } from './format';
import type { PublicRestaurant } from './restaurant-schema';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Datos estructurados schema.org/Restaurant. Si "closes" es anterior a "opens", schema.org lo entiende como del día siguiente. */
export function restaurantJsonLd(
  r: PublicRestaurant,
  opts: { url: string; mediaUrl: (path: string) => string },
): Record<string, unknown> {
  const ld: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, url: opts.url };
  if (r.cuisine) ld.servesCuisine = r.cuisine;
  const price = priceLabel(r.priceRange);
  if (price) ld.priceRange = price;
  if (r.phone) ld.telephone = r.phone;
  if (r.contactEmail) ld.email = r.contactEmail;
  const images = [r.coverPath, ...r.photos].filter((p): p is string => Boolean(p)).map(opts.mediaUrl);
  if (images.length) ld.image = images;
  if (r.logoPath) ld.logo = opts.mediaUrl(r.logoPath);
  const sameAs = [r.instagram, r.facebook, r.tiktok].filter(Boolean);
  if (sameAs.length) ld.sameAs = sameAs;
  if (r.addressLine || r.city) {
    ld.address = {
      '@type': 'PostalAddress',
      ...(r.addressLine && { streetAddress: r.addressLine }),
      ...(r.postalCode && { postalCode: r.postalCode }),
      ...(r.city && { addressLocality: r.city }),
      addressCountry: 'ES',
    };
  }
  if (r.services.length) {
    ld.openingHoursSpecification = r.services.map((s) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${DAYS[s.weekday - 1]}`,
      opens: minutesToTime(s.startMinute),
      closes: minutesToTime(s.endMinute),
    }));
  }
  const special = r.exceptions.flatMap((e) =>
    e.kind === 'closed'
      ? [{ '@type': 'OpeningHoursSpecification', validFrom: e.dateFrom, validThrough: e.dateTo, opens: '00:00', closes: '00:00' }]
      : e.customServices.map((s) => ({
          '@type': 'OpeningHoursSpecification',
          validFrom: e.dateFrom,
          validThrough: e.dateTo,
          opens: minutesToTime(s.startMinute),
          closes: minutesToTime(s.endMinute),
        })),
  );
  if (special.length) ld.specialOpeningHoursSpecification = special;
  return ld;
}

/** JSON para <script type="application/ld+json">, sin '<' para que no se pueda cerrar la etiqueta. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
```

- [ ] **Step 5: Aviso legal**

Create `src/lib/legal/legal-notice.ts`:

```ts
import { BRAND } from '@/config/brand';
import { fullAddress } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';

type Holder = Pick<PublicRestaurant, 'name' | 'legalName' | 'taxId' | 'addressLine' | 'postalCode' | 'city' | 'contactEmail' | 'phone'>;

/** Aviso legal (LSSI-CE) de la mini-web. Plantilla en castellano, pendiente de revisión legal. */
export function legalNoticeSections(r: Holder): { heading: string; body: string }[] {
  const holder = r.legalName ?? r.name;
  const contact = [r.contactEmail, r.phone].filter(Boolean).join(' · ') || 'el del propio restaurante';
  return [
    {
      heading: 'Titular de la web',
      body:
        `En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), ` +
        `te informamos de que esta web pertenece a ${holder}, con CIF/NIF ${r.taxId ?? '—'} y domicilio en ${fullAddress(r) ?? '—'}. ` +
        `Contacto: ${contact}.`,
    },
    {
      heading: 'Para qué es esta web',
      body: `Muestra información de ${r.name}: horario, ubicación y formas de contacto.`,
    },
    {
      heading: 'Contenidos',
      body: `Los textos y las imágenes son de ${holder} o se usan con permiso. No se pueden copiar sin su autorización.`,
    },
    {
      heading: 'Responsabilidad',
      body: `${holder} intenta que la información esté siempre al día, pero el horario o los datos pueden cambiar. Si tienes dudas, contacta con el restaurante.`,
    },
    {
      heading: 'Plataforma',
      body: `Esta web funciona con ${BRAND.productName}, de ${BRAND.company}, que presta el servicio técnico a ${holder}.`,
    },
    {
      heading: 'Ley aplicable',
      body: 'Se aplica la legislación española.',
    },
  ];
}
```

- [ ] **Step 6: Ejecutar las pruebas**

Run: `pnpm test:unit src/lib/public src/lib/legal`
Expected: PASS (`restaurant-schema.test.ts`, `seo.test.ts`, `legal.test.ts`).

- [ ] **Step 7: Cliente sin cookies, lectura cacheada e idioma de la petición**

Create `src/lib/supabase/public.ts`:

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

/** Sin cookies ni sesión: siempre como anon. Para la mini-web, que es igual para todos y se cachea. */
export function createPublicClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
```

Create `src/lib/public/data.ts`:

```ts
import 'server-only';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { serverEnv } from '@/lib/env';
import { sortLocales, type Locale } from '@/lib/i18n/locales';
import { publicMediaUrl } from '@/lib/media';
import { isValidSlug } from '@/lib/slug';
import { createPublicClient } from '@/lib/supabase/public';
import { parsePublicLookup, type PublicLookup } from './restaurant-schema';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from './tags';

/** Una hora como red de seguridad; lo normal es que las acciones del panel invaliden al momento. */
const REVALIDATE_SECONDS = 3600;

/** Mini-web por dirección pública. Cacheada por slug; React cache() evita repetirla entre generateMetadata y la página. */
export const getPublicRestaurant = cache(async (rawSlug: string): Promise<PublicLookup> => {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidSlug(slug)) return null;
  return unstable_cache(
    async () => {
      const { data, error } = await createPublicClient().rpc('get_public_restaurant', { p_slug: slug });
      if (error) throw new Error(`get_public_restaurant: ${error.message}`);
      return parsePublicLookup(data);
    },
    ['public-restaurant', slug],
    { tags: [publicRestaurantTag(slug), PUBLIC_ALL_TAG], revalidate: REVALIDATE_SECONDS },
  )();
});

export type PublicSlug = { slug: string; enabledLocales: Locale[]; updatedAt: string };

export const getPublicSlugs = unstable_cache(
  async (): Promise<PublicSlug[]> => {
    const { data, error } = await createPublicClient().rpc('list_public_slugs');
    if (error) throw new Error(`list_public_slugs: ${error.message}`);
    return ((data ?? []) as { slug: string; enabled_locales: string[]; updated_at: string }[]).map((r) => ({
      slug: r.slug,
      enabledLocales: sortLocales(r.enabled_locales),
      updatedAt: r.updated_at,
    }));
  },
  ['public-slugs'],
  { tags: [PUBLIC_ALL_TAG], revalidate: REVALIDATE_SECONDS },
);

/** URL pública de una imagen del bucket restaurant-media. */
export function mediaUrl(path: string): string {
  return publicMediaUrl(serverEnv().NEXT_PUBLIC_SUPABASE_URL, path);
}
```

Create `src/lib/public/locale.ts`:

```ts
import 'server-only';
import { headers } from 'next/headers';
import { resolveLocale, type Locale } from '@/lib/i18n/locales';

/** Idioma de la petición: ?lang= y, si no, Accept-Language (solo entre los activos). */
export async function requestLocale(lang: string | undefined, enabled: readonly Locale[]): Promise<Locale> {
  const h = await headers();
  return resolveLocale({ lang, acceptLanguage: h.get('accept-language'), enabled });
}
```

- [ ] **Step 8: Comprobar tipos y estilo**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sin errores; todas las pruebas unitarias en verde.

- [ ] **Step 9: Commit**

```bash
git add src/lib/public src/lib/legal/legal-notice.ts src/lib/legal/legal.test.ts src/lib/supabase/public.ts
git commit -m "Datos públicos: lectura cacheada sin cookies, SEO, JSON-LD y aviso legal"
```

---

### Task 9: Base del panel: acciones, formularios y lectura de la ficha

**Files:**
- Create: `src/lib/actions/run.ts`, `src/lib/local/data.ts`, `src/components/forms/ActionForm.tsx`, `src/components/ui/SectionCard.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `requirePermission(restaurantId, permission): Promise<PanelContext>` y `type PanelContext`, `type RestaurantStatus` de `src/lib/auth/guards.ts`; `createClient()` de `src/lib/supabase/server.ts`; `mapDbError`; `uuidSchema`; `PUBLIC_ALL_TAG`, `publicRestaurantTag` (Task 8); `Field`, `inputClass`, `SelectField`, `Button`, `Notice`, `Card` (Hito 1).
- Produces:
  - `run.ts` (solo servidor): `type SupabaseServerClient`, `refreshRestaurant(restaurantId, slug, allPublic = false): void` (`updateTag` de la mini-web, y de todas si `allPublic`; `revalidatePath('/panel/<id>', 'layout')`), `runPanelAction(restaurantId, permission, fn: (supabase, ctx) => Promise<FormState>, opts?: { allPublic?: boolean }): Promise<FormState>`, `throwIfError(result: FormState): void`.
  - `local/data.ts` (solo servidor): `type RestaurantProfile` (camelCase de todas las columnas de la ficha + `status`, `publishedAt`), `type RestaurantLocal = { profile; descriptions: Partial<Record<Locale, string>>; photos: { id; path }[]; oldSlugs: string[] }`, `getRestaurantLocal(restaurantId): Promise<RestaurantLocal>`, `type RestaurantSchedule = { timezone; services: (ServiceSlot & { id })[]; exceptions: (ScheduleException & { id })[] }`, `getRestaurantSchedule(restaurantId)`, `getMissingFields(restaurantId): Promise<string[]>`.
  - `ActionForm.tsx` (cliente): `type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>`, `<ActionForm action hidden? readOnly? inline? submitLabel? pendingLabel? submitDisabled?>`, `useActionForm()`, `<FormField>` (props de `Field` sin `error`), `<FormSelect>` (props de `SelectField` sin `error`), `<FormTextArea label name hint? …textarea>`, `<FormCheckbox name label defaultChecked?>`, `<FormCheckboxGroup legend name options: { value; label; defaultChecked?; disabled? }[]>`, `<FormFieldError name>`.
  - `SectionCard.tsx`: `<SectionCard id? title intro?>{children}</SectionCard>`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md`, `revalidatePath.md`, `unstable_rethrow.md` y `05-config/01-next-config-js/serverActions.md`. Patrón de referencia: `src/lib/actions/team.ts`.

- [ ] **Step 1: Límite de cuerpo de las server actions**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Fotos ya comprimidas en el navegador (máx. 2 MB) + margen del multipart.
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
```

- [ ] **Step 2: Esqueleto de las acciones del panel**

Create `src/lib/actions/run.ts` (sin `'use server'`: exporta funciones síncronas y no es una acción en sí; se llama desde acciones):

```ts
import 'server-only';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requirePermission, type PanelContext } from '@/lib/auth/guards';
import { mapDbError } from '@/lib/db-errors';
import type { FormState } from '@/lib/forms';
import type { Permission } from '@/lib/permissions';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from '@/lib/public/tags';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Invalida la mini-web y refresca el panel. Solo desde server actions (updateTag lo exige).
 * allPublic: también el resto de mini-webs y el sitemap (cambios de slug o de estado).
 */
export function refreshRestaurant(restaurantId: string, slug: string, allPublic = false): void {
  updateTag(publicRestaurantTag(slug));
  if (allPublic) updateTag(PUBLIC_ALL_TAG);
  revalidatePath(`/panel/${restaurantId}`, 'layout');
}

/**
 * Esqueleto de las acciones del panel: comprueba permiso (no en modo soporte ni con el restaurante desactivado),
 * ejecuta fn con la sesión del usuario (RLS) y, si va bien, refresca.
 */
export async function runPanelAction(
  restaurantId: string,
  permission: Permission,
  fn: (supabase: SupabaseServerClient, ctx: PanelContext) => Promise<FormState>,
  opts: { allPublic?: boolean } = {},
): Promise<FormState> {
  if (!uuidSchema.safeParse(restaurantId).success) return { error: mapDbError('FORBIDDEN') };
  try {
    const ctx = await requirePermission(restaurantId, permission);
    const supabase = await createClient();
    const result = await fn(supabase, ctx);
    if (!result.error && !result.fieldErrors) refreshRestaurant(restaurantId, ctx.restaurant.slug, opts.allPublic);
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { error: mapDbError(e instanceof Error ? e.message : undefined) };
  }
}

/** Para acciones de formulario sin estado (botones Quitar, Subir/Bajar): si algo falla, lo recoge error.tsx. */
export function throwIfError(result: FormState): void {
  if (result.error) throw new Error(result.error);
}
```

- [ ] **Step 3: Lectura de la ficha y del horario para el panel**

Create `src/lib/local/data.ts`:

```ts
import 'server-only';
import type { RestaurantStatus } from '@/lib/auth/guards';
import { sortLocales, type Locale } from '@/lib/i18n/locales';
import type { ScheduleException, ServiceSlot } from '@/lib/schedule';
import { createClient } from '@/lib/supabase/server';

export type RestaurantProfile = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  timezone: 'Europe/Madrid' | 'Atlantic/Canary';
  enabledLocales: Locale[];
  cuisine: string | null;
  priceRange: number | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  accentColor: string;
  logoPath: string | null;
  coverPath: string | null;
  legalName: string | null;
  taxId: string | null;
  publishedAt: string | null;
};

const PROFILE_COLUMNS =
  'id, name, slug, status, timezone, enabled_locales, cuisine, price_range, address_line, postal_code, city, phone, ' +
  'contact_email, website, instagram, facebook, tiktok, accent_color, logo_path, cover_path, legal_name, tax_id, published_at';

type ProfileRow = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  timezone: 'Europe/Madrid' | 'Atlantic/Canary';
  enabled_locales: string[];
  cuisine: string | null;
  price_range: number | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  contact_email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  accent_color: string;
  logo_path: string | null;
  cover_path: string | null;
  legal_name: string | null;
  tax_id: string | null;
  published_at: string | null;
};

export type RestaurantLocal = {
  profile: RestaurantProfile;
  descriptions: Partial<Record<Locale, string>>;
  photos: { id: string; path: string }[];
  oldSlugs: string[];
};

/** Ficha completa para el panel, con la sesión del usuario (RLS). */
export async function getRestaurantLocal(restaurantId: string): Promise<RestaurantLocal> {
  const supabase = await createClient();
  const [restaurant, translations, photos, redirects] = await Promise.all([
    supabase.from('restaurants').select(PROFILE_COLUMNS).eq('id', restaurantId).single(),
    supabase.from('restaurant_translations').select('locale, description').eq('restaurant_id', restaurantId),
    supabase.from('restaurant_photos').select('id, path').eq('restaurant_id', restaurantId).order('position').order('created_at'),
    supabase.from('slug_redirects').select('old_slug').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`restaurants: ${restaurant.error?.message ?? 'sin datos'}`);
  const r = restaurant.data as unknown as ProfileRow;
  const descriptions: Partial<Record<Locale, string>> = {};
  for (const t of (translations.data ?? []) as { locale: Locale; description: string }[]) descriptions[t.locale] = t.description;
  return {
    profile: {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      timezone: r.timezone,
      enabledLocales: sortLocales(r.enabled_locales),
      cuisine: r.cuisine,
      priceRange: r.price_range,
      addressLine: r.address_line,
      postalCode: r.postal_code,
      city: r.city,
      phone: r.phone,
      contactEmail: r.contact_email,
      website: r.website,
      instagram: r.instagram,
      facebook: r.facebook,
      tiktok: r.tiktok,
      accentColor: r.accent_color,
      logoPath: r.logo_path,
      coverPath: r.cover_path,
      legalName: r.legal_name,
      taxId: r.tax_id,
      publishedAt: r.published_at,
    },
    descriptions,
    photos: (photos.data ?? []) as { id: string; path: string }[],
    oldSlugs: ((redirects.data ?? []) as { old_slug: string }[]).map((s) => s.old_slug),
  };
}

export type RestaurantSchedule = {
  timezone: string;
  services: (ServiceSlot & { id: string })[];
  exceptions: (ScheduleException & { id: string })[];
};

export async function getRestaurantSchedule(restaurantId: string): Promise<RestaurantSchedule> {
  const supabase = await createClient();
  const [restaurant, services, exceptions] = await Promise.all([
    supabase.from('restaurants').select('timezone').eq('id', restaurantId).single(),
    supabase
      .from('services')
      .select('id, name, weekday, start_minute, end_minute')
      .eq('restaurant_id', restaurantId)
      .order('weekday')
      .order('start_minute'),
    supabase
      .from('schedule_exceptions')
      .select('id, date_from, date_to, kind, custom_services, note')
      .eq('restaurant_id', restaurantId)
      .order('date_from'),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`restaurants: ${restaurant.error?.message ?? 'sin datos'}`);
  type ExceptionRow = {
    id: string;
    date_from: string;
    date_to: string;
    kind: 'closed' | 'custom';
    custom_services: { name: string; start_minute: number; end_minute: number }[];
    note: string | null;
  };
  return {
    timezone: (restaurant.data as { timezone: string }).timezone,
    services: ((services.data ?? []) as { id: string; name: string; weekday: number; start_minute: number; end_minute: number }[]).map(
      (s) => ({ id: s.id, name: s.name, weekday: s.weekday, startMinute: s.start_minute, endMinute: s.end_minute }),
    ),
    exceptions: ((exceptions.data ?? []) as ExceptionRow[]).map((e) => ({
      id: e.id,
      dateFrom: e.date_from,
      dateTo: e.date_to,
      kind: e.kind,
      customServices: e.custom_services.map((s) => ({ name: s.name, startMinute: s.start_minute, endMinute: s.end_minute })),
      note: e.note,
    })),
  };
}

/** Códigos de lo que falta para publicar (public.restaurant_missing_fields). */
export async function getMissingFields(restaurantId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('restaurant_missing_fields', { p_restaurant_id: restaurantId });
  if (error) throw new Error(`restaurant_missing_fields: ${error.message}`);
  return (data ?? []) as string[];
}
```

- [ ] **Step 4: Formulario con server action**

Create `src/components/forms/ActionForm.tsx`:

```tsx
'use client';

import { createContext, startTransition, useActionState, useContext, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SelectField } from '@/components/ui/SelectField';
import type { FormState } from '@/lib/forms';

export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: {}, pending: false });

export function useActionForm() {
  return useContext(FormContext);
}

/**
 * Formulario del panel con una server action (prev, fd) => FormState.
 * Se envía con onSubmit + startTransition en vez de action={…}: así React no vacía los campos
 * y, si hay errores, lo escrito se conserva. Los campos Form* leen sus errores del contexto.
 */
export function ActionForm({
  action,
  hidden = {},
  readOnly = false,
  inline = false,
  submitLabel = 'Guardar',
  pendingLabel = 'Guardando…',
  submitDisabled = false,
  children,
}: {
  action: FormAction;
  hidden?: Record<string, string>;
  readOnly?: boolean;
  inline?: boolean;
  submitLabel?: string;
  pendingLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(action, {});
  const layout = inline ? 'flex flex-wrap items-end gap-3' : 'flex flex-col gap-4';
  return (
    <FormContext value={{ state, pending }}>
      <form
        className={layout}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => dispatch(fd));
        }}
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <fieldset disabled={readOnly} className={`min-w-0 ${layout}`}>
          {children}
        </fieldset>
        {!readOnly && (
          <div>
            <Button type="submit" disabled={pending || submitDisabled} aria-busy={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        )}
        {state.error && (
          <div className="basis-full">
            <Notice tone="error">{state.error}</Notice>
          </div>
        )}
        {state.success && !pending && (
          <div className="basis-full">
            <Notice tone="success">{state.success}</Notice>
          </div>
        )}
      </form>
    </FormContext>
  );
}

export function FormField(props: Omit<ComponentProps<typeof Field>, 'error'>) {
  const { state } = useActionForm();
  return <Field {...props} error={state.fieldErrors?.[props.name]} />;
}

export function FormSelect(props: Omit<ComponentProps<typeof SelectField>, 'error'>) {
  const { state } = useActionForm();
  return <SelectField {...props} error={state.fieldErrors?.[props.name]} />;
}

export function FormFieldError({ name }: { name: string }) {
  const { state } = useActionForm();
  const error = state.fieldErrors?.[name];
  return error ? <p className="text-sm font-medium text-red-700">{error}</p> : null;
}

export function FormTextArea({
  label,
  name,
  hint,
  ...textarea
}: ComponentProps<'textarea'> & { label: string; name: string; hint?: string }) {
  const { state } = useActionForm();
  const error = state.fieldErrors?.[name];
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={inputClass}
        {...textarea}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormCheckbox({ name, label, defaultChecked }: { name: string; label: ReactNode; defaultChecked?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-start gap-2">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 size-4 accent-navy" />
        <span>{label}</span>
      </label>
      <FormFieldError name={name} />
    </div>
  );
}

export function FormCheckboxGroup({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; defaultChecked?: boolean; disabled?: boolean }[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={o.defaultChecked}
              disabled={o.disabled}
              className="size-4 accent-navy"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FormFieldError name={name} />
    </fieldset>
  );
}
```

Por qué `onSubmit` y no `action={…}`: con `action`, React 19 resetea el formulario al terminar y, si la acción devuelve errores, el usuario pierde lo escrito. Con `startTransition(() => dispatch(fd))` los campos no se tocan y `pending` sigue funcionando.

- [ ] **Step 5: Tarjeta de sección**

Create `src/components/ui/SectionCard.tsx`:

```tsx
import { Card } from './Card';

export function SectionCard({
  id,
  title,
  intro,
  children,
}: {
  id?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-extrabold">{title}</h2>
          {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
        </div>
        {children}
      </Card>
    </section>
  );
}
```

- [ ] **Step 6: Comprobar**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add next.config.ts src/lib/actions/run.ts src/lib/local/data.ts src/components/forms/ActionForm.tsx src/components/ui/SectionCard.tsx
git commit -m "Panel: base de acciones, formularios con errores por campo y lectura de la ficha"
```

---

### Task 10: Página «Local» del panel

**Files:**
- Create: `src/lib/actions/restaurant.ts`, `src/lib/actions/media.ts`
- Create: `src/components/local/ImageUploader.tsx`, `src/components/local/ImageSlot.tsx`, `src/components/local/Gallery.tsx`, `src/components/local/AccentColorField.tsx`
- Create: `src/app/panel/[restaurantId]/local/page.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4–9 (esquemas de `validation/local.ts`, `runPanelAction`, `ActionForm` y campos, `getRestaurantLocal`, `mediaUrl`, `checkSourceFile`, `compressImage`, `checkUpload`, `mediaPath`, `MEDIA_BUCKET`, `MAX_GALLERY_PHOTOS`, `accentTheme`, `LOCALES`, `LOCALE_LABELS_ES`); `requirePanelAccess`; `siteUrl()`.
- Produces:
  - `actions/restaurant.ts` (`'use server'`), todas `(prev: FormState, fd: FormData) => Promise<FormState>` con `restaurantId` en el formulario: `saveBasics`, `saveContact`, `saveSocial`, `saveAccentColor`, `saveLanguages`, `changeSlug` (invalida todas las mini-webs), `saveLegal`.
  - `actions/media.ts` (`'use server'`): `uploadRestaurantImage(fd: FormData): Promise<FormState>` (campos `restaurantId`, `kind`, `file`), `removeRestaurantImage(fd): Promise<void>` (`kind` = `logo` | `cover`), `deletePhoto(fd): Promise<void>` (`photoId`), `movePhoto(fd): Promise<void>` (`photoId`, `direction` = `up` | `down`).
  - Página `/panel/[restaurantId]/local` con secciones y anclas `#datos-basicos`, `#contacto`, `#redes`, `#imagen`, `#galeria`, `#idiomas`, `#direccion`, `#datos-fiscales`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md` (prop `unoptimized`: las fotos ya llegan reducidas y el plan gratuito de Supabase no transforma imágenes).

- [ ] **Step 1: Acciones de la ficha**

Create `src/lib/actions/restaurant.ts`:

```ts
'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { LOCALES } from '@/lib/i18n/locales';
import {
  accentColorSchema,
  basicsSchema,
  changeSlugSchema,
  contactSchema,
  languagesSchema,
  legalSchema,
  socialSchema,
} from '@/lib/validation/local';
import { runPanelAction, type SupabaseServerClient } from './run';

const SAVED = 'Guardado.';

function restaurantIdOf(fd: FormData): string {
  return String(fd.get('restaurantId') ?? '');
}

/** UPDATE con la sesión del usuario; si la RLS no deja tocar la fila, devuelve 0 filas → sin permiso. */
async function updateRestaurant(
  supabase: SupabaseServerClient,
  restaurantId: string,
  values: Record<string, unknown>,
): Promise<FormState> {
  const { data, error } = await supabase.from('restaurants').update(values).eq('id', restaurantId).select('id');
  if (error) return { error: mapDbError(error.message) };
  if (!data?.length) return { error: mapDbError('FORBIDDEN') };
  return { success: SAVED };
}

const BASICS_FIELDS = [
  'name',
  'cuisine',
  'priceRange',
  'timezone',
  ...LOCALES.map((l) => `description_${l}` as const),
] as const;

export async function saveBasics(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = basicsSchema.safeParse(formStrings(fd, BASICS_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { name, cuisine, priceRange, timezone } = parsed.data;
  // Solo los idiomas que venían en el formulario (los activos); el resto no se toca.
  const descriptions: Record<string, string> = {};
  for (const locale of LOCALES) {
    const key = `description_${locale}` as const;
    if (fd.has(key)) descriptions[locale] = parsed.data[key];
  }
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const saved = await updateRestaurant(supabase, restaurantId, { name, cuisine, price_range: priceRange, timezone });
    if (saved.error) return saved;
    const { error } = await supabase.rpc('save_restaurant_translations', {
      p_restaurant_id: restaurantId,
      p_descriptions: descriptions,
    });
    if (error) return { error: mapDbError(error.message) };
    return { success: 'Datos básicos guardados.' };
  });
}

export async function saveContact(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = contactSchema.safeParse(formStrings(fd, ['addressLine', 'postalCode', 'city', 'phone', 'contactEmail', 'website']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) =>
    updateRestaurant(supabase, restaurantId, {
      address_line: d.addressLine,
      postal_code: d.postalCode,
      city: d.city,
      phone: d.phone,
      contact_email: d.contactEmail,
      website: d.website,
    }),
  );
}

export async function saveSocial(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = socialSchema.safeParse(formStrings(fd, ['instagram', 'facebook', 'tiktok']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) => updateRestaurant(supabase, restaurantId, parsed.data));
}

export async function saveAccentColor(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = accentColorSchema.safeParse(formStrings(fd, ['accentColor']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) =>
    updateRestaurant(supabase, restaurantId, { accent_color: parsed.data.accentColor }),
  );
}

export async function saveLanguages(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = languagesSchema.safeParse({ locales: fd.getAll('locales') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const saved = await updateRestaurant(supabase, restaurantId, { enabled_locales: parsed.data.locales });
    return saved.error ? saved : { success: 'Idiomas guardados. Escribe la descripción en cada uno en «Datos básicos».' };
  });
}

export async function changeSlug(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = changeSlugSchema.safeParse(formStrings(fd, ['slug']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(
    restaurantId,
    'restaurant.edit',
    async (supabase) => {
      const { error } = await supabase.rpc('change_slug', { p_restaurant_id: restaurantId, p_new_slug: parsed.data.slug });
      if (error) return { error: mapDbError(error.message) };
      return { success: 'Dirección cambiada. La antigua sigue funcionando y lleva a la nueva.' };
    },
    { allPublic: true },
  );
}

export async function saveLegal(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = legalSchema.safeParse(formStrings(fd, ['legalName', 'taxId']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) =>
    updateRestaurant(supabase, restaurantId, { legal_name: parsed.data.legalName, tax_id: parsed.data.taxId }),
  );
}
```

- [ ] **Step 2: Acciones de imágenes**

Create `src/lib/actions/media.ts`:

```ts
'use server';

import { mapDbError } from '@/lib/db-errors';
import type { FormState } from '@/lib/forms';
import { checkUpload, extensionFor, isMediaKind, MEDIA_BUCKET, mediaPath } from '@/lib/media';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError } from './run';

type ImageColumns = { logo_path: string | null; cover_path: string | null };

/** Sube una imagen ya comprimida en el navegador. Logo y portada sustituyen a la anterior; la galería añade al final. */
export async function uploadRestaurantImage(fd: FormData): Promise<FormState> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const kind = fd.get('kind');
  const file = fd.get('file');
  if (!isMediaKind(kind) || !(file instanceof File)) return { error: mapDbError(undefined) };
  const problem = checkUpload(file);
  if (problem) return { error: problem };
  const ext = extensionFor(file.type) ?? 'webp';

  return runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const path = mediaPath(restaurantId, kind, ext, crypto.randomUUID());
    const { error: uploadError } = await bucket.upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) return { error: mapDbError(uploadError.message) };

    if (kind === 'gallery') {
      const { data: last } = await supabase
        .from('restaurant_photos')
        .select('position')
        .eq('restaurant_id', restaurantId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      const position = ((last as { position: number } | null)?.position ?? -1) + 1;
      const { error } = await supabase.from('restaurant_photos').insert({ restaurant_id: restaurantId, path, position });
      if (error) {
        await bucket.remove([path]);
        return { error: mapDbError(error.message) };
      }
      return { success: 'Foto añadida.' };
    }

    const column = kind === 'logo' ? 'logo_path' : 'cover_path';
    const { data: current } = await supabase.from('restaurants').select('logo_path, cover_path').eq('id', restaurantId).single();
    const { data, error } = await supabase.from('restaurants').update({ [column]: path }).eq('id', restaurantId).select('id');
    if (error || !data?.length) {
      await bucket.remove([path]);
      return { error: mapDbError(error?.message ?? 'FORBIDDEN') };
    }
    const previous = (current as ImageColumns | null)?.[column];
    if (previous) await bucket.remove([previous]);
    return { success: kind === 'logo' ? 'Logo actualizado.' : 'Portada actualizada.' };
  });
}

export async function removeRestaurantImage(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const kind = fd.get('kind');
  if (kind !== 'logo' && kind !== 'cover') return;
  const column = kind === 'logo' ? 'logo_path' : 'cover_path';
  const result = await runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const { data: current } = await supabase.from('restaurants').select('logo_path, cover_path').eq('id', restaurantId).single();
    const { data, error } = await supabase.from('restaurants').update({ [column]: null }).eq('id', restaurantId).select('id');
    if (error || !data?.length) return { error: mapDbError(error?.message ?? 'FORBIDDEN') };
    const previous = (current as ImageColumns | null)?.[column];
    if (previous) await supabase.storage.from(MEDIA_BUCKET).remove([previous]);
    return { success: 'Imagen quitada.' };
  });
  throwIfError(result);
}

export async function deletePhoto(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const photoId = String(fd.get('photoId') ?? '');
  if (!uuidSchema.safeParse(photoId).success) return;
  const result = await runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const { data, error } = await supabase
      .from('restaurant_photos')
      .delete()
      .eq('id', photoId)
      .eq('restaurant_id', restaurantId)
      .select('path');
    if (error) return { error: mapDbError(error.message) };
    const path = (data as { path: string }[] | null)?.[0]?.path;
    if (!path) return { error: mapDbError('FORBIDDEN') };
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    return { success: 'Foto borrada.' };
  });
  throwIfError(result);
}

/** Sube o baja una foto un puesto y deja las posiciones seguidas (0, 1, 2…). */
export async function movePhoto(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const photoId = String(fd.get('photoId') ?? '');
  const direction = fd.get('direction') === 'up' ? -1 : 1;
  if (!uuidSchema.safeParse(photoId).success) return;
  const result = await runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const { data, error } = await supabase
      .from('restaurant_photos')
      .select('id, position')
      .eq('restaurant_id', restaurantId)
      .order('position')
      .order('created_at');
    if (error) return { error: mapDbError(error.message) };
    const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
    const from = ids.indexOf(photoId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return { success: 'Sin cambios.' };
    [ids[from], ids[to]] = [ids[to], ids[from]];
    for (const [position, id] of ids.entries()) {
      const { error: updateError } = await supabase.from('restaurant_photos').update({ position }).eq('id', id);
      if (updateError) return { error: mapDbError(updateError.message) };
    }
    return { success: 'Orden guardado.' };
  });
  throwIfError(result);
}
```

La subida usa la sesión del usuario: Storage aplica las políticas `restaurant_media_*` de la Task 1. Si después falla guardar la ruta en la BD, se borra el archivo recién subido; si va bien, se borra el anterior.

- [ ] **Step 3: Subida de imágenes en el navegador**

Create `src/components/local/ImageUploader.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { uploadRestaurantImage } from '@/lib/actions/media';
import type { FormState } from '@/lib/forms';
import { checkSourceFile, compressImage } from '@/lib/images/compress';
import type { MediaKind } from '@/lib/media';

/** Elige fotos, las reduce y pasa a WebP en el navegador y las sube una a una con la server action. */
export function ImageUploader({
  restaurantId,
  kind,
  label,
  multiple = false,
  disabled = false,
}: {
  restaurantId: string;
  kind: MediaKind;
  label: string;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  function upload(files: File[]) {
    startTransition(async () => {
      setState({});
      for (const file of files) {
        const problem = checkSourceFile(file);
        if (problem) {
          setState({ error: problem });
          return;
        }
        let blob: Blob;
        try {
          blob = await compressImage(file, kind);
        } catch {
          setState({ error: 'No hemos podido preparar esa foto. Prueba con otra.' });
          return;
        }
        const fd = new FormData();
        fd.set('restaurantId', restaurantId);
        fd.set('kind', kind);
        fd.set('file', new File([blob], blob.type === 'image/webp' ? 'foto.webp' : 'foto.jpg', { type: blob.type }));
        const result = await uploadRestaurantImage(fd);
        setState(result);
        if (result.error) return;
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={buttonClass('secondary', disabled || pending ? 'pointer-events-none opacity-50' : 'cursor-pointer')}>
        {pending ? 'Subiendo…' : label}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={multiple}
          disabled={disabled || pending}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length) upload(files);
          }}
        />
      </label>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.success && !pending && <Notice tone="success">{state.success}</Notice>}
    </div>
  );
}
```

- [ ] **Step 4: Logo/portada, galería y color**

Create `src/components/local/ImageSlot.tsx`:

```tsx
import Image from 'next/image';
import { removeRestaurantImage } from '@/lib/actions/media';
import { ImageUploader } from './ImageUploader';

/** Logo o portada: vista previa, subir y quitar. */
export function ImageSlot({
  restaurantId,
  kind,
  title,
  hint,
  url,
  readOnly,
}: {
  restaurantId: string;
  kind: 'logo' | 'cover';
  title: string;
  hint: string;
  url: string | null;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-bold">{title}</h3>
      <div
        className={`relative overflow-hidden rounded-[6px] border-2 border-ink/15 bg-paper ${kind === 'logo' ? 'size-32' : 'aspect-video w-full'}`}
      >
        {url ? (
          <Image src={url} alt="" fill unoptimized sizes="(min-width: 640px) 50vw, 100vw" className={kind === 'logo' ? 'object-contain' : 'object-cover'} />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-sm text-muted">Sin imagen</span>
        )}
      </div>
      <p className="text-sm text-muted">{hint}</p>
      {!readOnly && (
        <div className="flex flex-wrap items-start gap-3">
          <ImageUploader restaurantId={restaurantId} kind={kind} label={url ? 'Cambiar' : 'Subir'} />
          {url && (
            <form action={removeRestaurantImage}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="kind" value={kind} />
              <button type="submit" className="px-2 py-3 text-sm font-bold text-navy hover:underline">
                Quitar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
```

Create `src/components/local/Gallery.tsx`:

```tsx
import Image from 'next/image';
import { deletePhoto, movePhoto } from '@/lib/actions/media';
import { MAX_GALLERY_PHOTOS } from '@/lib/media';
import { ImageUploader } from './ImageUploader';

export function Gallery({
  restaurantId,
  photos,
  readOnly,
}: {
  restaurantId: string;
  photos: { id: string; url: string }[];
  readOnly: boolean;
}) {
  const full = photos.length >= MAX_GALLERY_PHOTOS;
  return (
    <div className="flex flex-col gap-4">
      {photos.length === 0 ? (
        <p className="text-sm text-muted">Aún no hay fotos. Sube las que mejor enseñen tu local y tus platos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[6px] border-2 border-ink/15">
                <Image src={p.url} alt={`Foto ${i + 1}`} fill unoptimized sizes="(min-width: 640px) 33vw, 50vw" className="object-cover" />
              </div>
              {!readOnly && (
                <div className="flex items-center justify-between gap-1 text-sm font-bold">
                  <span className="flex gap-1">
                    {(['up', 'down'] as const).map((direction) => (
                      <form key={direction} action={movePhoto}>
                        <input type="hidden" name="restaurantId" value={restaurantId} />
                        <input type="hidden" name="photoId" value={p.id} />
                        <input type="hidden" name="direction" value={direction} />
                        <button
                          type="submit"
                          disabled={direction === 'up' ? i === 0 : i === photos.length - 1}
                          aria-label={direction === 'up' ? `Mover la foto ${i + 1} antes` : `Mover la foto ${i + 1} después`}
                          className="rounded-[6px] px-2 py-1 hover:bg-peach-soft disabled:opacity-30"
                        >
                          {direction === 'up' ? '←' : '→'}
                        </button>
                      </form>
                    ))}
                  </span>
                  <form action={deletePhoto}>
                    <input type="hidden" name="restaurantId" value={restaurantId} />
                    <input type="hidden" name="photoId" value={p.id} />
                    <button type="submit" className="px-2 py-1 text-red-700 hover:underline">
                      Borrar
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-col gap-1">
          <ImageUploader restaurantId={restaurantId} kind="gallery" label="Añadir fotos" multiple disabled={full} />
          <p className="text-sm text-muted">
            {full ? `Has llegado al máximo de ${MAX_GALLERY_PHOTOS} fotos.` : `Hasta ${MAX_GALLERY_PHOTOS} fotos. Las reducimos antes de subirlas.`}
          </p>
        </div>
      )}
    </div>
  );
}
```

Create `src/components/local/AccentColorField.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { FormFieldError } from '@/components/forms/ActionForm';
import { accentTheme, normalizeHex } from '@/lib/color';

/** Selector del color de acento con vista previa del botón y aviso si no se lee bien. */
export function AccentColorField({ defaultValue }: { defaultValue: string }) {
  const [color, setColor] = useState(defaultValue);
  const theme = accentTheme(normalizeHex(color));
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="f-accentColor" className="text-sm font-bold">
        Color de tu web
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <input
          id="f-accentColor"
          type="color"
          name="accentColor"
          value={color}
          onChange={(e) => setColor(e.currentTarget.value.toUpperCase())}
          className="h-11 w-16 cursor-pointer rounded-[6px] border-2 border-ink/25 bg-white"
        />
        <span
          className="rounded-[6px] px-5 py-3 font-bold"
          style={{ backgroundColor: theme.accent, color: theme.onAccent }}
          aria-hidden="true"
        >
          Cómo llegar
        </span>
        <span className="font-mono text-sm">{normalizeHex(color) ?? color}</span>
      </div>
      {!theme.meetsAA && (
        <p className="text-sm font-medium text-red-700">Con este color el texto de los botones no se lee bien. Prueba uno más claro o más oscuro.</p>
      )}
      <FormFieldError name="accentColor" />
    </div>
  );
}
```

- [ ] **Step 5: Página «Local»**

Create `src/app/panel/[restaurantId]/local/page.tsx` (llama a `requirePanelAccess(restaurantId, 'restaurant.edit')`, como pide AGENTS.md; en modo soporte de FByte todo se ve pero no se puede tocar):

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, FormCheckboxGroup, FormField, FormSelect, FormTextArea } from '@/components/forms/ActionForm';
import { AccentColorField } from '@/components/local/AccentColorField';
import { Gallery } from '@/components/local/Gallery';
import { ImageSlot } from '@/components/local/ImageSlot';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  changeSlug,
  saveAccentColor,
  saveBasics,
  saveContact,
  saveLanguages,
  saveLegal,
  saveSocial,
} from '@/lib/actions/restaurant';
import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { LOCALE_LABELS_ES, LOCALES } from '@/lib/i18n/locales';
import { getRestaurantLocal } from '@/lib/local/data';
import { mediaUrl } from '@/lib/public/data';

export const metadata: Metadata = { title: 'Local' };

const PRICE_OPTIONS = [
  { value: '', label: 'Sin indicar' },
  { value: '1', label: '€ · económico' },
  { value: '2', label: '€€ · normal' },
  { value: '3', label: '€€€ · alto' },
  { value: '4', label: '€€€€ · muy alto' },
];

const TIMEZONE_OPTIONS = [
  { value: 'Europe/Madrid', label: 'Península, Baleares, Ceuta y Melilla' },
  { value: 'Atlantic/Canary', label: 'Canarias' },
];

export default async function LocalPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'restaurant.edit');
  const readOnly = ctx.readOnly;
  const { profile, descriptions, photos, oldSlugs } = await getRestaurantLocal(restaurantId);
  const hidden = { restaurantId };
  const publicUrl = `${siteUrl()}/${profile.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Tu local</h1>
        <p className="mt-1 text-muted">
          Esto es lo que verán tus clientes en tu web.{' '}
          {profile.status === 'active' ? (
            <Link href={`/${profile.slug}`} target="_blank" className="font-bold text-navy hover:underline">
              Ver mi web
            </Link>
          ) : (
            'Se verá cuando la publiques desde el inicio del panel.'
          )}
        </p>
      </header>

      <SectionCard id="datos-basicos" title="Datos básicos" intro="El nombre, qué cocina haces y una descripción corta.">
        <ActionForm action={saveBasics} hidden={hidden} readOnly={readOnly}>
          <FormField label="Nombre del restaurante" name="name" defaultValue={profile.name} maxLength={120} required />
          <FormField
            label="Tipo de cocina"
            name="cuisine"
            defaultValue={profile.cuisine ?? ''}
            maxLength={60}
            hint="Por ejemplo: mediterránea, japonesa, de mercado."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect label="Rango de precio" name="priceRange" defaultValue={profile.priceRange ? String(profile.priceRange) : ''} options={PRICE_OPTIONS} />
            <FormSelect label="Dónde está" name="timezone" defaultValue={profile.timezone} options={TIMEZONE_OPTIONS} />
          </div>
          {profile.enabledLocales.map((locale) => (
            <FormTextArea
              key={locale}
              label={`Descripción (${LOCALE_LABELS_ES[locale]})`}
              name={`description_${locale}`}
              defaultValue={descriptions[locale] ?? ''}
              maxLength={1000}
              rows={4}
              hint={
                locale === 'es'
                  ? 'Cuenta en pocas líneas qué hace especial tu restaurante. Máximo 1000 caracteres.'
                  : 'Si la dejas vacía, se muestra la de castellano.'
              }
            />
          ))}
        </ActionForm>
      </SectionCard>

      <SectionCard id="contacto" title="Contacto y ubicación" intro="Para que te encuentren y te llamen. Hace falta un teléfono o un email.">
        <ActionForm action={saveContact} hidden={hidden} readOnly={readOnly}>
          <FormField label="Calle y número" name="addressLine" defaultValue={profile.addressLine ?? ''} maxLength={200} autoComplete="street-address" />
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <FormField label="Código postal" name="postalCode" defaultValue={profile.postalCode ?? ''} inputMode="numeric" maxLength={5} autoComplete="postal-code" />
            <FormField label="Ciudad" name="city" defaultValue={profile.city ?? ''} maxLength={100} autoComplete="address-level2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Teléfono" name="phone" type="tel" defaultValue={profile.phone ?? ''} autoComplete="tel" />
            <FormField label="Email de contacto" name="contactEmail" type="email" defaultValue={profile.contactEmail ?? ''} autoComplete="email" />
          </div>
          <FormField label="Web" name="website" defaultValue={profile.website ?? ''} placeholder="https://turestaurante.es" hint="Si ya tienes otra web. Es opcional." />
        </ActionForm>
      </SectionCard>

      <SectionCard id="redes" title="Redes sociales" intro="Escribe tu usuario o pega el enlace. Lo dejamos bien escrito.">
        <ActionForm action={saveSocial} hidden={hidden} readOnly={readOnly}>
          <FormField label="Instagram" name="instagram" defaultValue={profile.instagram ?? ''} placeholder="@turestaurante" />
          <FormField label="Facebook" name="facebook" defaultValue={profile.facebook ?? ''} placeholder="https://www.facebook.com/turestaurante" />
          <FormField label="TikTok" name="tiktok" defaultValue={profile.tiktok ?? ''} placeholder="@turestaurante" />
        </ActionForm>
      </SectionCard>

      <SectionCard id="imagen" title="Imagen" intro="Logo, foto de portada y el color de los botones de tu web.">
        <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
          <ImageSlot
            restaurantId={restaurantId}
            kind="logo"
            title="Logo"
            hint="Cuadrado, mejor con fondo transparente."
            url={profile.logoPath ? mediaUrl(profile.logoPath) : null}
            readOnly={readOnly}
          />
          <ImageSlot
            restaurantId={restaurantId}
            kind="cover"
            title="Portada"
            hint="Una foto horizontal del local o de un plato."
            url={profile.coverPath ? mediaUrl(profile.coverPath) : null}
            readOnly={readOnly}
          />
        </div>
        <ActionForm action={saveAccentColor} hidden={hidden} readOnly={readOnly} submitLabel="Guardar color">
          <AccentColorField defaultValue={profile.accentColor} />
        </ActionForm>
      </SectionCard>

      <SectionCard id="galeria" title="Galería" intro="Fotos del local y de tus platos. La primera es la que se ve antes.">
        <Gallery restaurantId={restaurantId} photos={photos.map((p) => ({ id: p.id, url: mediaUrl(p.path) }))} readOnly={readOnly} />
      </SectionCard>

      <SectionCard id="idiomas" title="Idiomas" intro="En qué idiomas se ve tu web. El castellano va siempre.">
        <ActionForm action={saveLanguages} hidden={hidden} readOnly={readOnly}>
          <FormCheckboxGroup
            legend="Idiomas de tu web"
            name="locales"
            options={LOCALES.map((l) => ({
              value: l,
              label: LOCALE_LABELS_ES[l],
              defaultChecked: profile.enabledLocales.includes(l),
              disabled: l === 'es',
            }))}
          />
          <p className="text-sm text-muted">Los botones y textos de la web se traducen solos. Tu descripción la escribes tú en «Datos básicos».</p>
        </ActionForm>
      </SectionCard>

      <SectionCard id="direccion" title="Dirección de tu web" intro={publicUrl}>
        <Notice tone="info">
          Si la cambias, la dirección antigua seguirá llevando a la nueva, así que los QR que ya tengas impresos siguen valiendo.
        </Notice>
        <ActionForm action={changeSlug} hidden={hidden} readOnly={readOnly} submitLabel="Cambiar dirección" pendingLabel="Cambiando…">
          <FormField label="Dirección" name="slug" defaultValue={profile.slug} maxLength={60} hint="Solo minúsculas, números y guiones." required />
        </ActionForm>
        {oldSlugs.length > 0 && (
          <p className="text-sm text-muted">Direcciones antiguas que siguen funcionando: {oldSlugs.map((s) => `/${s}`).join(', ')}</p>
        )}
      </SectionCard>

      <SectionCard id="datos-fiscales" title="Datos fiscales" intro="Salen en el aviso legal de tu web. La ley lo pide.">
        <ActionForm action={saveLegal} hidden={hidden} readOnly={readOnly}>
          <FormField label="Razón social" name="legalName" defaultValue={profile.legalName ?? ''} maxLength={200} hint="El nombre de tu empresa, o el tuyo si eres autónomo." />
          <FormField label="CIF o NIF" name="taxId" defaultValue={profile.taxId ?? ''} maxLength={12} autoCapitalize="characters" />
        </ActionForm>
      </SectionCard>
    </div>
  );
}
```

- [ ] **Step 6: Comprobar**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; en la lista de rutas aparece `ƒ /panel/[restaurantId]/local`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/actions/restaurant.ts src/lib/actions/media.ts src/components/local "src/app/panel/[restaurantId]/local"
git commit -m "Panel: ficha del local con datos, contacto, redes, imágenes, galería, idiomas, dirección y datos fiscales"
```

---

### Task 11: Página «Horario» del panel

**Files:**
- Create: `src/lib/actions/schedule.ts`
- Create: `src/components/schedule/ServiceRow.tsx`, `src/components/schedule/ExceptionItem.tsx`
- Create: `src/app/panel/[restaurantId]/horario/page.tsx`

**Interfaces:**
- Consumes: Task 2 (tablas), Task 4 (`findOverlap`, `formatRange`, `minutesToTime`, `groupByWeekday`, `todayInTimeZone`, `upcomingExceptions`, `formatDateEs`, `WEEKDAYS`, `WEEKDAY_LABELS_ES`, `isWeekday`), Task 7 (`serviceSchema`, `newServicesSchema`, `exceptionSchema`), Task 9 (`runPanelAction`, `throwIfError`, `ActionForm` y campos, `getRestaurantSchedule`, `SectionCard`).
- Produces (`'use server'`, permiso `settings.booking`): `addServices(prev, fd)` (`name`, `start`, `end`, `weekdays[]`), `updateService(prev, fd)` (`serviceId`, `name`, `start`, `end`), `deleteService(fd): Promise<void>` (`serviceId`), `addException(prev, fd)` (`dateFrom`, `dateTo`, `kind`, `note`, `name1`…`end2`), `deleteException(fd): Promise<void>` (`exceptionId`). Página `/panel/[restaurantId]/horario`.

- [ ] **Step 1: Acciones del horario**

Create `src/lib/actions/schedule.ts` (comprueba solapes antes de escribir, también con lo que pasa de medianoche; la restricción de la BD es la red de seguridad):

```ts
'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { findOverlap, formatRange, isWeekday, WEEKDAY_LABELS_ES, type ServiceSlot } from '@/lib/schedule';
import { exceptionSchema, newServicesSchema, serviceSchema } from '@/lib/validation/schedule';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError, type SupabaseServerClient } from './run';

type ServiceRow = { id: string; name: string; weekday: number; start_minute: number; end_minute: number };

async function loadServices(supabase: SupabaseServerClient, restaurantId: string): Promise<ServiceSlot[] | null> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, weekday, start_minute, end_minute')
    .eq('restaurant_id', restaurantId);
  if (error) return null;
  return ((data ?? []) as ServiceRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    weekday: s.weekday,
    startMinute: s.start_minute,
    endMinute: s.end_minute,
  }));
}

function overlapMessage(clash: ServiceSlot): string {
  const day = isWeekday(clash.weekday) ? WEEKDAY_LABELS_ES[clash.weekday].toLowerCase() : '';
  return `Se solapa con «${clash.name}» del ${day} (${formatRange(clash.startMinute, clash.endMinute)}).`;
}

export async function addServices(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = newServicesSchema.safeParse({ ...formStrings(fd, ['name', 'start', 'end']), weekdays: fd.getAll('weekdays') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { name, weekdays, startMinute, endMinute } = parsed.data;
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const slots = await loadServices(supabase, restaurantId);
    if (!slots) return { error: mapDbError(undefined) };
    for (const weekday of weekdays) {
      const candidate = { name, weekday, startMinute, endMinute };
      const clash = findOverlap(slots, candidate);
      if (clash) return { fieldErrors: { start: overlapMessage(clash) } };
      slots.push(candidate);
    }
    const { error } = await supabase.from('services').insert(
      weekdays.map((weekday) => ({
        restaurant_id: restaurantId,
        name,
        weekday,
        start_minute: startMinute,
        end_minute: endMinute,
      })),
    );
    if (error) return { error: mapDbError(error.message) };
    return { success: weekdays.length === 1 ? 'Servicio añadido.' : `Servicio añadido en ${weekdays.length} días.` };
  });
}

export async function updateService(_prev: FormState, fd: FormData): Promise<FormState> {
  const serviceId = String(fd.get('serviceId') ?? '');
  if (!uuidSchema.safeParse(serviceId).success) return { error: mapDbError(undefined) };
  const parsed = serviceSchema.safeParse(formStrings(fd, ['name', 'start', 'end']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const slots = await loadServices(supabase, restaurantId);
    const current = slots?.find((s) => s.id === serviceId);
    if (!slots || !current) return { error: mapDbError('FORBIDDEN') };
    const clash = findOverlap(slots, { ...current, ...parsed.data });
    if (clash) return { fieldErrors: { start: overlapMessage(clash) } };
    const { error } = await supabase
      .from('services')
      .update({ name: parsed.data.name, start_minute: parsed.data.startMinute, end_minute: parsed.data.endMinute })
      .eq('id', serviceId)
      .eq('restaurant_id', restaurantId);
    if (error) return { error: mapDbError(error.message) };
    return { success: 'Servicio guardado.' };
  });
}

export async function deleteService(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const serviceId = String(fd.get('serviceId') ?? '');
  if (!uuidSchema.safeParse(serviceId).success) return;
  const result = await runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const { error } = await supabase.from('services').delete().eq('id', serviceId).eq('restaurant_id', restaurantId);
    return error ? { error: mapDbError(error.message) } : { success: 'Servicio quitado.' };
  });
  throwIfError(result);
}

export async function addException(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = exceptionSchema.safeParse(
    formStrings(fd, ['dateFrom', 'dateTo', 'kind', 'note', 'name1', 'start1', 'end1', 'name2', 'start2', 'end2']),
  );
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const { error } = await supabase.from('schedule_exceptions').insert({
      restaurant_id: restaurantId,
      date_from: d.dateFrom,
      date_to: d.dateTo,
      kind: d.kind,
      custom_services: d.customServices,
      note: d.note,
    });
    if (error) return { error: mapDbError(error.message) };
    return { success: d.kind === 'closed' ? 'Cierre guardado.' : 'Horario especial guardado.' };
  });
}

export async function deleteException(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const exceptionId = String(fd.get('exceptionId') ?? '');
  if (!uuidSchema.safeParse(exceptionId).success) return;
  const result = await runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const { error } = await supabase
      .from('schedule_exceptions')
      .delete()
      .eq('id', exceptionId)
      .eq('restaurant_id', restaurantId);
    return error ? { error: mapDbError(error.message) } : { success: 'Quitado.' };
  });
  throwIfError(result);
}
```

- [ ] **Step 2: Fila de servicio y cierre**

Create `src/components/schedule/ServiceRow.tsx`:

```tsx
import { ActionForm, FormField } from '@/components/forms/ActionForm';
import { deleteService, updateService } from '@/lib/actions/schedule';
import { formatRange, minutesToTime, type ServiceSlot } from '@/lib/schedule';

export function ServiceRow({
  restaurantId,
  service,
  readOnly,
}: {
  restaurantId: string;
  service: ServiceSlot & { id: string };
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <li className="py-1">
        <strong>{service.name}</strong> · {formatRange(service.startMinute, service.endMinute)}
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 border-b border-ink/10 py-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <ActionForm
          action={updateService}
          hidden={{ restaurantId, serviceId: service.id }}
          inline
          submitLabel="Guardar"
        >
          <FormField id={`name-${service.id}`} label="Servicio" name="name" defaultValue={service.name} maxLength={40} required />
          <FormField id={`start-${service.id}`} label="Empieza" name="start" type="time" defaultValue={minutesToTime(service.startMinute)} required />
          <FormField id={`end-${service.id}`} label="Acaba" name="end" type="time" defaultValue={minutesToTime(service.endMinute)} required />
        </ActionForm>
      </div>
      <form action={deleteService}>
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="serviceId" value={service.id} />
        <button type="submit" className="px-2 py-3 text-sm font-bold text-red-700 hover:underline">
          Quitar
        </button>
      </form>
    </li>
  );
}
```

Create `src/components/schedule/ExceptionItem.tsx`:

```tsx
import { deleteException } from '@/lib/actions/schedule';
import { formatDateEs, formatRange, type ScheduleException } from '@/lib/schedule';

export function ExceptionItem({
  restaurantId,
  exception,
  readOnly,
}: {
  restaurantId: string;
  exception: ScheduleException & { id: string };
  readOnly: boolean;
}) {
  const { dateFrom, dateTo, kind, customServices, note } = exception;
  const dates = dateFrom === dateTo ? formatDateEs(dateFrom) : `${formatDateEs(dateFrom)} – ${formatDateEs(dateTo)}`;
  const detail =
    kind === 'closed'
      ? 'Cerrado'
      : `Horario especial: ${customServices.map((s) => `${s.name} ${formatRange(s.startMinute, s.endMinute)}`).join(' · ')}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 py-3">
      <span>
        <strong>{dates}</strong> · {detail}
        {note && <span className="block text-sm text-muted">{note}</span>}
      </span>
      {!readOnly && (
        <form action={deleteException}>
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="exceptionId" value={exception.id} />
          <button type="submit" className="text-sm font-bold text-red-700 hover:underline">
            Quitar
          </button>
        </form>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Página «Horario»**

Create `src/app/panel/[restaurantId]/horario/page.tsx` (con `requirePanelAccess(restaurantId, 'settings.booking')`):

```tsx
import type { Metadata } from 'next';
import { ActionForm, FormCheckboxGroup, FormField, FormSelect } from '@/components/forms/ActionForm';
import { ExceptionItem } from '@/components/schedule/ExceptionItem';
import { ServiceRow } from '@/components/schedule/ServiceRow';
import { SectionCard } from '@/components/ui/SectionCard';
import { addException, addServices } from '@/lib/actions/schedule';
import { requirePanelAccess } from '@/lib/auth/guards';
import { getRestaurantSchedule } from '@/lib/local/data';
import { groupByWeekday, todayInTimeZone, upcomingExceptions, WEEKDAY_LABELS_ES, WEEKDAYS } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Horario' };

export default async function SchedulePage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'settings.booking');
  const readOnly = ctx.readOnly;
  const { timezone, services, exceptions } = await getRestaurantSchedule(restaurantId);
  const byDay = groupByWeekday(services);
  const upcoming = upcomingExceptions(exceptions, todayInTimeZone(timezone), 100);
  const hidden = { restaurantId };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Horario</h1>
        <p className="mt-1 text-muted">Tus servicios de cada semana y los días que cierras o abres distinto. Sale tal cual en tu web.</p>
      </header>

      <SectionCard title="Servicios de cada día" intro="Un día sin servicios sale como cerrado.">
        <ul className="flex flex-col gap-4">
          {WEEKDAYS.map((day) => (
            <li key={day}>
              <h3 className="font-bold">{WEEKDAY_LABELS_ES[day]}</h3>
              {byDay[day].length === 0 ? (
                <p className="text-sm text-muted">Cerrado</p>
              ) : (
                <ul>
                  {byDay[day].map((s) => (
                    <ServiceRow key={s.id} restaurantId={restaurantId} service={s} readOnly={readOnly} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      {!readOnly && (
        <SectionCard
          title="Añadir un servicio"
          intro="Si acaba después de medianoche, pon la hora tal cual (por ejemplo, de 20:00 a 00:30). Como muy tarde, las 06:00."
        >
          <ActionForm action={addServices} hidden={hidden} submitLabel="Añadir servicio" pendingLabel="Añadiendo…">
            <FormField label="Nombre" name="name" list="service-names" placeholder="Comida" maxLength={40} required />
            <datalist id="service-names">
              <option value="Desayuno" />
              <option value="Comida" />
              <option value="Cena" />
            </datalist>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Empieza" name="start" type="time" required />
              <FormField label="Acaba" name="end" type="time" required />
            </div>
            <FormCheckboxGroup
              legend="Días"
              name="weekdays"
              options={WEEKDAYS.map((d) => ({ value: String(d), label: WEEKDAY_LABELS_ES[d] }))}
            />
          </ActionForm>
        </SectionCard>
      )}

      <SectionCard title="Cierres y horarios especiales" intro="Vacaciones, festivos o días con otro horario. En tu web salen los próximos.">
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">No tienes ningún cierre previsto.</p>
        ) : (
          <ul>
            {upcoming.map((e) => (
              <ExceptionItem key={e.id} restaurantId={restaurantId} exception={e} readOnly={readOnly} />
            ))}
          </ul>
        )}
        {!readOnly && (
          <ActionForm action={addException} hidden={hidden} submitLabel="Guardar" pendingLabel="Guardando…">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Desde" name="dateFrom" type="date" required />
              <FormField label="Hasta" name="dateTo" type="date" hint="Déjalo vacío si es un solo día." />
            </div>
            <FormSelect
              label="Ese día"
              name="kind"
              defaultValue="closed"
              options={[
                { value: 'closed', label: 'Cerramos' },
                { value: 'custom', label: 'Abrimos con otro horario' },
              ]}
            />
            <FormField label="Nota (opcional)" name="note" maxLength={140} placeholder="Vacaciones de Navidad" />
            <fieldset className="flex flex-col gap-3 rounded-[6px] border-2 border-ink/10 p-4">
              <legend className="px-1 text-sm font-bold">Horario especial (solo si abres con otro horario)</legend>
              {(['1', '2'] as const).map((n) => (
                <div key={n} className="grid gap-3 sm:grid-cols-3">
                  <FormField label={`Servicio ${n}`} name={`name${n}`} placeholder={n === '1' ? 'Comida' : 'Cena'} maxLength={40} />
                  <FormField label="Empieza" name={`start${n}`} type="time" />
                  <FormField label="Acaba" name={`end${n}`} type="time" />
                </div>
              ))}
            </fieldset>
          </ActionForm>
        )}
      </SectionCard>
    </div>
  );
}
```

- [ ] **Step 4: Comprobar**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; aparece `ƒ /panel/[restaurantId]/horario`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/schedule.ts src/components/schedule "src/app/panel/[restaurantId]/horario"
git commit -m "Panel: horario semanal, servicios que pasan de medianoche y cierres"
```

---

### Task 12: Asistente de bienvenida y publicar; estado desde el superadmin

**Files:**
- Create: `src/lib/onboarding.ts`, `src/lib/actions/publish.ts`, `src/components/onboarding/OnboardingChecklist.tsx`, `src/components/onboarding/PublishCard.tsx`
- Modify: `src/app/panel/[restaurantId]/page.tsx`, `src/app/admin/restaurantes/[id]/actions.ts`, `src/app/admin/restaurantes/[id]/page.tsx`
- Test: `src/lib/onboarding.test.ts`

**Interfaces:**
- Consumes: Task 3 (`publish_restaurant`, `restaurant_missing_fields`, `set_restaurant_status` con `DPA_REQUIRED`; `DPA_*` de `src/lib/legal/dpa.ts`), Task 7 (`publishSchema`), Task 8 (`PUBLIC_ALL_TAG`, `publicRestaurantTag`), Task 9 (`runPanelAction`, `ActionForm`, `FormCheckbox`, `getRestaurantLocal`, `getRestaurantSchedule`, `getMissingFields`); `can`, `ROLE_LABELS`; `siteUrl()`.
- Produces:
  - `onboarding.ts`: `type OnboardingInput = { status; addressLine; postalCode; city; phone; contactEmail; logoPath; coverPath; servicesCount; enabledLocales; descriptionLocales }`, `type OnboardingStepKey = 'basics' | 'images' | 'schedule' | 'languages' | 'publish'`, `type OnboardingStep = { key; title; hint; href; done }`, `onboardingSteps(restaurantId, input): OnboardingStep[]`, `MISSING_FIELD_LABELS`, `missingFieldLabels(codes): string[]`.
  - `actions/publish.ts`: `publishRestaurant(prev, fd)` (`restaurantId`, `accept`).
  - Inicio del panel: lista de pasos y tarjeta `#publicar` mientras el restaurante esté en `setup` y el rol tenga `restaurant.edit`; aviso para Encargado/Sala; enlace a la web cuando está `active`.

- [ ] **Step 1: Escribir la prueba del asistente (falla)**

Create `src/lib/onboarding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { missingFieldLabels, onboardingSteps, type OnboardingInput } from './onboarding';

const id = '11111111-1111-1111-1111-111111111111';
const empty: OnboardingInput = {
  status: 'setup',
  addressLine: null,
  postalCode: null,
  city: null,
  phone: null,
  contactEmail: null,
  logoPath: null,
  coverPath: null,
  servicesCount: 0,
  enabledLocales: ['es'],
  descriptionLocales: [],
};

describe('onboardingSteps', () => {
  it('cinco pasos en orden, ninguno hecho al empezar', () => {
    const steps = onboardingSteps(id, empty);
    expect(steps.map((s) => s.title)).toEqual(['Datos básicos', 'Logo y portada', 'Horario', 'Idiomas', 'Publicar']);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[2].href).toBe(`/panel/${id}/horario`);
  });

  it('se marcan solos con los datos guardados', () => {
    const steps = onboardingSteps(id, {
      ...empty,
      addressLine: 'Calle Mayor 1',
      postalCode: '28013',
      city: 'Madrid',
      contactEmail: 'hola@pepe.es',
      logoPath: 'x',
      coverPath: 'y',
      servicesCount: 2,
      enabledLocales: ['es', 'en'],
      descriptionLocales: ['es', 'en'],
      status: 'active',
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('Idiomas no está hecho si falta la descripción de algún idioma activo', () => {
    const steps = onboardingSteps(id, { ...empty, enabledLocales: ['es', 'en'], descriptionLocales: ['es'] });
    expect(steps.find((s) => s.key === 'languages')?.done).toBe(false);
  });
});

it('missingFieldLabels traduce los códigos de la BD', () => {
  expect(missingFieldLabels(['contact', 'tax_id', 'otro'])).toEqual(['Teléfono o email de contacto', 'CIF o NIF (datos fiscales)', 'otro']);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `pnpm test:unit src/lib/onboarding.test.ts`
Expected: FAIL — no se resuelve `./onboarding`.

- [ ] **Step 3: Implementar los pasos**

Create `src/lib/onboarding.ts`:

```ts
import type { RestaurantStatus } from '@/lib/auth/guards';

export type OnboardingInput = {
  status: RestaurantStatus;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  contactEmail: string | null;
  logoPath: string | null;
  coverPath: string | null;
  servicesCount: number;
  enabledLocales: string[];
  descriptionLocales: string[];
};

export type OnboardingStepKey = 'basics' | 'images' | 'schedule' | 'languages' | 'publish';
export type OnboardingStep = { key: OnboardingStepKey; title: string; hint: string; href: string; done: boolean };

/** Asistente de bienvenida: cada paso se marca solo, a partir de los datos guardados. */
export function onboardingSteps(restaurantId: string, i: OnboardingInput): OnboardingStep[] {
  const base = `/panel/${restaurantId}`;
  return [
    {
      key: 'basics',
      title: 'Datos básicos',
      hint: 'Dirección y un teléfono o email para que te encuentren.',
      href: `${base}/local#contacto`,
      done: Boolean(i.addressLine && i.postalCode && i.city && (i.phone || i.contactEmail)),
    },
    {
      key: 'images',
      title: 'Logo y portada',
      hint: 'La primera impresión de tu web.',
      href: `${base}/local#imagen`,
      done: Boolean(i.logoPath && i.coverPath),
    },
    {
      key: 'schedule',
      title: 'Horario',
      hint: 'Tus servicios de cada día y los cierres.',
      href: `${base}/horario`,
      done: i.servicesCount > 0,
    },
    {
      key: 'languages',
      title: 'Idiomas',
      hint: 'Elige idiomas y escribe la descripción en cada uno.',
      href: `${base}/local#idiomas`,
      done: i.enabledLocales.length > 0 && i.enabledLocales.every((l) => i.descriptionLocales.includes(l)),
    },
    {
      key: 'publish',
      title: 'Publicar',
      hint: 'Revisa lo que falta, acepta el contrato y publica.',
      href: `${base}#publicar`,
      done: i.status === 'active',
    },
  ];
}

/** Códigos de public.restaurant_missing_fields(). */
export const MISSING_FIELD_LABELS: Record<string, string> = {
  address_line: 'Calle y número',
  postal_code: 'Código postal',
  city: 'Ciudad',
  contact: 'Teléfono o email de contacto',
  services: 'Al menos un servicio en el horario',
  legal_name: 'Razón social (datos fiscales)',
  tax_id: 'CIF o NIF (datos fiscales)',
};

export function missingFieldLabels(codes: string[]): string[] {
  return codes.map((code) => MISSING_FIELD_LABELS[code] ?? code);
}
```

- [ ] **Step 4: Ejecutar la prueba**

Run: `pnpm test:unit src/lib/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Acción de publicar y componentes**

Create `src/lib/actions/publish.ts`:

```ts
'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { DPA_VERSION } from '@/lib/legal/dpa';
import { publishSchema } from '@/lib/validation/local';
import { runPanelAction } from './run';

export async function publishRestaurant(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = publishSchema.safeParse({ accept: fd.get('accept') ?? undefined });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(
    restaurantId,
    'restaurant.edit',
    async (supabase) => {
      const { error } = await supabase.rpc('publish_restaurant', {
        p_restaurant_id: restaurantId,
        p_dpa_version: DPA_VERSION,
      });
      if (error) return { error: mapDbError(error.message) };
      return { success: '¡Hecho! Tu web ya está publicada.' };
    },
    { allPublic: true },
  );
}
```

Create `src/components/onboarding/OnboardingChecklist.tsx`:

```tsx
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { OnboardingStep } from '@/lib/onboarding';

export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-extrabold">Pon tu web en marcha</h2>
        <p className="mt-1 text-sm text-muted">
          {done} de {steps.length} pasos hechos. Cada paso se marca solo cuando guardas los datos.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={step.key}>
            <Link href={step.href} className="flex items-start gap-3 rounded-[6px] p-2 hover:bg-peach-soft">
              <span
                aria-hidden="true"
                className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-sm font-bold ${step.done ? 'border-navy bg-navy text-white' : 'border-ink/30'}`}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <span>
                <span className="font-bold">{step.title}</span>
                <span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                <span className="block text-sm text-muted">{step.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
```

Create `src/components/onboarding/PublishCard.tsx` (el texto del contrato es la plantilla de `dpa.ts`, marcada "PENDIENTE DE REVISIÓN LEGAL"):

```tsx
import { ActionForm, FormCheckbox } from '@/components/forms/ActionForm';
import { Card } from '@/components/ui/Card';
import { publishRestaurant } from '@/lib/actions/publish';
import { DPA_SECTIONS, DPA_TITLE, DPA_VERSION, LEGAL_REVIEW_PENDING } from '@/lib/legal/dpa';

export function PublishCard({
  restaurantId,
  missing,
  readOnly,
}: {
  restaurantId: string;
  missing: string[];
  readOnly: boolean;
}) {
  return (
    <section id="publicar" className="scroll-mt-6">
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-extrabold">Publicar tu web</h2>
        {missing.length > 0 ? (
          <div>
            <p>Antes de publicar, te falta:</p>
            <ul className="mt-2 list-disc pl-6">
              {missing.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p>Ya está todo. Lee el contrato, acéptalo y publica.</p>
        )}
        <details className="rounded-[6px] border-2 border-ink/15 bg-paper p-4">
          <summary className="cursor-pointer font-bold">Leer el {DPA_TITLE.toLowerCase()}</summary>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p className="font-extrabold text-red-700">{LEGAL_REVIEW_PENDING}</p>
            {DPA_SECTIONS.map((s) => (
              <div key={s.heading}>
                <h3 className="font-bold">{s.heading}</h3>
                <p>{s.body}</p>
              </div>
            ))}
            <p className="text-muted">Versión {DPA_VERSION}</p>
          </div>
        </details>
        <ActionForm
          action={publishRestaurant}
          hidden={{ restaurantId }}
          readOnly={readOnly}
          submitLabel="Publicar mi web"
          pendingLabel="Publicando…"
          submitDisabled={missing.length > 0}
        >
          <FormCheckbox name="accept" label={`He leído y acepto el ${DPA_TITLE.toLowerCase()} en nombre del restaurante.`} />
        </ActionForm>
      </Card>
    </section>
  );
}
```

- [ ] **Step 6: Inicio del panel**

Replace `src/app/panel/[restaurantId]/page.tsx` with (sigue llamando a `requirePanelAccess(restaurantId)`):

```tsx
import Link from 'next/link';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { PublishCard } from '@/components/onboarding/PublishCard';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { getMissingFields, getRestaurantLocal, getRestaurantSchedule } from '@/lib/local/data';
import { missingFieldLabels, onboardingSteps } from '@/lib/onboarding';
import { can, ROLE_LABELS } from '@/lib/permissions';

export default async function PanelHome({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId);
  const { status, slug } = ctx.restaurant;
  const canEdit = can(ctx.role, 'restaurant.edit');

  let setup: { steps: ReturnType<typeof onboardingSteps>; missing: string[] } | null = null;
  if (status === 'setup' && canEdit) {
    const [{ profile, descriptions }, { services }, missing] = await Promise.all([
      getRestaurantLocal(restaurantId),
      getRestaurantSchedule(restaurantId),
      getMissingFields(restaurantId),
    ]);
    setup = {
      steps: onboardingSteps(restaurantId, {
        status,
        addressLine: profile.addressLine,
        postalCode: profile.postalCode,
        city: profile.city,
        phone: profile.phone,
        contactEmail: profile.contactEmail,
        logoPath: profile.logoPath,
        coverPath: profile.coverPath,
        servicesCount: services.length,
        enabledLocales: profile.enabledLocales,
        descriptionLocales: Object.keys(descriptions),
      }),
      missing: missingFieldLabels(missing),
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">{ctx.restaurant.name}</h1>
        <StatusBadge status={status} />
      </div>

      {status === 'active' && (
        <Card>
          <p>
            Tu web está publicada en{' '}
            <Link href={`/${slug}`} target="_blank" className="font-bold text-navy hover:underline">
              {siteUrl()}/{slug}
            </Link>
            .
          </p>
        </Card>
      )}

      {status === 'setup' && !canEdit && (
        <Card>
          <p>Tu administrador está preparando la web del restaurante. Cuando la publique, la verás aquí.</p>
        </Card>
      )}

      {setup && (
        <>
          <OnboardingChecklist steps={setup.steps} />
          <PublishCard restaurantId={restaurantId} missing={setup.missing} readOnly={ctx.readOnly} />
        </>
      )}

      <Card>
        <p>
          Entras como <strong>{ROLE_LABELS[ctx.role]}</strong>. Pronto verás aquí las reservas de hoy y lo más importante del día.
        </p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Superadmin: invalidar la mini-web y no activar sin contrato**

Replace `src/app/admin/restaurantes/[id]/actions.ts` with:

```ts
'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from '@/lib/public/tags';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';

const STATUSES = ['setup', 'active', 'disabled'] as const;

export async function setRestaurantStatus(fd: FormData): Promise<void> {
  await requirePlatformAdmin();
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const status = String(fd.get('status') ?? '') as (typeof STATUSES)[number];
  if (!uuidSchema.safeParse(restaurantId).success || !STATUSES.includes(status)) return;
  const supabase = await createClient();
  const { data: restaurant } = await supabase.from('restaurants').select('slug').eq('id', restaurantId).maybeSingle();
  const { error } = await supabase.rpc('set_restaurant_status', { p_restaurant_id: restaurantId, p_status: status });
  if (error) throw new Error(error.message);
  // La mini-web aparece o desaparece al momento.
  if (restaurant?.slug) updateTag(publicRestaurantTag(restaurant.slug as string));
  updateTag(PUBLIC_ALL_TAG);
  revalidatePath('/admin');
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
}
```

In `src/app/admin/restaurantes/[id]/page.tsx`, apply these four edits (los imports `Link` y `buttonClass` ya existen):

1. Pedir también `dpa_accepted_at`:

```tsx
  const { data: restaurant } = await supabase.from('restaurants').select('id, name, slug, status, created_at, dpa_accepted_at').eq('id', id).maybeSingle();
```

2. Sustituir `<p className="text-muted">/{restaurant.slug}</p>` por:

```tsx
      <p className="text-muted">
        /{restaurant.slug}
        {status === 'setup' && ' · El restaurante publica su web desde su panel, tras aceptar el contrato de encargado del tratamiento.'}
      </p>
```

3. En el formulario de "Reactivar", sustituir `<input type="hidden" name="status" value="active" />` por:

```tsx
              {/* Sin contrato aceptado vuelve a configuración: publicar es cosa del restaurante. */}
              <input type="hidden" name="status" value={restaurant.dpa_accepted_at ? 'active' : 'setup'} />
```

4. Sustituir el bloque completo `{status === 'setup' && ( <form action={setRestaurantStatus}> … Marcar como activo … </form> )}` por:

```tsx
        {status === 'active' && (
          <Link href={`/${restaurant.slug}`} target="_blank" className={buttonClass('ghost')}>
            Ver su web
          </Link>
        )}
```

- [ ] **Step 8: Comprobar**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db`
Expected: sin errores; todas las pruebas en verde.

- [ ] **Step 9: Commit**

```bash
git add src/lib/onboarding.ts src/lib/onboarding.test.ts src/lib/actions/publish.ts src/components/onboarding "src/app/panel/[restaurantId]/page.tsx" "src/app/admin/restaurantes/[id]"
git commit -m "Asistente de bienvenida, publicar con contrato y estado desde el superadmin"
```

---

### Task 13: Mini-web pública, aviso legal, sitemap y robots

**Files:**
- Create: `src/components/public/PublicShell.tsx`, `src/components/public/OpeningHours.tsx`, `src/components/public/MapEmbed.tsx`
- Create: `src/app/[slug]/page.tsx`, `src/app/[slug]/aviso-legal/page.tsx`, `src/app/[slug]/not-found.tsx`
- Create: `src/app/sitemap.ts`, `src/app/robots.ts`

**Interfaces:**
- Consumes: Task 4 (`accentTheme`, `formatRange`, `formatDateEs`, `groupByWeekday`, `todayInTimeZone`, `upcomingExceptions`, `formatPhone`, `socialHandle`), Task 5 (`getMessages`, `LOCALE_NAMES`, `isLocale`), Task 8 (todo `src/lib/public/*`, `legalNoticeSections`), Task 3 (`LEGAL_REVIEW_PENDING`); `siteUrl()`; `BRAND`.
- Produces: rutas `ƒ /[slug]`, `ƒ /[slug]/aviso-legal`, `ƒ /robots.txt`, `ƒ /sitemap.xml`; página propia de "no disponible" para slugs inexistentes, restaurantes en configuración o desactivados.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` (`alternates.languages`, `openGraph`, metadatos en streaming), `permanentRedirect.md`, `not-found.md`, `03-file-conventions/not-found.md`, `03-file-conventions/01-metadata/sitemap.md` y `robots.md`, y `02-guides/json-ld.md`. Las rutas estáticas (`/admin`, `/panel`, `/login`…) tienen prioridad sobre `[slug]`; además esos slugs están reservados.

- [ ] **Step 1: Marco, horario y mapa**

Create `src/components/public/PublicShell.tsx`:

```tsx
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { BRAND } from '@/config/brand';
import { accentTheme } from '@/lib/color';
import { LOCALE_NAMES, type Locale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { withLang } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';

/** Marco de las páginas públicas: colores del restaurante, idioma, selector de idioma y pie. */
export function PublicShell({
  restaurant,
  locale,
  path,
  children,
}: {
  restaurant: PublicRestaurant;
  locale: Locale;
  path: string;
  children: ReactNode;
}) {
  const theme = accentTheme(restaurant.accentColor);
  const m = getMessages(locale);
  const style = { '--accent': theme.accent, '--on-accent': theme.onAccent, '--accent-text': theme.accentText } as CSSProperties;
  return (
    <div lang={locale} style={style} className="min-h-dvh bg-white text-neutral-900">
      {children}
      <footer className="mt-12 border-t border-neutral-200 px-4 py-8 text-center text-sm text-neutral-600">
        {restaurant.enabledLocales.length > 1 && (
          <nav aria-label={m.language} className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
            {restaurant.enabledLocales.map((l) => (
              <Link
                key={l}
                href={withLang(path, l)}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? 'true' : undefined}
                className={l === locale ? 'font-bold text-neutral-900' : 'hover:underline'}
              >
                {LOCALE_NAMES[l]}
              </Link>
            ))}
          </nav>
        )}
        <p>
          <Link href={withLang(`/${restaurant.slug}/aviso-legal`, locale)} className="hover:underline">
            {m.legalNotice}
          </Link>
        </p>
        <p className="mt-2">
          <a href={BRAND.companyUrl} className="hover:underline">
            {m.poweredBy(BRAND.productName, BRAND.company)}
          </a>
        </p>
      </footer>
    </div>
  );
}
```

Create `src/components/public/OpeningHours.tsx`:

```tsx
import type { PublicMessages } from '@/lib/i18n/messages';
import { formatDateEs, formatRange, groupByWeekday, WEEKDAYS, type ScheduleException, type ServiceSlot } from '@/lib/schedule';

export function OpeningHours({
  services,
  upcoming,
  messages: m,
}: {
  services: ServiceSlot[];
  upcoming: ScheduleException[];
  messages: PublicMessages;
}) {
  const byDay = groupByWeekday(services);
  return (
    <div className="flex flex-col gap-6">
      {services.length === 0 ? (
        <p className="text-neutral-600">{m.noHours}</p>
      ) : (
        <dl className="divide-y divide-neutral-200">
          {WEEKDAYS.map((day) => (
            <div key={day} className="flex justify-between gap-4 py-2">
              <dt className="font-semibold">{m.weekdays[day - 1]}</dt>
              <dd className="text-right">
                {byDay[day].length === 0 ? (
                  <span className="text-neutral-500">{m.closed}</span>
                ) : (
                  byDay[day].map((s) => formatRange(s.startMinute, s.endMinute)).join(' · ')
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {upcoming.length > 0 && (
        <div>
          <h3 className="font-bold">{m.upcoming}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {upcoming.map((e) => {
              const from = formatDateEs(e.dateFrom);
              const to = formatDateEs(e.dateTo);
              const times = e.customServices.map((s) => formatRange(s.startMinute, s.endMinute)).join(' · ');
              return (
                <li key={`${e.dateFrom}-${e.dateTo}`}>
                  {e.kind === 'closed' ? m.closedOn(from, to) : `${m.specialOn(from, to)}: ${times}`}
                  {e.note && <span className="text-neutral-500"> · {e.note}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
```

Create `src/components/public/MapEmbed.tsx` (cliente: el `<iframe>` no existe hasta que se pulsa el botón):

```tsx
'use client';

import { useState } from 'react';

/** El iframe de Google Maps solo se carga si el comensal lo pide (sin cookies de terceros por defecto). */
export function MapEmbed({ src, title, buttonLabel, notice }: { src: string; title: string; buttonLabel: string; notice: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border-2 border-neutral-300 px-4 py-2 font-semibold hover:border-neutral-500"
        >
          {buttonLabel}
        </button>
        <p className="mt-2 text-xs text-neutral-500">{notice}</p>
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title={title}
      className="h-72 w-full rounded-lg border-0"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  );
}
```

- [ ] **Step 2: Mini-web**

Create `src/app/[slug]/page.tsx`. Sin `loading.tsx` en esta carpeta: así `permanentRedirect()` responde con un 308 de verdad (no con una meta etiqueta en streaming). `generateMetadata` no redirige: devuelve `{}` y la página decide.

```tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, permanentRedirect } from 'next/navigation';
import { MapEmbed } from '@/components/public/MapEmbed';
import { OpeningHours } from '@/components/public/OpeningHours';
import { PublicShell } from '@/components/public/PublicShell';
import { siteUrl } from '@/lib/env';
import { isLocale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { directionsUrl, fullAddress, mapEmbedUrl, priceLabel, withLang } from '@/lib/public/format';
import { jsonLdScript, restaurantJsonLd } from '@/lib/public/jsonld';
import { requestLocale } from '@/lib/public/locale';
import { descriptionFor } from '@/lib/public/restaurant-schema';
import { languageAlternates, metaDescription, OG_LOCALE, publicUrl } from '@/lib/public/seo';
import { todayInTimeZone, upcomingExceptions } from '@/lib/schedule';
import { formatPhone } from '@/lib/spain';
import { socialHandle } from '@/lib/social';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(props: Props) {
  const [{ slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const lang = typeof sp.lang === 'string' ? sp.lang : undefined;
  return { lang, result: await getPublicRestaurant(slug) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { lang, result } = await load(props);
  if (result?.kind !== 'restaurant') return {};
  const r = result.restaurant;
  const locale = await requestLocale(lang, r.enabledLocales);
  const site = siteUrl();
  const path = `/${r.slug}`;
  const description = metaDescription(r, locale);
  return {
    title: { absolute: r.cuisine ? `${r.name} · ${r.cuisine}` : r.name },
    description,
    alternates: { canonical: publicUrl(site, path, locale), languages: languageAlternates(site, path, r.enabledLocales) },
    openGraph: {
      type: 'website',
      title: r.name,
      description,
      url: publicUrl(site, path, locale),
      siteName: r.name,
      locale: OG_LOCALE[locale],
      images: r.coverPath ? [{ url: mediaUrl(r.coverPath) }] : undefined,
    },
  };
}

export default async function RestaurantPage(props: Props) {
  const { lang, result } = await load(props);
  if (!result) notFound();
  if (result.kind === 'redirect') permanentRedirect(withLang(`/${result.slug}`, isLocale(lang) ? lang : null));

  const r = result.restaurant;
  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getMessages(locale);
  const path = `/${r.slug}`;
  const address = fullAddress(r);
  const description = descriptionFor(r, locale);
  const price = priceLabel(r.priceRange);
  const upcoming = upcomingExceptions(r.exceptions, todayInTimeZone(r.timezone));
  const socials = [
    { network: 'Instagram', url: r.instagram },
    { network: 'Facebook', url: r.facebook },
    { network: 'TikTok', url: r.tiktok },
  ].filter((s): s is { network: string; url: string } => s.url !== null);
  const jsonLd = restaurantJsonLd(r, { url: publicUrl(siteUrl(), path, locale), mediaUrl });
  const accentButton = 'inline-flex items-center rounded-lg bg-[var(--accent)] px-5 py-3 font-bold text-[var(--on-accent)] hover:opacity-90';

  return (
    <PublicShell restaurant={r} locale={locale} path={path}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="relative">
        <div className="relative h-56 w-full bg-neutral-200 sm:h-80">
          {r.coverPath && (
            <Image src={mediaUrl(r.coverPath)} alt={m.coverAlt(r.name)} fill priority unoptimized sizes="100vw" className="object-cover" />
          )}
        </div>
        <div className="mx-auto flex max-w-3xl items-end gap-4 px-4">
          {r.logoPath && (
            <div className="relative -mt-12 size-24 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white shadow-md">
              <Image src={mediaUrl(r.logoPath)} alt={m.logoAlt(r.name)} fill unoptimized sizes="96px" className="object-contain" />
            </div>
          )}
          <div className="pt-4">
            <h1 className="text-3xl font-extrabold tracking-tight">{r.name}</h1>
            {(r.cuisine || price) && (
              <p className="text-neutral-600">
                {r.cuisine}
                {r.cuisine && price && ' · '}
                {price && <span aria-label={`${m.price}: ${price}`}>{price}</span>}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pt-6">
        <div className="flex flex-wrap gap-3">
          {address && (
            <a href={directionsUrl(address)} target="_blank" rel="noopener noreferrer" className={accentButton}>
              {m.directions}
            </a>
          )}
          {r.phone && (
            <a href={`tel:${r.phone}`} className="inline-flex items-center rounded-lg border-2 border-neutral-300 px-5 py-3 font-bold hover:border-neutral-500">
              {m.call}
            </a>
          )}
        </div>

        {description && (
          <section>
            <h2 className="mb-2 text-xl font-bold text-[var(--accent-text)]">{m.about}</h2>
            <p className="whitespace-pre-line leading-relaxed">{description}</p>
          </section>
        )}

        {r.photos.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.gallery}</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {r.photos.map((p, i) => (
                <li key={p} className="relative aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100">
                  <Image src={mediaUrl(p)} alt={m.photoAlt(r.name, i + 1)} fill unoptimized loading="lazy" sizes="(min-width: 640px) 33vw, 50vw" className="object-cover" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.hours}</h2>
          <OpeningHours services={r.services} upcoming={upcoming} messages={m} />
        </section>

        {(address || r.phone || r.contactEmail || r.website) && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.contact}</h2>
            <dl className="flex flex-col gap-2">
              {address && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.address}</dt>
                  <dd>{address}</dd>
                </div>
              )}
              {r.phone && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.phone}</dt>
                  <dd>
                    <a href={`tel:${r.phone}`} className="underline">
                      {formatPhone(r.phone)}
                    </a>
                  </dd>
                </div>
              )}
              {r.contactEmail && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.email}</dt>
                  <dd>
                    <a href={`mailto:${r.contactEmail}`} className="underline">
                      {r.contactEmail}
                    </a>
                  </dd>
                </div>
              )}
              {r.website && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.website}</dt>
                  <dd>
                    <a href={r.website} target="_blank" rel="noopener noreferrer" className="underline">
                      {r.website.replace(/^https:\/\//, '')}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {address && (
              <div className="mt-4">
                <MapEmbed src={mapEmbedUrl(address)} title={m.mapTitle(r.name)} buttonLabel={m.viewMap} notice={m.mapNotice} />
              </div>
            )}
          </section>
        )}

        {socials.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.social}</h2>
            <ul className="flex flex-wrap gap-3">
              {socials.map(({ network, url }) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-full border-2 border-neutral-300 px-4 py-2 font-semibold hover:border-neutral-500">
                    {network} · {socialHandle(url)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </PublicShell>
  );
}
```

- [ ] **Step 3: Aviso legal y página de "no disponible"**

Create `src/app/[slug]/aviso-legal/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { PublicShell } from '@/components/public/PublicShell';
import { isLocale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { LEGAL_REVIEW_PENDING } from '@/lib/legal/dpa';
import { legalNoticeSections } from '@/lib/legal/legal-notice';
import { getPublicRestaurant } from '@/lib/public/data';
import { withLang } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicRestaurant(slug);
  if (result?.kind !== 'restaurant') return {};
  return { title: { absolute: `Aviso legal · ${result.restaurant.name}` }, robots: { index: false } };
}

export default async function LegalNoticePage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const lang = typeof sp.lang === 'string' ? sp.lang : undefined;
  const result = await getPublicRestaurant(slug);
  if (!result) notFound();
  if (result.kind === 'redirect') permanentRedirect(withLang(`/${result.slug}/aviso-legal`, isLocale(lang) ? lang : null));

  const r = result.restaurant;
  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getMessages(locale);
  return (
    <PublicShell restaurant={r} locale={locale} path={`/${r.slug}/aviso-legal`}>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-10">
        <Link href={withLang(`/${r.slug}`, locale)} className="text-sm font-semibold text-[var(--accent-text)] hover:underline">
          ← {m.backToRestaurant}
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">{m.legalNotice}</h1>
        {locale !== 'es' && <p className="text-neutral-600">{m.legalSpanishOnly}</p>}
        <p className="font-bold text-red-700">{LEGAL_REVIEW_PENDING}</p>
        <div lang="es" className="flex flex-col gap-5">
          {legalNoticeSections(r).map((s) => (
            <section key={s.heading}>
              <h2 className="font-bold">{s.heading}</h2>
              <p className="mt-1 leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </main>
    </PublicShell>
  );
}
```

Create `src/app/[slug]/not-found.tsx`:

```tsx
import { BRAND } from '@/config/brand';

/** Slug que no existe, restaurante en configuración o desactivado: página neutra, sin marca FByte. */
export default function RestaurantNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 bg-white px-4 text-center text-neutral-900">
      <h1 className="text-2xl font-extrabold tracking-tight">Este restaurante no está disponible</h1>
      <p className="text-neutral-600">
        Puede que la dirección esté mal escrita o que el restaurante ya no esté en {BRAND.productName}.
      </p>
      <p lang="en" className="text-sm text-neutral-500">
        This restaurant is not available.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: sitemap.xml y robots.txt**

Create `src/app/sitemap.ts`:

```ts
import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';
import { getPublicSlugs } from '@/lib/public/data';
import { languageAlternates } from '@/lib/public/seo';

// Se genera al pedirlo (no en el build) y tira de la caché etiquetada de las mini-webs.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  const restaurants = await getPublicSlugs();
  return restaurants.map((r) => ({
    url: `${site}/${r.slug}`,
    lastModified: r.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.8,
    alternates: { languages: languageAlternates(site, `/${r.slug}`, r.enabledLocales) },
  }));
}
```

Create `src/app/robots.ts` (dinámico: `siteUrl()` necesita las variables de entorno, que en el build de la CI no están):

```ts
import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Las zonas privadas fuera de los buscadores (deben coincidir con las rutas de src/app). */
const PRIVATE_PATHS = ['/admin', '/panel', '/invitacion', '/auth', '/login', '/recuperar', '/nueva-contrasena'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
```

- [ ] **Step 5: Comprobar el build**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; en la lista de rutas aparecen `ƒ /[slug]`, `ƒ /[slug]/aviso-legal`, `ƒ /robots.txt` y `ƒ /sitemap.xml`, además de las del panel.

- [ ] **Step 6: Humo local con una API de Supabase simulada (opcional pero recomendado)**

Sin claves reales, se puede comprobar el HTML con un servidor que imite las dos RPC públicas. Guarda este script **fuera del repositorio** (por ejemplo, `/tmp/mesa-mock.mjs`):

```js
import http from 'node:http';
const rid = '11111111-1111-4111-8111-111111111111';
const restaurant = {
  id: rid, slug: 'la-taberna', name: 'La Taberna de Pepe', timezone: 'Europe/Madrid', enabled_locales: ['es', 'en', 'ca'],
  cuisine: 'Mediterránea', price_range: 2, address_line: 'Calle Mayor 1', postal_code: '28013', city: 'Madrid', phone: '910000000',
  contact_email: 'hola@lataberna.es', website: 'https://lataberna.es', instagram: 'https://www.instagram.com/latabernapepe', facebook: null, tiktok: 'https://www.tiktok.com/@pepe',
  accent_color: '#FFC48A', logo_path: `${rid}/logo-a.webp`, cover_path: `${rid}/cover-b.webp`, legal_name: 'Taberna Pepe SL', tax_id: 'B12345674',
  descriptions: { es: 'Cocina de mercado <script>x</script> en el centro.', en: 'Market cuisine downtown.' }, photos: [`${rid}/gallery/c.webp`],
  services: [{ name: 'Comida', weekday: 1, start_minute: 780, end_minute: 960 }, { name: 'Cena', weekday: 5, start_minute: 1200, end_minute: 1470 }],
  exceptions: [{ date_from: '2099-12-24', date_to: '2099-12-26', kind: 'closed', custom_services: [], note: 'Navidad' }],
};
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out = null;
    if (req.url.startsWith('/rest/v1/rpc/get_public_restaurant')) {
      const slug = JSON.parse(body || '{}').p_slug;
      out = slug === 'la-taberna' ? restaurant : slug === 'vieja-taberna' ? { redirect: 'la-taberna' } : null;
    } else if (req.url.startsWith('/rest/v1/rpc/list_public_slugs')) {
      out = [{ slug: 'la-taberna', enabled_locales: ['es', 'en'], updated_at: '2026-11-25T10:00:00Z' }];
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
}).listen(54400);
```

Las variables `NEXT_PUBLIC_*` se incrustan en el build, así que hay que compilar apuntando al simulador:

```bash
node /tmp/mesa-mock.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy NEXT_PUBLIC_SITE_URL=https://mesa.example.com pnpm build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy SUPABASE_SECRET_KEY=dummy NEXT_PUBLIC_SITE_URL=https://mesa.example.com pnpm start -p 3999 &
curl -s http://127.0.0.1:3999/la-taberna | grep -o '<title>[^<]*</title>\|hrefLang="[a-z-]*"\|Cómo llegar\|20:00–00:30\|application/ld+json'
curl -s -H 'Accept-Language: en' http://127.0.0.1:3999/la-taberna | grep -o 'Get directions'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://127.0.0.1:3999/vieja-taberna?lang=en'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3999/no-existe
curl -s -D - -o /dev/null http://127.0.0.1:3999/la-taberna | grep -ci set-cookie
curl -s http://127.0.0.1:3999/sitemap.xml | head -c 400; curl -s http://127.0.0.1:3999/robots.txt
```

Expected: título `La Taberna de Pepe · Mediterránea`, `hrefLang` es/en/ca/x-default, "Cómo llegar", `20:00–00:30` y el JSON-LD; con `Accept-Language: en` sale "Get directions"; la dirección antigua da `308 http://127.0.0.1:3999/la-taberna?lang=en`; `/no-existe` da `404`; `0` cabeceras `Set-Cookie`; el sitemap lista `https://mesa.example.com/la-taberna` con sus `xhtml:link` y robots.txt bloquea `/admin`, `/panel`, `/invitacion`, `/auth`, `/login`, `/recuperar` y `/nueva-contrasena`. Después, para los procesos (`kill %1 %2`) y **vuelve a compilar con las variables normales** antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add src/components/public "src/app/[slug]" src/app/sitemap.ts src/app/robots.ts
git commit -m "Mini-web pública multidioma con mapa al pulsar, aviso legal, SEO, sitemap y robots"
```

---

### Task 14: Guía de puesta en marcha y verificación final

**Files:**
- Modify: `docs/setup.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: guía al día para el controlador (migraciones que aplicar, avisos esperados, Storage) y la lista de comprobación manual de abajo.

- [ ] **Step 1: Actualizar `docs/setup.md` §1**

En `docs/setup.md`, sustituir el punto 2 de "## 1. Supabase" (desde `2. Aplica las migraciones` hasta `Cualquier otro aviso de seguridad sí hay que corregirlo.`) por:

```markdown
2. Aplica las migraciones de `supabase/migrations/` **en orden** (SQL Editor, `supabase db push` o la herramienta MCP `apply_migration`). Las ya aplicadas no se vuelven a aplicar ni se editan.
   - Hito 1: `20261124000100_base.sql`, `20261124000200_invitations.sql`.
   - Hito 2: `20261125000100_local.sql`, `20261125000200_horario.sql`, `20261125000300_publicar.sql`.

   Después, revisa los avisos de seguridad y rendimiento con `get_advisors` (MCP de Supabase) o en Advisors del panel. Es normal que queden avisos 0028/0029 (funciones `SECURITY DEFINER` ejecutables):
   - para `anon`: `get_invitation`, `get_public_restaurant` y `list_public_slugs` (la mini-web pública solo lee por ellas);
   - para `authenticated`: las de permisos (`is_member`, `has_role`, `my_role`, `belongs_to`, `is_platform_admin`, `my_restaurants`) y las de negocio (`create_restaurant`, `create_invitation`, `accept_invitation`, `set_restaurant_status`, `log_admin_view`, `restaurant_team`, `change_slug`, `restaurant_missing_fields`, `publish_restaurant`).

   Son intencionados: **no les quites los permisos**, porque las políticas RLS y la mini-web dependen de ellos. Cualquier otro aviso de seguridad sí hay que corregirlo.
3. Storage (lo crea la migración `20261125000100_local.sql`): en Storage → Buckets comprueba que existe `restaurant-media`, **público**, con límite de 2 MB y tipos `image/webp` e `image/jpeg`, y que en Storage → Policies aparecen `restaurant_media_select`, `restaurant_media_insert`, `restaurant_media_update` y `restaurant_media_delete` sobre `storage.objects`. Si la migración no pudiera crear esas políticas por permisos, créalas a mano en esa pantalla con la expresión `public.can_manage_media(bucket_id, name)` (en `insert` como *with check*; en `update`, en las dos), para el rol `authenticated`.
   - La extensión `btree_gist` se instala en el esquema `extensions` (la necesitan las restricciones que impiden solapar servicios y cierres).
   - El plan gratuito no transforma imágenes: el navegador las reduce y las pasa a WebP antes de subirlas. No hace falta activar *Image Transformations*.
```

y renumerar los puntos siguientes de §1 (los antiguos 3–7 pasan a 4–8).

- [ ] **Step 2: Añadir la nota de Vercel**

Al final de "## 5. Vercel", añadir:

```markdown
4. No hay variables nuevas en el Hito 2. Las server actions aceptan cuerpos de hasta 4 MB (`next.config.ts`), por debajo del límite de 4,5 MB de las funciones de Vercel; las fotos llegan ya comprimidas (máx. 2 MB).
5. La mini-web vive en `/<slug>` y se cachea por restaurante; los cambios del panel se ven al momento. `sitemap.xml` y `robots.txt` usan `NEXT_PUBLIC_SITE_URL`: ponla con la URL de producción.
```

- [ ] **Step 3: Verificación completa**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:db && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores de lint ni de tipos; `test:unit` → **207** pruebas en verde (26 archivos); `test:db` → **94** pruebas en verde (6 archivos); el build lista `/[slug]`, `/[slug]/aviso-legal`, `/panel/[restaurantId]/local`, `/panel/[restaurantId]/horario`, `/robots.txt` y `/sitemap.xml`. `git status` limpio salvo este paso.

- [ ] **Step 4: Commit**

```bash
git add docs/setup.md
git commit -m "Guía: migraciones del Hito 2, avisos esperados y Storage"
```

- [ ] **Step 5: Entregar al controlador**

Migraciones que hay que aplicar en Supabase, **en este orden** (ninguna de las ya aplicadas se toca):

1. `supabase/migrations/20261125000100_local.sql`
2. `supabase/migrations/20261125000200_horario.sql`
3. `supabase/migrations/20261125000300_publicar.sql`

Después: `get_advisors` (security) y comparar con la lista de avisos esperados de `docs/setup.md`; desplegar; y pasar al usuario la lista de comprobación de abajo.

---

## Comprobación manual del Hito 2 (para el usuario, tras desplegar)

No hay prueba e2e en este hito (no hay claves de Supabase en el entorno de desarrollo). Prueba esto en el móvil y en el ordenador, con un restaurante de prueba:

1. **Asistente.** Entra como Administrador de un restaurante nuevo: el inicio enseña los 5 pasos (Datos básicos, Logo y portada, Horario, Idiomas, Publicar) y la tarjeta "Publicar tu web" con lo que falta. El botón "Publicar mi web" está desactivado.
2. **Datos básicos.** Guarda nombre, tipo de cocina, precio y descripción. Prueba un error (descripción de más de 1000 caracteres): sale el mensaje junto al campo y **no se borra lo escrito**.
3. **Contacto.** Código postal `99999` → mensaje de error; `28013` vale. Teléfono `910 00 00 00` se guarda como `910000000`. Web `mirestaurante.es` se guarda como `https://mirestaurante.es`.
4. **Redes.** `@mirestaurante` en Instagram y TikTok se convierten en enlaces; un enlace de Twitter en Instagram da error.
5. **Imágenes.** Sube un logo PNG y una portada JPG grande del móvil (más de 5 MB): se suben en segundos. En Storage → `restaurant-media` aparecen como `.webp` pequeños. "Cambiar" sustituye y borra la anterior; "Quitar" la quita.
6. **Galería.** Sube varias fotos a la vez, reordénalas con ← → y borra una. Con 12 fotos, el botón se desactiva.
7. **Color.** Elige un gris medio (`#7A7A7A`): aviso de que no se lee bien y no deja guardar. Un color claro (melocotón) pone el texto del botón en oscuro.
8. **Idiomas.** Activa inglés y catalán: en "Datos básicos" aparecen sus descripciones; el paso "Idiomas" se marca cuando todas están escritas.
9. **Horario.** Añade "Comida" 13:00–16:00 de lunes a viernes y "Cena" 20:00–00:30 el viernes y el sábado. Prueba un solape (lunes 15:00–17:00): mensaje "Se solapa con «Comida» del lunes (13:00–16:00)". Añade un cierre de tres días y un horario especial con dos servicios.
10. **Encargado y Sala.** Con un Encargado: ve "Horario" pero no "Local" ni "Equipo"; abrir `/panel/<id>/local` a mano da 404. Con Sala: solo "Inicio".
11. **Datos fiscales y publicar.** Un CIF mal escrito da error; con uno válido, la lista de lo que falta queda vacía. Lee el contrato (marcado "PENDIENTE DE REVISIÓN LEGAL"), marca la casilla y publica: el estado pasa a "Activo" y en el superadmin queda `restaurant.publish` en la auditoría.
12. **Mini-web.** Abre `/<slug>` en el móvil: portada, logo, nombre, cocina y precio; "Cómo llegar" abre Google Maps; el mapa **no** se carga hasta pulsar "Ver mapa"; horario por días, la cena "20:00–00:30" y los próximos cierres; contacto, redes y pie "Reservas y menú con Mesa · FByte Solutions" con enlace al aviso legal. No hay botones "Reservar" ni "Ver carta". En las herramientas del navegador no hay cookies del dominio.
13. **Idiomas públicos.** `/<slug>?lang=en` y `?lang=ca` cambian los textos; con el navegador en inglés y sin `?lang=` sale en inglés; `?lang=fr` (no activo) sale en castellano. El selector del pie cambia `?lang=`.
14. **Cambios al momento.** Cambia el horario o una foto en el panel y recarga la mini-web: se ve al instante.
15. **Cambio de dirección.** Cambia el slug: la dirección antigua redirige a la nueva (también con `?lang=en`). Intenta usar el slug antiguo de otro restaurante: "Esa dirección ya la usa otro restaurante".
16. **No disponible.** Un slug que no existe, un restaurante en configuración y uno desactivado por FByte enseñan "Este restaurante no está disponible". Al reactivar desde el superadmin, uno nunca publicado vuelve a "En configuración", no a "Activo".
17. **SEO.** En el código fuente de la mini-web hay `<link rel="alternate" hreflang=…>`, `canonical`, `og:image` (la portada) y un `<script type="application/ld+json">` de tipo `Restaurant` con `openingHoursSpecification`; valida la URL en <https://validator.schema.org/>. `/sitemap.xml` lista los restaurantes activos y `/robots.txt` bloquea las zonas privadas.
18. **Modo soporte.** Como FByte, entra al panel del restaurante en solo lectura: "Local" y "Horario" se ven, sin botones de guardar ni de subir.

---

## Autorrevisión del plan

- **Cobertura de las decisiones del hito:** 1 publicar por el restaurante con contrato, quién y cuándo (Tasks 3, 12) · 2 editor de horarios y cierres, visibles en la mini-web (Tasks 2, 11, 13) · 3 minutos desde medianoche hasta 1800 y días ISO (Tasks 2, 4, 7) · 4 cierres por rango `closed`/`custom` (Tasks 2, 7, 11) · 5 mapa sin geocodificar, "Cómo llegar" y mapa al pulsar (Tasks 8, 13) · 6 idiomas es/en/ca/fr/de/it, `?lang=` → `Accept-Language` → `es`, sin cookie, selector y `hreflang` (Tasks 5, 8, 13) · 7 Storage `restaurant-media`, rutas, WebP en el navegador con tamaños y calidad, server action con la sesión, 12 fotos, JPEG/PNG/WebP, 4 MB (Tasks 1, 6, 9, 10) · 8 `restaurant.edit` frente a `settings.booking`, Sala sin acceso (Tasks 1, 2, 7, 10, 11) · 9 asistente de 5 pasos que se marcan solos (Task 12) · 10 requisitos para publicar comprobados en BD y mostrados (Tasks 3, 12) · 11 cambio de slug con redirección y reglas de unicidad (Tasks 1, 10, 13) · 12 datos públicos solo por `get_public_restaurant` para anon, cliente sin cookies, caché etiquetada y `updateTag` (Tasks 3, 8, 9; etiquetas por slug, decisión 1 de este plan) · 13 contenido de la mini-web, sin Reservar ni Ver carta, acento con contraste (Tasks 4, 13) · 14 aviso legal LSSI pendiente de revisión (Tasks 8, 13) · 15 SEO: `generateMetadata`, OG, `alternates.languages`, JSON-LD con horario, sitemap y robots (Tasks 8, 13) · 16 contrato como plantilla con `dpa_version` (Tasks 3, 12) · 17 campos nuevos y descripción por idioma ≤ 1000 (Tasks 1, 7, 10).
- **Spec:** §4.4 marca del restaurante y pie (Task 13) · §5 `restaurants`, `restaurant_translations`, `restaurant_photos`, `services`, `schedule_exceptions` (Tasks 1, 2) · §7.1 asistente, horario público desde `services`, `slug_redirects` (Tasks 1, 11–13) · §7.4 multidioma con respaldo en castellano (Tasks 5, 8) · §7.6 mini-web móvil, servidor + caché, OG y `Restaurant` (Task 13) · §11 contrato de encargado registrado con fecha y plantillas pendientes de revisión (Tasks 3, 12) · §12 slug inexistente o desactivado → página propia; errores junto al campo y en la voz de FByte (Tasks 7, 9, 13) · §13 pruebas de aislamiento, roles, restricciones y privilegios (Tasks 1–3). El menú del día en la mini-web y los botones Reservar/Ver carta son de los Hitos 3 y 4.
- **Placeholders:** ninguno; todo paso con código lleva el archivo completo o el fragmento exacto que cambia.
- **Consistencia de nombres:** `get_public_restaurant` devuelve snake_case y `parsePublicLookup` lo pasa a `PublicRestaurant` (Tasks 3, 8) · `restaurant_missing_fields` devuelve `address_line, postal_code, city, contact, services, legal_name, tax_id`, que traduce `MISSING_FIELD_LABELS` (Tasks 3, 12) · `DPA_VERSION` igual en `dpa.ts` y en `publish_restaurant` (lo comprueba `public.test.ts`) · `publicRestaurantTag` / `PUBLIC_ALL_TAG` en `data.ts`, `run.ts` y el superadmin (Tasks 8, 9, 12) · `mediaPath` y `isRestaurantMediaPath` siguen la misma expresión que `can_manage_media` y los CHECK (Tasks 1, 6) · los nombres de campo de los formularios (`addressLine`, `description_es`, `weekdays`, `name1`…) coinciden con `formStrings`/esquemas y con las páginas (Tasks 7, 10, 11).
