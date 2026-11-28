# Mesa — Hito 4B (Reserva online, emails y tareas automáticas): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el comensal reserve desde la web del restaurante (personas → día → hora → zona → datos → resultado) en su idioma, reciba sus emails con un enlace para ver, modificar o cancelar dentro del plazo, y que el restaurante reciba avisos, vea arriba lo pendiente de confirmar y pueda reintentar un email fallido; con recordatorio 24 h antes y cierre automático de las mesas, gracias a una tarea horaria de `pg_cron`.

**Architecture:** Igual que los Hitos 1–4A, la seguridad vive en Postgres. El navegador **no llama a nada nuevo de Supabase**: las acciones públicas (server actions) validan con Zod, pasan el límite de intentos (en la BD, compartido entre instancias) y, en el alta, Turnstile (`siteverify`), y llaman con `createAdminClient()` a funciones `SECURITY DEFINER` concedidas **solo a `service_role`**. Cada email se anota en `email_outbox` en la misma transacción que cambia la reserva (trigger con una función pura de reglas, espejada en TS y comparada en todas las combinaciones); la app los envía justo después de responder (`after()` → `deliverOutbox`, Resend con clave de idempotencia) y la tarea horaria `run_hourly_jobs()` (pg_cron) hace recordatorios, cierre automático y limpieza en la BD y llama con `pg_net` a `/api/cron/hourly` para vaciar la cola. Toda la lógica (token, disponibilidad online, alternativas, calendario, plazo, `.ics`, remitente, reglas de la cola, textos) está en módulos puros probados de `src/lib/booking/*` y `src/lib/email/*`.

**Tech Stack:** Next.js 16.4.6 (App Router, `cacheComponents` desactivado) · React 19.3 · TypeScript 5.9 · Tailwind CSS 4 · Supabase (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.2, `pg_cron`, `pg_net`, Vault) · Resend 6.39.0 · `@react-email/components` 1.0.12 · Zod 4.6.7 · `libphonenumber-js` 1.13.16 · Vitest 4.1.12 · pnpm 10 · Node 22 · PostgreSQL 16 (pruebas). **Sin dependencias nuevas** (Turnstile con su script y render explícito; `.ics` a mano; HMAC con `node:crypto`).

**Spec:** `docs/superpowers/specs/2026-11-24-plataforma-restaurantes-design.md` (§4, §6.2, §6.3, §10, §11, §12, §13) · **Decisiones del hito (mandan sobre la spec):** `docs/superpowers/specs/2026-11-28-hito-4b-decisiones.md` (las 46, «Variables de entorno nuevas» y «Publicación»).

## Global Constraints

- Mercado España. Textos del **panel** y de los emails al restaurante: castellano de España, tuteo y voz FByte («Algo ha fallado. Vuelve a intentarlo en un momento.»). Textos **públicos** (reservar, enlace, privacidad, emails al comensal): voz neutra de las páginas públicas, en el idioma del comensal (`es`, `en`, `ca`, `fr`, `de`, `it`), con prueba de completitud; en castellano, los textos de las decisiones tal cual («Vaya, esa hora se acaba de ocupar. Te enseño las más cercanas.», «Has hecho demasiados intentos. Espera unos minutos y vuelve a probar.», «No hemos podido comprobar que no eres un robot. Vuelve a intentarlo.», «Para grupos de más de N personas enviamos una solicitud al restaurante.», «Te hemos enviado un email a …», «Para cambiar algo, llama al restaurante: …»).
- Nombre del producto **provisional** «Mesa»: solo en `src/config/brand.ts` (`BRAND.productName`); el remitente es «<Restaurante> vía Mesa» con `BRAND.productName`.
- Marca: panel y emails al restaurante con la identidad FByte (`ink #0A1330`, `navy #17317F`, `orange #FF7A1A`, `paper #F8F5EF`; nunca texto blanco sobre naranja). Páginas públicas y emails al comensal con la marca del restaurante (`publicAccentTheme`) y el pie «Reservas y menú con Mesa · FByte Solutions» (`getMessages(locale).poweredBy`).
- **Las migraciones ya aplicadas en Supabase no se editan:** `20261124000100_base.sql`, `20261124000200_invitations.sql`, `20261125000100_local.sql`, `20261125000200_horario.sql`, `20261125000300_publicar.sql`, `20261126000100_menu.sql`, `20261126000200_menu_funciones.sql`, `20261126000300_menu_fotos.sql`, `20261126000400_menu_publico.sql`, `20261127000100_reservas.sql` y `20261127000200_reservas_funciones.sql`. Este hito añade `20261128000100_reserva_online.sql`, `20261128000200_reserva_publica.sql`, `20261128000300_reserva_enlace_panel.sql` y `20261128000400_emails_tareas.sql`; las nuevas versiones de `create_panel_reservation` y `update_panel_reservation` se crean en `…0300` con `drop function` de las del 4A y sus `grant` otra vez.
- **Anon no recibe nada nuevo** (sigue ejecutando solo `get_invitation`, `get_public_restaurant`, `list_public_slugs`, `get_public_menu` y `list_public_menus`). Las funciones públicas nuevas (`get_public_booking_day`, `public_booking_enabled`, `create_public_reservation`, `hit_rate_limit`, `get_public_reservation`, `modify_public_reservation`, `cancel_public_reservation`) y las de la cola (`claim_outbox`, `finish_outbox`, `skip_outbox`, `outbox_email_data`) se conceden **solo a `service_role`** (antes, `revoke execute … from public, anon, authenticated`); las auxiliares, a nadie (también `revoke … from service_role`, que Supabase y el shim conceden por defecto); `retry_outbox` y las dos del panel, a `authenticated`; `run_hourly_jobs()`, a nadie (la ejecuta pg_cron como dueña).
- Funciones `SECURITY DEFINER` siempre con `set search_path = ''` y nombres totalmente cualificados; todo se busca por `restaurant_id` (también en triggers); claves foráneas compuestas `(reservation_id, restaurant_id)`; índice en cada FK usada en cascada. Tablas nuevas con RLS y `revoke all … from anon, authenticated, service_role` antes de los `grant`.
- Quién hace el cambio: las funciones públicas marcan `set_config('mesa.actor', 'customer', true)`, las del panel `staff` y la tarea horaria `system`; sin marcar (las de estado del 4A) cuenta como `staff`.
- **`pg_cron`, `pg_net` y Vault no existen en la BD local de pruebas**: la migración solo crea el job si `pg_available_extensions` tiene las dos, y `run_hourly_jobs()` solo llama a la app si existen `net` y `vault.decrypted_secrets` (`to_regnamespace`, `to_regclass`) y los secretos `mesa_site_url` y `mesa_cron_secret` (los crea el controlador al publicar).
- Fechas en la zona del restaurante (`Europe/Madrid` o `Atlantic/Canary`), instantes en `timestamptz`; día de servicio ≠ día natural (`serviceDateOf`, `currentServiceDate`); servicios que pasan de medianoche (minutos hasta 1800); cambio de hora como PostgreSQL (hora que no existe: no se ofrece; que existe dos veces: la de invierno). La BD de pruebas es UTF-8 con locale C (orden de bytes: `collate "C"`).
- Accesibilidad: nunca `disabled` en un control con foco (`aria-disabled`, el clic no hace nada); regiones `aria-live`/`role="alert"` siempre montadas; el nombre accesible empieza por el texto visible; foco visible (`focus-visible:outline-3 …`); calendario usable con teclado (un punto de tabulación, flechas, Inicio/Fin, Re Pág/Av Pág); `lang` del idioma en las páginas públicas (`PublicShell`) y en los emails (`<Html lang>`).
- Componentes cliente que llaman a acciones: `try/catch`, texto genérico en el idioma del comensal, nunca lanzan, sin envíos dobles (`ref` + estado pendiente). Acciones y rutas: nunca enseñan `error.message`; los errores inesperados del panel van por `dbError`, los públicos por `bookingError`; logs **sin datos personales** (ni emails, ni teléfonos, ni nombres, ni IP, ni tokens: solo ids de la cola, tipos y códigos).
- Toda página nueva bajo `src/app/panel/[restaurantId]/` llama a `requirePanelAccess(restaurantId, permiso)` (este hito no crea páginas nuevas del panel; las que cambian ya lo hacen). Las acciones del panel pasan por `runPanelAction()`; mesas y ajustes de reserva invalidan también la mini-web (el botón «Reservar» depende de ellos).
- Next.js 16 no es el que conoces: antes de usar una API, lee su guía en `node_modules/next/dist/docs/` (cada tarea dice cuál: `after`, route handlers y su configuración, `next/script`, `generateMetadata` con `robots` y `referrer`). `params` y `searchParams` son promesas; `redirect`, `notFound` y `permanentRedirect` lanzan; `Date.now()` no se llama dentro de un componente (regla `react-hooks/purity`: los módulos puros reciben `nowMs` con valor por defecto). Un `route.ts` solo exporta métodos HTTP y configuración.
- Secretos nuevos leídos **al usarlos** (`manageTokenSecret()`, `cronSecret()`, `turnstileKeys()`, `reservationsFromAddress()`): `pnpm build` no necesita ninguna variable nueva: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`. Claves de prueba oficiales de Turnstile en desarrollo y pruebas: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA` (siempre aprueba) y `2x0000000000000000000000000000000AA` (siempre falla); en producción sin claves, el alta online se rechaza.
- Pruebas: `pnpm test:unit`, `pnpm test:db` (PostgreSQL 16 local en el puerto 54329, UTF-8/C, se resetea sola con el shim + todas las migraciones), `pnpm lint`, `pnpm typecheck`, `pnpm build`. Antes de este hito pasan **682** pruebas (497 unitarias en 64 archivos + 185 de BD en 12 archivos); al terminar deben pasar **858** (593 unitarias en 86 archivos + 265 de BD en 17 archivos).
- No hay claves reales de Supabase en el contenedor: **sin e2e**; al final hay una lista de comprobación manual para el usuario. Aplicar migraciones, crear el widget de Turnstile, los secretos (Vercel y Vault) y desplegar lo hace el controlador después, con confirmación del usuario (**primero las migraciones, luego el código**).
- Fuera del Hito 4B (no se construye): pantalla de clientes, estadísticas, anonimización automática y el resto de textos legales (Hito 5); WhatsApp, lista de espera, señales o depósitos y reseñas (fase 2); pruebas e2e automáticas.
- Commits pequeños, uno por paso de «Commit». Mensajes en castellano.

---

## Decisiones de este plan (no estaban en el documento de decisiones)

1. **Cuatro migraciones** en vez de una: esquema y reglas de la cola (0100), flujo público (0200), enlace y panel (0300) y cola/tarea horaria (0400), para que cada tarea tenga su ciclo de pruebas.
2. **Parámetros nuevos del panel al final y con valor por defecto** (`p_id`, `p_notify_customer`, `p_token_hash`): el código del 4A desplegado sigue funcionando entre la migración y el despliegue.
3. **Deshacer un rechazo o una cancelación que vuelve a `pending`** no envía nada (la decisión 20 solo manda `customer_confirmed` al volver a `confirmed`); el siguiente Confirmar/Rechazar ya avisa.
4. **Activar los avisos en una reserva telefónica ya creada** (casilla en el formulario de cambios, si el cliente tiene email) envía su confirmación (o «solicitud recibida» si está pendiente). Cambiar solo la zona con el enlace no envía email.
5. **Reply-to:** los emails al comensal, al restaurante (`contact_email` o, si no, el de avisos); los avisos al restaurante, al cliente (para contestarle directamente).
6. **Cola:** al reclamar se gasta el intento y `next_attempt_at = now() + 10 min` hace de plazo (sin columna extra); `skip_outbox` marca `skipped` lo que ya no toca; `outbox_email_data(id)` (SQL, solo `service_role`) junta los datos **actuales** y el destinatario. No se envía nada de restaurantes no activos (`RESTAURANT_NOT_ACTIVE`); por eso la casilla «Enviar confirmación por email» solo sale si el restaurante está publicado.
7. **Clave de idempotencia** `outbox/<id>`; si la huella guardada no es la de `MANAGE_TOKEN_SECRET` (secreto rotado), el email sale **sin** enlace y se avisa en el log.
8. **Límite de intentos extra** para pedir horas (`slots`, 120 cada 10 min). Si la BD del límite falla, se deja pasar (lo registra): la operación siguiente fallaría igual.
9. **Cancelar con el enlace** se puede aunque la reserva online esté apagada; **modificar** exige la reserva online activada (`BOOKING_CLOSED`).
10. **Vista del día:** «Pendientes de confirmar» del día arriba (no se repiten abajo) y un aviso con enlaces a los otros días con pendientes.
11. **`is_bookable_slot`** recibe un `p_now` opcional (para probarla contra el módulo TS en fechas fijas de cambio de hora).
12. **Sitemap:** `/<slug>/reservar` de todos los restaurantes publicados (si no tienen reserva online, la página explica cómo reservar por teléfono). `/<slug>/privacidad` va con `noindex`, como el aviso legal, y se enlaza desde el pie.
13. **El día público** no lleva ids de reservas ni motivos de bloqueos; al modificar, la propia reserva se quita en la BD (`p_token_hash`). El calendario arranca en la víspera (de madrugada aún se puede reservar la cena que pasa de medianoche).
14. **Desarrollo sin secretos:** `MANAGE_TOKEN_SECRET` fija de desarrollo y claves de prueba de Turnstile; en producción, obligatorias (sin `MANAGE_TOKEN_SECRET` las acciones fallan con el genérico y se registra; sin Turnstile la web lo dice).
15. **Título del `.ics`** en el idioma de la reserva («Reserva en …», «Booking at …»); la modificada lleva `.ics` también si queda pendiente.

---

## Estructura de archivos del Hito 4B

```
supabase/migrations/20261128000100_reserva_online.sql    Ajustes online, notify_customer, email_outbox, rate_limits, reglas y trigger de encolado
supabase/migrations/20261128000200_reserva_publica.sql   Horas ofrecidas, día público, alta online, botón «Reservar», límite de intentos
supabase/migrations/20261128000300_reserva_enlace_panel.sql Enlace (ver, modificar, cancelar) y nuevas create/update_panel_reservation
supabase/migrations/20261128000400_emails_tareas.sql     claim/finish/skip/retry_outbox, outbox_email_data, run_hourly_jobs y job de pg_cron
tests/db/helpers.ts                     (modificar) avisos, actor, huellas, cola, restaurante reservable, horas locales, bloqueos
tests/db/booking-online.test.ts · booking-public.test.ts · booking-manage.test.ts · booking-jobs.test.ts · booking-concurrency.test.ts
tests/db/reservations.test.ts           (modificar) firmas nuevas de las funciones del panel
src/lib/email/outbox-rules.ts (+test)   Tipos de email y reglas (espejo de la BD), etiquetas del panel
src/lib/env.ts (+test) · .env.example   (modificar) MANAGE_TOKEN_SECRET, CRON_SECRET, Turnstile, RESERVATIONS_FROM_ADDRESS
src/lib/reservations/settings.ts · rows.ts (+test) · codes.ts (+codes.test) · data.ts   (modificar) ajustes nuevos, «Online», emails y pendientes
src/lib/booking/token.ts · turnstile.ts · rate-limit.ts (+tests)   Servidor: enlace, Turnstile, límite de intentos
src/lib/booking/online.ts · calendar.ts · format.ts (+tests)        Puros: horas online, alternativas, plazo, calendario, fechas
src/lib/booking/schemas.ts (+test)      Esquemas del formulario público (códigos de error)
src/lib/booking/rows.ts · errors.ts (+rows.test) · data.ts · status-style.ts   Datos públicos (cliente admin) y errores
src/lib/email/ics.ts · sender.ts (+tests)        .ics y remitente
src/lib/i18n/booking/{types,es,en,ca,fr,de,it,index}.ts (+messages.test)   Textos públicos y de emails al comensal
src/lib/email/templates/CustomerBookingEmail.tsx · RestaurantBookingEmail.tsx (+BookingEmails.test)
src/lib/email/send.ts (+test) · outbox-data.ts · outbox-email.tsx (+test) · fixtures.ts · deliver.ts (+test) · cron-auth.ts
src/app/api/cron/hourly/route.ts (+test)          La llama pg_cron
src/lib/actions/booking.ts (+test)                Acciones públicas
src/components/booking/{styles,TurnstileWidget,BookingCalendar,SlotPicker,PublicFields,BookingFlow,CancelBooking,BookingHeader}.tsx (+BookingCalendar.test)
src/app/[slug]/reservar/page.tsx · src/app/[slug]/reserva/[token]/page.tsx · src/app/[slug]/privacidad/page.tsx
src/lib/legal/privacy.ts (+test)                  Política de privacidad de las reservas (6 idiomas)
src/components/public/PublicShell.tsx · src/app/[slug]/page.tsx · src/app/[slug]/menu/page.tsx · src/lib/public/{format,jsonld}.ts · src/app/sitemap.ts   (modificar)
src/lib/reservations/validation.ts (+test) · src/lib/actions/booking-settings.ts · src/components/reservations/BookingSettingsForm.tsx · reservas/ajustes/page.tsx   (modificar)
src/lib/db-errors.ts · src/lib/actions/reservations.ts (+test) · src/components/reservations/ReservationForm.tsx · reservas/nueva/page.tsx   (modificar)
src/lib/reservations/pending.ts (+test) · reservas/page.tsx                       Pendientes de confirmar
src/components/reservations/ReservationEmails.tsx (+test) · EmailRetryButton.tsx · reservas/[reservationId]/page.tsx   Historial de emails
docs/setup.md                           (modificar) migraciones, pg_cron, Vault, Turnstile, variables
```

---

### Task 1: Migración 1: ajustes online, aviso al cliente, cola de emails, límite de intentos y reglas de encolado

**Files:**
- Create: `supabase/migrations/20261128000100_reserva_online.sql`
- Create: `src/lib/email/outbox-rules.ts`
- Create (prueba): `src/lib/email/outbox-rules.test.ts`
- Create (prueba): `tests/db/booking-online.test.ts`
- Modify: `tests/db/helpers.ts`

**Interfaces:**
- Consumes: Hitos 1–4A: `public.restaurants` (`contact_email`), `public.booking_settings`, `public.reservations` (`manage_token_hash` ya existe, única), `public.customers` (`email`), los tipos `public.reservation_status` y `public.reservation_source`, `public.has_role(uuid, member_role[])`, `public.is_platform_admin()`; helpers `tx`, `as`, `asSuperuser`, `createUser`, `insertRestaurant`, `addMember`, `insertZone`, `insertTable`, `insertCustomer`, `insertReservation`, `expectDbError`, `pool`; `RESERVATION_STATUSES` y `RESERVATION_SOURCES` de `src/lib/reservations/codes.ts`.
- Produces:
  - Columnas `booking_settings.online_enabled boolean not null default true`, `notify_restaurant boolean not null default true`, `notification_email text` (CHECK `booking_settings_notification_email_check`; `grant update` de las tres a `authenticated`).
  - `reservations.notify_customer boolean not null default false`; CHECK `reservations_manage_token_hash_check` (64 hexadecimales) y `reservations_notify_check` (con avisos, hace falta la huella).
  - Tipos `public.email_kind` (`customer_pending`, `customer_confirmed`, `customer_modified`, `customer_cancelled`, `customer_rejected`, `customer_reminder`, `restaurant_new`, `restaurant_request`, `restaurant_modified`, `restaurant_cancelled`) y `public.email_status` (`pending`, `sending`, `sent`, `failed`, `skipped`).
  - Tabla `email_outbox(id, restaurant_id, reservation_id, kind, status, attempts 0–3, last_error, provider_id, next_attempt_at, created_at, sent_at)` con FK compuesta a `reservations`, índice único parcial `email_outbox_reminder_key` y RLS de lectura para los tres roles (y FByte en soporte); nadie escribe (tampoco `service_role`).
  - Tabla `rate_limits(key, window_start, hits)` sin acceso para nadie.
  - `public.reservation_email_kinds(p_op text, p_old_status, p_new_status, p_moved boolean, p_source, p_actor text, p_notify_switched_on boolean) → email_kind[]` (pura) y el trigger `reservations_enqueue_emails` (`AFTER INSERT OR UPDATE OF status, starts_at, party_size, notify_customer`), que lee `current_setting('mesa.actor', true)` (vacío = `staff`).
  - `src/lib/email/outbox-rules.ts`: `EMAIL_KINDS`, `EmailKind`, `CustomerEmailKind`, `RestaurantEmailKind`, `EMAIL_STATUSES`, `EmailStatus`, `EmailActor`, `isCustomerKind(kind)`, `emailKindsFor({ op, oldStatus, newStatus, moved, source, actor, notifySwitchedOn }) → EmailKind[]`, `EMAIL_KIND_LABELS_ES`, `EMAIL_STATUS_LABELS_ES`, `failedEmailText(kind) → string`.
  - Helpers de prueba: `insertReservation(…, { notifyCustomer?, tokenHash? })`, `asServiceRole(c)`, `setActor(c, actor)`, `fakeTokenHash(n) → string`, `outboxKinds(c, reservationId) → string[]` (por alta y por orden del tipo), `setPublishedFields(c, restaurantId, contactEmail?)`.

Lee antes: `supabase/migrations/20261127000100_reservas.sql` (estilo de tablas, claves compuestas, RLS y triggers del 4A), `tests/db/helpers.ts` y `tests/db/reservations.test.ts`.

La función de reglas es la fuente de verdad; `outbox-rules.ts` es su espejo en la app, y la prueba de BD compara las dos en **todas** las combinaciones (2.592). Los walk-ins nunca envían nada; los emails al restaurante solo salen si el cambio lo hizo el comensal (`mesa.actor = 'customer'`).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/email/outbox-rules.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { EMAIL_KIND_LABELS_ES, EMAIL_KINDS, emailKindsFor, failedEmailText, isCustomerKind } from './outbox-rules';

const base = { op: 'UPDATE' as const, moved: false, source: 'online' as const, actor: 'staff' as const, notifySwitchedOn: false };

describe('reglas de encolado (espejo de la BD)', () => {
  it('altas', () => {
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'pending', actor: 'customer' })).toEqual(['customer_pending', 'restaurant_request']);
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'confirmed', actor: 'customer' })).toEqual(['customer_confirmed', 'restaurant_new']);
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'confirmed', source: 'phone' })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'seated', source: 'walk_in' })).toEqual([]);
  });

  it('cambios de estado, de hora y de avisos', () => {
    expect(emailKindsFor({ ...base, oldStatus: 'pending', newStatus: 'confirmed' })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, oldStatus: 'pending', newStatus: 'rejected' })).toEqual(['customer_rejected']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'cancelled_customer', actor: 'customer' })).toEqual(['customer_cancelled', 'restaurant_cancelled']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'cancelled_restaurant' })).toEqual(['customer_cancelled']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'pending', moved: true, actor: 'customer' })).toEqual(['customer_modified', 'restaurant_modified']);
    expect(emailKindsFor({ ...base, oldStatus: 'rejected', newStatus: 'confirmed' })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, oldStatus: 'rejected', newStatus: 'pending' })).toEqual([]);
    expect(emailKindsFor({ ...base, oldStatus: 'seated', newStatus: 'completed', actor: 'system' })).toEqual([]);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'confirmed', notifySwitchedOn: true })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'confirmed' })).toEqual([]);
  });

  it('etiquetas y avisos en castellano para todos los tipos', () => {
    for (const kind of EMAIL_KINDS) {
      expect(EMAIL_KIND_LABELS_ES[kind].trim()).not.toBe('');
      expect(failedEmailText(kind)).toMatch(/^No pudimos enviar el email de .+\.$/);
    }
    expect(isCustomerKind('customer_reminder')).toBe(true);
    expect(isCustomerKind('restaurant_new')).toBe(false);
    expect(failedEmailText('customer_confirmed')).toBe('No pudimos enviar el email de confirmación al cliente.');
  });
});
````

Crea `tests/db/booking-online.test.ts`:

````ts
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
````

En `tests/db/helpers.ts`, sustituye:

````ts
    tableIds?: string[];
  },
````

por:

````ts
    tableIds?: string[];
    /** Hito 4B: avisos por email al cliente (exige tokenHash). */
    notifyCustomer?: boolean;
    tokenHash?: string | null;
  },
````

En `tests/db/helpers.ts`, sustituye:

````ts
  const { rows } = await c.query<{ id: string }>(
    `insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), $6, $7) returning id`,
    [restaurantId, customerId, r.partySize ?? 2, r.startsAt, r.minutes ?? 90, r.status ?? 'confirmed', r.source ?? 'phone'],
  );
````

por:

````ts
  const { rows } = await c.query<{ id: string }>(
    `insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source,
                                      notify_customer, manage_token_hash)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), $6, $7, $8, $9) returning id`,
    [
      restaurantId,
      customerId,
      r.partySize ?? 2,
      r.startsAt,
      r.minutes ?? 90,
      r.status ?? 'confirmed',
      r.source ?? 'phone',
      r.notifyCustomer ?? false,
      r.tokenHash ?? null,
    ],
  );
````

En `tests/db/helpers.ts`, sustituye:

````ts
    ]);
  }
  return rows[0].id;
}
````

por:

````ts
    ]);
  }
  return rows[0].id;
}

/** Como la clave de servicio (service_role): la que usa la app desde el servidor para el flujo público. */
export async function asServiceRole(c: pg.PoolClient): Promise<void> {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', '', true)");
  await c.query('set local role service_role');
}

/** Marca quién hace el cambio en esta transacción, como las funciones del Hito 4B ('customer', 'staff', 'system'). */
export async function setActor(c: pg.PoolClient, actor: 'customer' | 'staff' | 'system' | null): Promise<void> {
  await c.query("select set_config('mesa.actor', $1, true)", [actor ?? '']);
}

/** Huella de un token de prueba: 64 caracteres hexadecimales distintos para cada n. */
export function fakeTokenHash(n: number): string {
  return n.toString(16).padStart(64, '0');
}

/** Emails anotados en la cola para una reserva, por orden de alta y de tipo: ['customer_pending', 'restaurant_request']. */
export async function outboxKinds(c: pg.PoolClient, reservationId: string): Promise<string[]> {
  await asSuperuser(c);
  const { rows } = await c.query<{ k: string }>(
    'select o.kind::text as k from public.email_outbox o where o.reservation_id = $1 order by o.created_at, o.kind',
    [reservationId],
  );
  return rows.map((r) => r.k);
}

/** Datos de un restaurante publicado (dirección, contacto y datos fiscales), con su email de contacto. */
export async function setPublishedFields(c: pg.PoolClient, restaurantId: string, contactEmail: string | null = 'hola@restaurante.es'): Promise<void> {
  await asSuperuser(c);
  await c.query(
    `update public.restaurants
        set address_line = 'Calle Mayor 1', postal_code = '28013', city = 'Madrid', phone = '910000000',
            contact_email = $2, legal_name = 'Taberna Pepe SL', tax_id = 'B12345674'
      where id = $1`,
    [restaurantId, contactEmail],
  );
}

````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:db tests/db/booking-online.test.ts && pnpm test:unit src/lib/email/outbox-rules.test.ts`
Expected: FAIL: `column "notify_customer" of relation "reservations" does not exist` (y `function public.reservation_email_kinds(...) does not exist`); la prueba unitaria, `Failed to resolve import "./outbox-rules"`.

- [ ] **Step 3: Implementa**

Crea `supabase/migrations/20261128000100_reserva_online.sql`:

````sql
-- Mesa · Hito 4B · reserva online: ajustes nuevos, aviso al cliente, cola de emails, límite de intentos y las reglas
-- que deciden qué emails salen con cada alta o cambio de una reserva (trigger).

-- Ajustes: reserva online, avisos al restaurante y su email (vacío = el del local) --------------------------------
alter table public.booking_settings
  add column online_enabled boolean not null default true,
  add column notify_restaurant boolean not null default true,
  add column notification_email text
    constraint booking_settings_notification_email_check
    check (notification_email = lower(notification_email) and length(notification_email) <= 254
           and notification_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant update (online_enabled, notify_restaurant, notification_email) on public.booking_settings to authenticated;

-- Reservas: si el cliente recibe emails (online siempre; teléfono según la casilla; walk-in nunca) --------------------
alter table public.reservations
  add column notify_customer boolean not null default false,
  add constraint reservations_manage_token_hash_check check (manage_token_hash ~ '^[0-9a-f]{64}$'),
  add constraint reservations_notify_check check (not notify_customer or manage_token_hash is not null);

-- Cola de emails ------------------------------------------------------------------------------------------------
create type public.email_kind as enum (
  'customer_pending', 'customer_confirmed', 'customer_modified', 'customer_cancelled', 'customer_rejected',
  'customer_reminder', 'restaurant_new', 'restaurant_request', 'restaurant_modified', 'restaurant_cancelled'
);
create type public.email_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');

-- El destinatario no se guarda: se resuelve al enviar (email actual del cliente o email de avisos).
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  reservation_id uuid not null,
  kind public.email_kind not null,
  status public.email_status not null default 'pending',
  attempts smallint not null default 0 constraint email_outbox_attempts_check check (attempts between 0 and 3),
  -- Código corto del fallo, sin datos personales.
  last_error text constraint email_outbox_last_error_check check (length(last_error) <= 200),
  provider_id text constraint email_outbox_provider_id_check check (length(provider_id) <= 200),
  -- Cuándo se puede intentar (o, si está «sending», cuándo se da por perdido y se reintenta).
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (reservation_id, restaurant_id) references public.reservations (id, restaurant_id) on delete cascade
);
create index email_outbox_reservation_idx on public.email_outbox (reservation_id, created_at);
create index email_outbox_restaurant_idx on public.email_outbox (restaurant_id);
create index email_outbox_queue_idx on public.email_outbox (next_attempt_at) where status in ('pending', 'sending');
-- Un único recordatorio por reserva.
create unique index email_outbox_reminder_key on public.email_outbox (reservation_id) where kind = 'customer_reminder';

-- Límite de intentos (compartido entre instancias). La clave lleva la acción, el restaurante y la huella de la IP.
create table public.rate_limits (
  key text not null constraint rate_limits_key_check check (length(key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);

-- RLS: la cola la leen los miembros con reservations.manage (los tres roles) y FByte en soporte; nadie escribe
-- directamente (solo las funciones). rate_limits: nadie.
alter table public.email_outbox enable row level security;
alter table public.rate_limits enable row level security;
revoke all on public.email_outbox, public.rate_limits from anon, authenticated, service_role;
grant select on public.email_outbox to authenticated;
create policy email_outbox_select on public.email_outbox for select to authenticated
  using (public.has_role(restaurant_id, '{admin,manager,staff}') or public.is_platform_admin());

-- Reglas de encolado (igual que src/lib/email/outbox-rules.ts) ---------------------------------------------------
/**
 * Qué emails tocan con un alta (p_op = 'INSERT') o un cambio de una reserva. p_moved: cambian la hora o las personas.
 * p_actor: 'customer' (funciones públicas), 'staff' (panel) o 'system' (tarea horaria). Los de restaurante, solo si
 * el cambio lo hizo el comensal. Los walk-ins nunca. Quién recibe cada uno lo decide el trigger.
 */
create or replace function public.reservation_email_kinds(
  p_op text, p_old_status public.reservation_status, p_new_status public.reservation_status, p_moved boolean,
  p_source public.reservation_source, p_actor text, p_notify_switched_on boolean
) returns public.email_kind[] language plpgsql immutable set search_path = '' as $$
declare
  v_customer boolean := p_actor = 'customer';
begin
  if p_source = 'walk_in' then
    return '{}';
  end if;
  if p_op = 'INSERT' then
    if p_new_status = 'pending' then
      return case when v_customer then '{customer_pending,restaurant_request}' else '{customer_pending}' end::public.email_kind[];
    elsif p_new_status = 'confirmed' then
      return case when v_customer and p_source = 'online' then '{customer_confirmed,restaurant_new}' else '{customer_confirmed}' end::public.email_kind[];
    end if;
    return '{}';
  end if;
  if coalesce(p_moved, false) and p_old_status in ('pending', 'confirmed') and p_new_status in ('pending', 'confirmed') then
    return case when v_customer then '{customer_modified,restaurant_modified}' else '{customer_modified}' end::public.email_kind[];
  end if;
  if p_old_status is distinct from p_new_status then
    if p_new_status = 'confirmed' and p_old_status in ('pending', 'cancelled_customer', 'cancelled_restaurant', 'rejected') then
      return '{customer_confirmed}';
    elsif p_new_status = 'rejected' then
      return '{customer_rejected}';
    elsif p_new_status = 'cancelled_restaurant' then
      return '{customer_cancelled}';
    elsif p_new_status = 'cancelled_customer' then
      return case when v_customer then '{customer_cancelled,restaurant_cancelled}' else '{customer_cancelled}' end::public.email_kind[];
    end if;
    return '{}';
  end if;
  if coalesce(p_notify_switched_on, false) then
    if p_new_status = 'pending' then
      return '{customer_pending}';
    elsif p_new_status = 'confirmed' then
      return '{customer_confirmed}';
    end if;
  end if;
  return '{}';
end $$;

/**
 * Anota los emails en la misma transacción que cambia la reserva. Los del comensal, solo si notify_customer y el
 * cliente tiene email; los del restaurante, si están activados y hay email de avisos (o el del local).
 */
create or replace function public.enqueue_reservation_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Sin marcar (p. ej., el panel del 4A o pruebas como superusuario), cuenta como el equipo.
  v_actor text := coalesce(nullif(current_setting('mesa.actor', true), ''), 'staff');
  v_kinds public.email_kind[];
  v_customer_email text;
  v_notify_restaurant boolean;
  v_restaurant_email text;
begin
  if tg_op = 'INSERT' then
    v_kinds := public.reservation_email_kinds('INSERT', null, new.status, false, new.source, v_actor, false);
  else
    v_kinds := public.reservation_email_kinds(
      'UPDATE', old.status, new.status,
      new.starts_at is distinct from old.starts_at or new.party_size is distinct from old.party_size,
      new.source, v_actor, new.notify_customer and not old.notify_customer);
  end if;
  if cardinality(v_kinds) = 0 then
    return null;
  end if;
  select c.email into v_customer_email
    from public.customers c where c.id = new.customer_id and c.restaurant_id = new.restaurant_id;
  select coalesce(s.notify_restaurant, true), coalesce(s.notification_email, r.contact_email)
    into v_notify_restaurant, v_restaurant_email
    from public.restaurants r left join public.booking_settings s on s.restaurant_id = r.id
   where r.id = new.restaurant_id;
  insert into public.email_outbox (restaurant_id, reservation_id, kind)
  select new.restaurant_id, new.id, k
    from unnest(v_kinds) k
   where case when k::text like 'customer\_%' then new.notify_customer and v_customer_email is not null
              else v_notify_restaurant and v_restaurant_email is not null end;
  return null;
end $$;
create trigger reservations_enqueue_emails after insert or update of status, starts_at, party_size, notify_customer
  on public.reservations for each row execute function public.enqueue_reservation_emails();

revoke execute on function
  public.reservation_email_kinds(text, public.reservation_status, public.reservation_status, boolean,
    public.reservation_source, text, boolean),
  public.enqueue_reservation_emails()
  from public, anon, authenticated, service_role;
````

Crea `src/lib/email/outbox-rules.ts`:

````ts
import type { ReservationSource, ReservationStatus } from '@/lib/reservations/codes';

/** Tipos de email (igual que public.email_kind). */
export const EMAIL_KINDS = [
  'customer_pending',
  'customer_confirmed',
  'customer_modified',
  'customer_cancelled',
  'customer_rejected',
  'customer_reminder',
  'restaurant_new',
  'restaurant_request',
  'restaurant_modified',
  'restaurant_cancelled',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export type CustomerEmailKind = Extract<EmailKind, `customer_${string}`>;
export type RestaurantEmailKind = Extract<EmailKind, `restaurant_${string}`>;

export const EMAIL_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export type EmailActor = 'customer' | 'staff' | 'system';

export function isCustomerKind(kind: EmailKind): kind is CustomerEmailKind {
  return kind.startsWith('customer_');
}

const ACTIVE: readonly ReservationStatus[] = ['pending', 'confirmed'];

/**
 * Qué emails tocan con un alta o un cambio (espejo de public.reservation_email_kinds, que es la que manda; esta sirve
 * para entender y probar las reglas desde la app).
 */
export function emailKindsFor(input: {
  op: 'INSERT' | 'UPDATE';
  oldStatus: ReservationStatus | null;
  newStatus: ReservationStatus;
  moved: boolean;
  source: ReservationSource;
  actor: EmailActor;
  notifySwitchedOn: boolean;
}): EmailKind[] {
  const { op, oldStatus, newStatus, source, actor } = input;
  const byCustomer = actor === 'customer';
  if (source === 'walk_in') return [];
  if (op === 'INSERT') {
    if (newStatus === 'pending') return byCustomer ? ['customer_pending', 'restaurant_request'] : ['customer_pending'];
    if (newStatus === 'confirmed') return byCustomer && source === 'online' ? ['customer_confirmed', 'restaurant_new'] : ['customer_confirmed'];
    return [];
  }
  if (input.moved && oldStatus && ACTIVE.includes(oldStatus) && ACTIVE.includes(newStatus)) {
    return byCustomer ? ['customer_modified', 'restaurant_modified'] : ['customer_modified'];
  }
  if (oldStatus !== newStatus) {
    if (newStatus === 'confirmed' && oldStatus && ['pending', 'cancelled_customer', 'cancelled_restaurant', 'rejected'].includes(oldStatus)) {
      return ['customer_confirmed'];
    }
    if (newStatus === 'rejected') return ['customer_rejected'];
    if (newStatus === 'cancelled_restaurant') return ['customer_cancelled'];
    if (newStatus === 'cancelled_customer') return byCustomer ? ['customer_cancelled', 'restaurant_cancelled'] : ['customer_cancelled'];
    return [];
  }
  if (input.notifySwitchedOn) {
    if (newStatus === 'pending') return ['customer_pending'];
    if (newStatus === 'confirmed') return ['customer_confirmed'];
  }
  return [];
}

/** Para el historial de emails de la ficha de la reserva. */
export const EMAIL_KIND_LABELS_ES: Record<EmailKind, string> = {
  customer_pending: 'Solicitud recibida (al cliente)',
  customer_confirmed: 'Confirmación (al cliente)',
  customer_modified: 'Cambios en la reserva (al cliente)',
  customer_cancelled: 'Cancelación (al cliente)',
  customer_rejected: 'Reserva no confirmada (al cliente)',
  customer_reminder: 'Recordatorio (al cliente)',
  restaurant_new: 'Nueva reserva online (al restaurante)',
  restaurant_request: 'Reserva por confirmar (al restaurante)',
  restaurant_modified: 'Cambio del cliente (al restaurante)',
  restaurant_cancelled: 'Cancelación del cliente (al restaurante)',
};

export const EMAIL_STATUS_LABELS_ES: Record<EmailStatus, string> = {
  pending: 'Pendiente de envío',
  sending: 'Enviándose',
  sent: 'Enviado',
  failed: 'No se pudo enviar',
  skipped: 'No hacía falta',
};

/** «No pudimos enviar el email de confirmación al cliente». */
export function failedEmailText(kind: EmailKind): string {
  const what: Record<EmailKind, string> = {
    customer_pending: 'solicitud recibida al cliente',
    customer_confirmed: 'confirmación al cliente',
    customer_modified: 'cambios al cliente',
    customer_cancelled: 'cancelación al cliente',
    customer_rejected: 'reserva no confirmada al cliente',
    customer_reminder: 'recordatorio al cliente',
    restaurant_new: 'nueva reserva al restaurante',
    restaurant_request: 'reserva por confirmar al restaurante',
    restaurant_modified: 'cambio del cliente al restaurante',
    restaurant_cancelled: 'cancelación del cliente al restaurante',
  };
  return `No pudimos enviar el email de ${what[kind]}.`;
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:db tests/db/booking-online.test.ts && pnpm test:unit src/lib/email/outbox-rules.test.ts`
Expected: PASS: `tests/db/booking-online.test.ts` (33 pruebas) y `outbox-rules.test.ts` (3). Comprueba también que lo anterior sigue bien: `pnpm test:db` (218 pruebas en 13 archivos).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261128000100_reserva_online.sql src/lib/email/outbox-rules.ts src/lib/email/outbox-rules.test.ts tests/db/booking-online.test.ts tests/db/helpers.ts
git commit -m "BD: reserva online (ajustes, aviso al cliente), cola de emails, límite de intentos y reglas de encolado"
```

---

### Task 2: Migración 2: horas que se ofrecen, día público, alta online, botón «Reservar» y límite de intentos

**Files:**
- Create: `supabase/migrations/20261128000200_reserva_publica.sql`
- Create (prueba): `tests/db/booking-public.test.ts`
- Modify: `tests/db/helpers.ts`

**Interfaces:**
- Consumes: Tarea 1 (columnas, cola y trigger, `outboxKinds`, `fakeTokenHash`, `asServiceRole`, `setPublishedFields`); del 4A, `public.lock_reservation_days(uuid, tstzrange[])`, `public.reservation_duration(uuid, integer)`; en la prueba, `getAvailableSlots`, `servicesForDate`, `addDays`, `zonedTimeToUtc`.
- Produces:
  - `public.booking_settings_of(uuid) → public.booking_settings` (la fila o los valores por defecto) y `public.day_services(uuid, date) → table(name, start_minute, end_minute, last_minute, interval_min)` (auxiliares, nadie las ejecuta).
  - `public.is_bookable_slot(p_restaurant_id uuid, p_starts_at timestamptz, p_now timestamptz default now()) → boolean` (auxiliar).
  - `public.pick_online_table(p_restaurant_id, p_party, p_starts, p_ends, p_zone_id, p_ignore) → uuid` y `public.upsert_online_customer(p_restaurant_id, p_name, p_phone, p_email, p_marketing) → uuid` (auxiliares).
  - Solo `service_role`: `public.get_public_booking_day(p_slug text, p_date date, p_token_hash text default null) → jsonb` (claves `timezone`, `settings`, `services`, `exceptions`, `zones`, `tables`, `occupancy`, `blocks`; null si no hay reserva online), `public.public_booking_enabled(p_slug text) → boolean`, `public.create_public_reservation(p_slug, p_id, p_token_hash, p_party, p_starts_at, p_zone_id, p_name, p_email, p_phone, p_notes, p_locale, p_marketing_opt_in) → jsonb {id, status, table_ids}` (errores `BOOKING_CLOSED`, `INVALID_INPUT`, `SLOT_UNAVAILABLE`, `SLOT_TAKEN`) y `public.hit_rate_limit(p_key text, p_max_hits integer, p_window_seconds integer) → boolean`.
  - Helpers de prueba: `insertService(c, restaurantId, { weekday, name?, start?, end?, last?, interval? })`, `bookableRestaurant(c, slug, { timezone? }) → id` (publicado, cena diaria 20:00–23:30, antelación mínima 0), `localSlot(c, days, minute, timeZone?) → { date, at }`, `insertBlockForTable(c, restaurantId, tableId, startsAt, reason)`.

Lee antes: `supabase/migrations/20261127000200_reservas_funciones.sql` (`lock_reservation_days`, `pick_reservation_table`, `reservation_duration`, `upsert_customer`), `src/lib/reservations/day.ts` (`servicesForDate`, `effectiveLastBooking`) y `src/lib/reservations/availability.ts` (`getAvailableSlots`).

`is_bookable_slot` mira el reloj de pared **y** el instante: una hora que no existe la noche del adelanto no se ofrece, y una que existe dos veces vale la de invierno (igual que `zonedTimeToUtc` + `serviceDayMinute`). La ventana máxima se suma en horas (`max_advance_days * 24`) para no depender de la zona de la sesión. Las pruebas de alta usan fechas relativas a hoy (`localSlot`), porque la BD mira `now()`.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `tests/db/booking-public.test.ts`:

````ts
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
````

En `tests/db/helpers.ts`, sustituye:

````ts
    [restaurantId, contactEmail],
  );
}

````

por:

````ts
    [restaurantId, contactEmail],
  );
}

/** Servicio de un día de la semana (1 = lunes … 7 = domingo); por defecto, cena de 20:00 a 23:30 cada 15 min. */
export async function insertService(
  c: pg.PoolClient,
  restaurantId: string,
  s: { weekday: number; name?: string; start?: number; end?: number; last?: number | null; interval?: 15 | 30 },
): Promise<void> {
  await asSuperuser(c);
  await c.query(
    `insert into public.services (restaurant_id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [restaurantId, s.name ?? 'Cena', s.weekday, s.start ?? 1200, s.end ?? 1410, s.last ?? null, s.interval ?? 15],
  );
}

/**
 * Restaurante listo para la reserva online: publicado (activo, con email de contacto), cena todos los días de 20:00 a
 * 23:30 (última reserva 22:30) y ajustes con antelación mínima de 0 minutos y confirmación automática.
 */
export async function bookableRestaurant(c: pg.PoolClient, slug: string, opts: { timezone?: string } = {}): Promise<string> {
  const id = await insertRestaurant(c, { name: `Rest ${slug}`, slug });
  await setPublishedFields(c, id, `hola@${slug}.es`);
  if (opts.timezone) await c.query('update public.restaurants set timezone = $2 where id = $1', [id, opts.timezone]);
  for (let weekday = 1; weekday <= 7; weekday++) await insertService(c, id, { weekday });
  await c.query('insert into public.booking_settings (restaurant_id, min_advance_min) values ($1, 0)', [id]);
  return id;
}

/** Fecha local (AAAA-MM-DD) dentro de `days` días y el instante de `minute` de ese día, en la zona del restaurante. */
export async function localSlot(c: pg.PoolClient, days: number, minute: number, timeZone = 'Europe/Madrid'): Promise<{ date: string; at: string }> {
  const { rows } = await c.query<{ date: string; at: Date }>(
    `select ((now() at time zone $3)::date + $1::int)::text as date,
            (((now() at time zone $3)::date + $1::int)::timestamp + make_interval(mins => $2::int)) at time zone $3 as at`,
    [days, minute, timeZone],
  );
  return { date: rows[0].date, at: rows[0].at.toISOString() };
}

/** Bloqueo de una mesa (o de todo el restaurante con tableId null) de 3 horas desde startsAt. */
export async function insertBlockForTable(c: pg.PoolClient, restaurantId: string, tableId: string | null, startsAt: string, reason: string | null): Promise<void> {
  await asSuperuser(c);
  await c.query(
    "insert into public.blocks (restaurant_id, table_id, starts_at, ends_at, reason) values ($1, $2, $3::timestamptz, $3::timestamptz + interval '3 hours', $4)",
    [restaurantId, tableId, startsAt, reason],
  );
}
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:db tests/db/booking-public.test.ts`
Expected: FAIL: `function public.create_public_reservation(...) does not exist` (y el resto de funciones nuevas).

- [ ] **Step 3: Implementa**

Crea `supabase/migrations/20261128000200_reserva_publica.sql`:

````sql
-- Mesa · Hito 4B · reserva online pública: horas que se ofrecen, día público sin datos personales, alta online,
-- botón «Reservar» y límite de intentos. Todas las públicas son SECURITY DEFINER y solo las ejecuta service_role
-- (la app, desde el servidor, después de Turnstile y del límite de intentos). Anon y authenticated, nada.

/** Ajustes de reserva del restaurante o, si aún no los ha guardado, los valores por defecto de la tabla. */
create or replace function public.booking_settings_of(p_restaurant_id uuid) returns public.booking_settings
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s from public.booking_settings s where s.restaurant_id = p_restaurant_id),
    row(p_restaurant_id, 90, '[]'::jsonb, 60, 60, 8, 2, true, now(), now(), true, true, null)::public.booking_settings)
$$;

/**
 * Servicios de una fecha (igual que servicesForDate de src/lib/reservations/day.ts): los de su día de la semana,
 * salvo cierre (ninguno) u horario especial (los suyos, con la última reserva una hora antes del cierre y cada 15 min).
 */
create or replace function public.day_services(p_restaurant_id uuid, p_date date)
returns table (name text, start_minute integer, end_minute integer, last_minute integer, interval_min integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.schedule_exceptions%rowtype;
begin
  select * into e from public.schedule_exceptions x
   where x.restaurant_id = p_restaurant_id and p_date between x.date_from and x.date_to
   order by x.date_from limit 1;
  if found then
    if e.kind = 'closed' then
      return;
    end if;
    return query
      select c.v ->> 'name', (c.v ->> 'start_minute')::integer, (c.v ->> 'end_minute')::integer,
             greatest((c.v ->> 'start_minute')::integer, (c.v ->> 'end_minute')::integer - 60), 15
        from jsonb_array_elements(e.custom_services) c(v);
    return;
  end if;
  return query
    select s.name, s.start_minute::integer, s.end_minute::integer,
           coalesce(s.last_booking_minute::integer, greatest(s.start_minute::integer, s.end_minute::integer - 60)),
           s.slot_interval_min::integer
      from public.services s
     where s.restaurant_id = p_restaurant_id and s.weekday = extract(isodow from p_date)::integer;
end $$;

/**
 * ¿Se ofrece online esa hora? Es una de las horas de un servicio de su día de servicio (o de la víspera, si el servicio
 * pasa de medianoche), alineada al intervalo y no después de la última reserva, que existe ese día (no cae en el hueco
 * del cambio de hora; si existe dos veces, vale la de la hora de invierno, como en la app) y está dentro de la
 * antelación mínima y máxima. p_now: para las pruebas.
 */
create or replace function public.is_bookable_slot(p_restaurant_id uuid, p_starts_at timestamptz, p_now timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  s public.booking_settings;
  v_wall timestamp;
  v_day date;
begin
  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  if v_tz is null or p_starts_at is null then
    return false;
  end if;
  s := public.booking_settings_of(p_restaurant_id);
  if p_starts_at < p_now + make_interval(mins => s.min_advance_min)
     or p_starts_at > p_now + make_interval(hours => s.max_advance_days * 24) then
    return false;
  end if;
  v_wall := p_starts_at at time zone v_tz;
  foreach v_day in array array[v_wall::date, v_wall::date - 1] loop
    if exists (
      select 1
        from public.day_services(p_restaurant_id, v_day) d,
             generate_series(d.start_minute, d.last_minute, d.interval_min) m
       where v_day::timestamp + make_interval(mins => m) = v_wall
         and (v_day::timestamp + make_interval(mins => m)) at time zone v_tz = p_starts_at
    ) then
      return true;
    end if;
  end loop;
  return false;
end $$;

/** Como pick_reservation_table, pero solo entre las mesas reservables online y, si se pide, de esa zona. */
create or replace function public.pick_online_table(
  p_restaurant_id uuid, p_party integer, p_starts timestamptz, p_ends timestamptz, p_zone_id uuid, p_ignore uuid
) returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
    from public.tables t
    join public.zones z on z.id = t.zone_id and z.restaurant_id = t.restaurant_id
   where t.restaurant_id = p_restaurant_id and t.active and t.online_bookable
     and (p_zone_id is null or t.zone_id = p_zone_id)
     and t.min_capacity <= p_party and t.max_capacity >= p_party
     and not exists (
       select 1 from public.reservation_tables rt
        where rt.table_id = t.id and rt.restaurant_id = p_restaurant_id and rt.active
          and rt.reservation_id is distinct from p_ignore and rt.starts_at < p_ends and rt.ends_at > p_starts)
     and not exists (
       select 1 from public.blocks b
        where b.restaurant_id = p_restaurant_id and (b.table_id = t.id or b.table_id is null)
          and b.starts_at < p_ends and b.ends_at > p_starts)
   order by t.max_capacity, z.position, t.position, t.name collate "C", t.id
   limit 1
$$;

/**
 * Cliente de una reserva online: se busca por email y, si no, por teléfono. No se sobrescriben nombre ni notas; solo
 * se rellenan el email o el teléfono que falten si no son de otro cliente; marketing_opt_in solo pasa a true.
 */
create or replace function public.upsert_online_customer(
  p_restaurant_id uuid, p_name text, p_phone text, p_email text, p_marketing boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  for attempt in 1..2 loop
    select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.email = p_email;
    if v_id is null then
      select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.phone = p_phone;
    end if;
    if v_id is not null then
      update public.customers c
         set phone = coalesce(c.phone, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.phone = p_phone) then p_phone end),
             email = coalesce(c.email, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.email = p_email) then p_email end),
             marketing_opt_in = c.marketing_opt_in or coalesce(p_marketing, false),
             marketing_opt_in_at = case when not c.marketing_opt_in and coalesce(p_marketing, false) then now()
                                        else c.marketing_opt_in_at end
       where c.id = v_id and c.restaurant_id = p_restaurant_id;
      return v_id;
    end if;
    insert into public.customers (restaurant_id, name, phone, email, marketing_opt_in, marketing_opt_in_at)
    values (p_restaurant_id, p_name, p_phone, p_email, coalesce(p_marketing, false),
            case when coalesce(p_marketing, false) then now() end)
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  raise exception 'INVALID_INPUT' using errcode = '22023';
end $$;

/**
 * Todo lo que necesita la página pública para calcular las horas libres de un día, sin ningún dato personal: zona
 * horaria, ajustes, servicios de la semana y excepciones de la ventana de antelación, zonas con mesas online, mesas
 * online activas, y lo que las ocupa (reservas activas y bloqueos) del día de servicio. p_token_hash: al modificar,
 * la propia reserva no cuenta. null si el restaurante no está activo o no tiene la reserva online activada.
 */
create or replace function public.get_public_booking_day(p_slug text, p_date date, p_token_hash text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants%rowtype;
  s public.booking_settings;
  v_from timestamptz;
  v_until timestamptz;
  v_today date;
  v_ignore uuid;
begin
  select * into r from public.restaurants x where x.slug = lower(btrim(coalesce(p_slug, ''))) and x.status = 'active';
  if not found or p_date is null then
    return null;
  end if;
  s := public.booking_settings_of(r.id);
  if not s.online_enabled then
    return null;
  end if;
  v_today := (now() at time zone r.timezone)::date;
  v_from := p_date::timestamp at time zone r.timezone;
  -- Hasta las 06:00 del día siguiente (lo último que se puede reservar) más 12 h de duración máxima.
  v_until := ((p_date + 1)::timestamp + interval '6 hours') at time zone r.timezone + interval '12 hours';
  if p_token_hash is not null then
    select x.id into v_ignore from public.reservations x where x.restaurant_id = r.id and x.manage_token_hash = p_token_hash;
  end if;
  return jsonb_build_object(
    'timezone', r.timezone,
    'settings', jsonb_build_object(
      'default_duration_min', s.default_duration_min, 'duration_rules', s.duration_rules,
      'min_advance_min', s.min_advance_min, 'max_advance_days', s.max_advance_days,
      'max_online_party', s.max_online_party, 'cancel_limit_hours', s.cancel_limit_hours, 'auto_confirm', s.auto_confirm),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'name', x.name, 'weekday', x.weekday, 'start_minute', x.start_minute, 'end_minute', x.end_minute,
               'last_booking_minute', x.last_booking_minute, 'slot_interval_min', x.slot_interval_min
             ) order by x.weekday, x.start_minute)
        from public.services x where x.restaurant_id = r.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date_from', e.date_from, 'date_to', e.date_to, 'kind', e.kind, 'custom_services', e.custom_services
             ) order by e.date_from)
        from public.schedule_exceptions e
       where e.restaurant_id = r.id and e.date_to >= least(v_today, p_date) - 1
         and e.date_from <= greatest(v_today + s.max_advance_days, p_date) + 1
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'position', z.position) order by z.position, z.name collate "C")
        from public.zones z
       where z.restaurant_id = r.id
         and exists (select 1 from public.tables t where t.zone_id = z.id and t.restaurant_id = r.id and t.active and t.online_bookable)
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'zone_id', t.zone_id, 'name', t.name, 'min_capacity', t.min_capacity,
               'max_capacity', t.max_capacity, 'position', t.position
             ) order by t.position, t.name collate "C")
        from public.tables t where t.restaurant_id = r.id and t.active and t.online_bookable
    ), '[]'::jsonb),
    'occupancy', coalesce((
      select jsonb_agg(jsonb_build_object('table_id', rt.table_id, 'starts_at', rt.starts_at, 'ends_at', rt.ends_at)
                       order by rt.starts_at, rt.table_id)
        from public.reservation_tables rt
        join public.tables t on t.id = rt.table_id and t.restaurant_id = rt.restaurant_id and t.active and t.online_bookable
       where rt.restaurant_id = r.id and rt.active and rt.reservation_id is distinct from v_ignore
         and rt.starts_at < v_until and rt.ends_at > v_from
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('table_id', b.table_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at)
                       order by b.starts_at, b.table_id)
        from public.blocks b where b.restaurant_id = r.id and b.starts_at < v_until and b.ends_at > v_from
    ), '[]'::jsonb)
  );
end $$;

/** Botón «Reservar»: restaurante activo, reserva online activada y al menos una mesa online activa. */
create or replace function public.public_booking_enabled(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.restaurants r
     where r.slug = lower(btrim(coalesce(p_slug, ''))) and r.status = 'active'
       and (public.booking_settings_of(r.id)).online_enabled
       and exists (select 1 from public.tables t where t.restaurant_id = r.id and t.active and t.online_bookable)
  )
$$;

/**
 * Alta online. Comprueba restaurante activo con reserva online, datos, hora ofrecida y personas (1–50). Hasta el
 * máximo online: la mesa online más pequeña que sirve (de la zona, si se pide), confirmada o pendiente según
 * auto_confirm; si no queda, SLOT_TAKEN. Por encima del máximo: solicitud pendiente sin mesa. El id y la huella del
 * enlace los pone la app (el token es un HMAC del id). Devuelve {"id", "status", "table_ids"}.
 */
create or replace function public.create_public_reservation(
  p_slug text, p_id uuid, p_token_hash text, p_party integer, p_starts_at timestamptz, p_zone_id uuid,
  p_name text, p_email text, p_phone text, p_notes text, p_locale text, p_marketing_opt_in boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants%rowtype;
  s public.booking_settings;
  v_name text := nullif(btrim(p_name), '');
  v_email text := lower(nullif(btrim(p_email), ''));
  v_phone text := nullif(btrim(p_phone), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_ends timestamptz;
  v_table uuid;
  v_status public.reservation_status;
  v_customer uuid;
begin
  perform set_config('mesa.actor', 'customer', true);
  select * into r from public.restaurants x where x.slug = lower(btrim(coalesce(p_slug, ''))) and x.status = 'active';
  if not found then
    raise exception 'BOOKING_CLOSED' using errcode = 'P0001';
  end if;
  s := public.booking_settings_of(r.id);
  if not s.online_enabled then
    raise exception 'BOOKING_CLOSED' using errcode = 'P0001';
  end if;
  if p_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_party is null or p_party not between 1 and 50 or p_starts_at is null
     or v_name is null or length(v_name) > 120
     or v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$'
     or length(v_notes) > 500 or coalesce(p_locale, '') not in ('es', 'en', 'ca', 'fr', 'de', 'it')
     or (p_zone_id is not null and not exists (select 1 from public.zones z where z.id = p_zone_id and z.restaurant_id = r.id)) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if not public.is_bookable_slot(r.id, p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_ends := p_starts_at + make_interval(mins => public.reservation_duration(r.id, p_party));
  perform public.lock_reservation_days(r.id, array[tstzrange(p_starts_at, v_ends)]);
  if p_party <= s.max_online_party then
    v_table := public.pick_online_table(r.id, p_party, p_starts_at, v_ends, p_zone_id, null);
    if v_table is null then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    end if;
    v_status := case when s.auto_confirm then 'confirmed' else 'pending' end;
  else
    v_status := 'pending';
  end if;
  v_customer := public.upsert_online_customer(r.id, v_name, v_phone, v_email, p_marketing_opt_in);
  begin
    insert into public.reservations (id, restaurant_id, customer_id, party_size, starts_at, ends_at, status, source, notes,
                                     locale, manage_token_hash, privacy_accepted_at, notify_customer)
    values (p_id, r.id, v_customer, p_party, p_starts_at, v_ends, v_status, 'online', v_notes,
            p_locale, p_token_hash, now(), true);
    if v_table is not null then
      insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values (p_id, v_table, r.id);
    end if;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'INVALID_INPUT' using errcode = '22023';
  end;
  return jsonb_build_object('id', p_id, 'status', v_status,
                            'table_ids', case when v_table is null then '[]'::jsonb else jsonb_build_array(v_table) end);
end $$;

/**
 * Límite de intentos por ventanas fijas: suma un intento a la clave en la ventana actual y dice si sigue dentro del
 * límite. La tarea horaria borra las ventanas de más de un día.
 */
create or replace function public.hit_rate_limit(p_key text, p_max_hits integer, p_window_seconds integer)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or length(p_key) not between 1 and 200 or coalesce(p_max_hits, 0) < 1 or coalesce(p_window_seconds, 0) < 1 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as l (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = l.hits + 1
  returning l.hits into v_hits;
  return v_hits <= p_max_hits;
end $$;

-- Privilegios: las auxiliares, para nadie; las públicas, solo service_role.
revoke execute on function public.booking_settings_of(uuid), public.day_services(uuid, date),
  public.is_bookable_slot(uuid, timestamptz, timestamptz),
  public.pick_online_table(uuid, integer, timestamptz, timestamptz, uuid, uuid),
  public.upsert_online_customer(uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_public_booking_day(text, date, text), public.public_booking_enabled(text),
  public.create_public_reservation(text, uuid, text, integer, timestamptz, uuid, text, text, text, text, text, boolean),
  public.hit_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_public_booking_day(text, date, text), public.public_booking_enabled(text),
  public.create_public_reservation(text, uuid, text, integer, timestamptz, uuid, text, text, text, text, text, boolean),
  public.hit_rate_limit(text, integer, integer)
  to service_role;
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:db tests/db/booking-public.test.ts`
Expected: PASS: 18 pruebas, incluidas las 4 que comparan `is_bookable_slot` con `getAvailableSlots` (cambio de hora en Madrid y Canarias, servicios que pasan de medianoche, excepciones y antelación).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261128000200_reserva_publica.sql tests/db/booking-public.test.ts tests/db/helpers.ts
git commit -m "BD: horas que se ofrecen, día público sin datos personales, alta online y límite de intentos"
```

---

### Task 3: Migración 3: enlace del comensal (ver, modificar, cancelar) y nuevas versiones de las funciones del panel

**Files:**
- Create: `supabase/migrations/20261128000300_reserva_enlace_panel.sql`
- Create (prueba): `tests/db/booking-manage.test.ts`
- Modify: `tests/db/reservations.test.ts`

**Interfaces:**
- Consumes: Tareas 1–2 (`booking_settings_of`, `is_bookable_slot`, `pick_online_table`, `bookableRestaurant`, `localSlot`); del 4A, `resolve_reservation_tables`, `upsert_customer`, `lock_reservation_days`, `reservation_duration`.
- Produces:
  - Auxiliares (nadie): `public.reservation_by_token(p_slug, p_token_hash, p_lock) → public.reservations` y `public.customer_can_change(p_status, p_starts_at, p_cancel_limit_hours) → boolean`.
  - Solo `service_role`: `public.get_public_reservation(p_slug, p_token_hash) → jsonb {status, starts_at, ends_at, party_size, customer_name, notes, locale, zone_id, zone_name, change_until, can_change, online_enabled}` (null si no existe), `public.modify_public_reservation(p_slug, p_token_hash, p_party, p_starts_at, p_zone_id) → jsonb {status, table_ids}` (errores `NOT_FOUND`, `CHANGE_CLOSED`, `BOOKING_CLOSED`, `INVALID_INPUT`, `SLOT_UNAVAILABLE`, `SLOT_TAKEN`) y `public.cancel_public_reservation(p_slug, p_token_hash) → void` (`NOT_FOUND`, `CHANGE_CLOSED`).
  - Panel (authenticated): `public.create_panel_reservation(…los 11 del 4A…, p_id uuid default null, p_notify_customer boolean default false, p_token_hash text default null) → jsonb {id, table_ids}` y `public.update_panel_reservation(…los 9 del 4A…, p_notify_customer boolean default null, p_token_hash text default null) → jsonb` (error nuevo `NO_CUSTOMER_EMAIL`). Las dos marcan `mesa.actor = 'staff'`.

Lee antes: `create_panel_reservation` y `update_panel_reservation` en `supabase/migrations/20261127000200_reservas_funciones.sql` (se copian con los cambios del 4B; la migración antigua **no** se toca) y `tests/db/reservations-functions.test.ts`.

Las funciones del panel se **borran y se vuelven a crear** en la migración nueva (no se edita la del 4A). Los parámetros nuevos van al final y con valor por defecto: así el código del 4A que ya está desplegado sigue llamándolas bien entre que se aplican las migraciones y se despliega el código nuevo.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `tests/db/booking-manage.test.ts`:

````ts
import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asServiceRole,
  asSuperuser,
  bookableRestaurant,
  createUser,
  expectDbError,
  fakeTokenHash,
  insertCustomer,
  insertReservation,
  insertTable,
  insertZone,
  localSlot,
  outboxKinds,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

const GET = 'select public.get_public_reservation($1, $2) as r';
const MODIFY = 'select public.modify_public_reservation($1, $2, $3, $4, $5) as r';
const CANCEL = 'select public.cancel_public_reservation($1, $2)';
const TOKEN = fakeTokenHash(42);

/** «enlace» (T1 1–2 y T2 2–4 en Terraza) con una reserva online confirmada de Ana dentro de 3 días a las 21:00 en T2. */
async function setup(c: pg.PoolClient, o: { startsAt?: string; status?: 'pending' | 'confirmed' | 'cancelled_restaurant' } = {}) {
  const a = await bookableRestaurant(c, 'enlace');
  const other = await bookableRestaurant(c, 'otro');
  const terraza = await insertZone(c, a, 'Terraza', 0);
  const t = {
    T1: await insertTable(c, a, terraza, { name: 'T1', min: 1, max: 2, position: 0 }),
    T2: await insertTable(c, a, terraza, { name: 'T2', min: 2, max: 4, position: 1 }),
  };
  const slot = await localSlot(c, 3, 21 * 60);
  const customerId = await insertCustomer(c, a, { name: 'Ana García', phone: '+34612345678', email: 'ana@example.com' });
  const id = await insertReservation(c, a, {
    startsAt: o.startsAt ?? slot.at,
    partySize: 3,
    status: o.status ?? 'confirmed',
    source: 'online',
    customerId,
    tableIds: o.status === 'cancelled_restaurant' ? [] : [t.T2],
    notifyCustomer: true,
    tokenHash: TOKEN,
  });
  await c.query("update public.reservations set notes = 'Cumpleaños' where id = $1", [id]);
  return { a, other, terraza, t, slot, id, customerId };
}

async function asService<T>(c: pg.PoolClient, fn: () => Promise<T>): Promise<T> {
  await asServiceRole(c);
  try {
    return await fn();
  } finally {
    await asSuperuser(c);
  }
}

describe('privilegios', () => {
  it('ver, modificar y cancelar con el token: solo service_role; las del panel: authenticated', () =>
    tx(async (c) => {
      const service = [
        'public.get_public_reservation(text, text)',
        'public.modify_public_reservation(text, text, integer, timestamptz, uuid)',
        'public.cancel_public_reservation(text, text)',
      ];
      const helpers = ['public.reservation_by_token(text, text, boolean)', 'public.customer_can_change(public.reservation_status, timestamptz, integer)'];
      for (const fn of [...service, ...helpers]) {
        for (const role of ['anon', 'authenticated']) {
          expect((await c.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0].ok, `${role} ${fn}`).toBe(false);
        }
        expect((await c.query("select has_function_privilege('service_role', $1, 'execute') as ok", [fn])).rows[0].ok, fn).toBe(service.includes(fn));
      }
      const panel = [
        'public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text, uuid, boolean, text)',
        'public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text, boolean, text)',
      ];
      for (const fn of panel) {
        expect((await c.query("select has_function_privilege('authenticated', $1, 'execute') as ok", [fn])).rows[0].ok).toBe(true);
        expect((await c.query("select has_function_privilege('anon', $1, 'execute') as ok", [fn])).rows[0].ok).toBe(false);
      }
      const old = await c.query("select count(*)::int as n from pg_proc where proname in ('create_panel_reservation', 'update_panel_reservation')");
      expect(old.rows[0].n).toBe(2);
    }));
});

describe('get_public_reservation', () => {
  it('datos para la página del enlace, sin teléfono ni email', () =>
    tx(async (c) => {
      const { slot } = await setup(c);
      const r = await asService(c, async () => (await c.query(GET, ['enlace', TOKEN])).rows[0].r);
      expect(r).toMatchObject({
        status: 'confirmed',
        party_size: 3,
        customer_name: 'Ana García',
        notes: 'Cumpleaños',
        locale: 'es',
        zone_name: 'Terraza',
        can_change: true,
        online_enabled: true,
      });
      expect(Date.parse(r.starts_at)).toBe(Date.parse(slot.at));
      expect(Date.parse(r.change_until)).toBe(Date.parse(slot.at) - 2 * 3_600_000);
      expect(JSON.stringify(r)).not.toMatch(/612345678|ana@example\.com/);
    }));

  it('null con un token que no existe, mal formado o de otro restaurante', () =>
    tx(async (c) => {
      await setup(c);
      await asService(c, async () => {
        expect((await c.query(GET, ['enlace', fakeTokenHash(43)])).rows[0].r).toBeNull();
        expect((await c.query(GET, ['enlace', 'no-es-un-token'])).rows[0].r).toBeNull();
        expect((await c.query(GET, ['otro', TOKEN])).rows[0].r).toBeNull();
      });
    }));

  it('dentro del límite de cancelación ya no se puede cambiar', () =>
    tx(async (c) => {
      await setup(c, { startsAt: new Date(Date.now() + 3_600_000).toISOString() });
      const r = await asService(c, async () => (await c.query(GET, ['enlace', TOKEN])).rows[0].r);
      expect(r.can_change).toBe(false);
    }));
});

describe('modify_public_reservation', () => {
  it('cambia día, hora y personas, vuelve a asignar mesa y avisa al cliente y al restaurante', () =>
    tx(async (c) => {
      const { id, t } = await setup(c);
      const later = await localSlot(c, 4, 20 * 60 + 30);
      const r = await asService(c, async () => (await c.query(MODIFY, ['enlace', TOKEN, 2, later.at, null])).rows[0].r);
      expect(r).toEqual({ status: 'confirmed', table_ids: [t.T1] });
      const { rows } = await c.query('select party_size, starts_at, ends_at from public.reservations where id = $1', [id]);
      expect(rows[0].party_size).toBe(2);
      expect(rows[0].starts_at.toISOString()).toBe(later.at);
      expect(rows[0].ends_at.getTime() - rows[0].starts_at.getTime()).toBe(90 * 60_000);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed', 'customer_modified', 'restaurant_modified']);
    }));

  it('su propia mesa no le cuenta como ocupada; con confirmación manual queda pendiente; por encima del máximo, sin mesa', () =>
    tx(async (c) => {
      const { a, id, t, slot } = await setup(c);
      const same = await asService(c, async () => (await c.query(MODIFY, ['enlace', TOKEN, 4, slot.at, null])).rows[0].r);
      expect(same).toEqual({ status: 'confirmed', table_ids: [t.T2] });
      await c.query('update public.booking_settings set auto_confirm = false, max_online_party = 4 where restaurant_id = $1', [a]);
      const pending = await asService(c, async () => (await c.query(MODIFY, ['enlace', TOKEN, 3, slot.at, null])).rows[0].r);
      expect(pending).toEqual({ status: 'pending', table_ids: [t.T2] });
      const group = await asService(c, async () => (await c.query(MODIFY, ['enlace', TOKEN, 9, slot.at, null])).rows[0].r);
      expect(group).toEqual({ status: 'pending', table_ids: [] });
      expect((await c.query('select status from public.reservations where id = $1', [id])).rows[0].status).toBe('pending');
    }));

  it('sin mesa online libre: SLOT_TAKEN y la reserva se queda como estaba', () =>
    tx(async (c) => {
      const { a, id, t, slot } = await setup(c);
      const other = await localSlot(c, 5, 21 * 60);
      await insertReservation(c, a, { startsAt: other.at, tableIds: [t.T2] });
      await asServiceRole(c);
      await expectDbError(c, MODIFY, ['enlace', TOKEN, 3, other.at, null], /SLOT_TAKEN/);
      await asSuperuser(c);
      const { rows } = await c.query('select starts_at from public.reservations where id = $1', [id]);
      expect(rows[0].starts_at.toISOString()).toBe(slot.at);
      expect((await c.query('select table_id from public.reservation_tables where reservation_id = $1', [id])).rows).toEqual([{ table_id: t.T2 }]);
    }));

  it('fuera de plazo, cerrada, sin reserva online, hora que no se ofrece o token de otro restaurante', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const later = await localSlot(c, 4, 21 * 60);
      const off = await localSlot(c, 4, 21 * 60 + 10);
      await asServiceRole(c);
      await expectDbError(c, MODIFY, ['enlace', TOKEN, 2, off.at, null], /SLOT_UNAVAILABLE/);
      await expectDbError(c, MODIFY, ['otro', TOKEN, 2, later.at, null], /NOT_FOUND/);
      await expectDbError(c, MODIFY, ['enlace', TOKEN, 0, later.at, null], /INVALID_INPUT/);
      await asSuperuser(c);
      await c.query('update public.booking_settings set online_enabled = false where restaurant_id = $1', [a]);
      await asServiceRole(c);
      await expectDbError(c, MODIFY, ['enlace', TOKEN, 2, later.at, null], /BOOKING_CLOSED/);
      await asSuperuser(c);
      await c.query("update public.reservations set starts_at = now() + interval '1 hour', ends_at = now() + interval '150 minutes' where manage_token_hash = $1", [TOKEN]);
      await asServiceRole(c);
      await expectDbError(c, MODIFY, ['enlace', TOKEN, 2, later.at, null], /CHANGE_CLOSED/);
    }));
});

describe('cancel_public_reservation', () => {
  it('dentro de plazo: cancelada por el cliente, cuenta en sus cancelaciones y avisa a los dos', () =>
    tx(async (c) => {
      const { id, customerId } = await setup(c);
      await asService(c, () => c.query(CANCEL, ['enlace', TOKEN]));
      const { rows } = await c.query('select status, previous_status from public.reservations where id = $1', [id]);
      expect(rows[0]).toEqual({ status: 'cancelled_customer', previous_status: 'confirmed' });
      expect((await c.query('select cancel_count from public.customers where id = $1', [customerId])).rows[0].cancel_count).toBe(1);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed', 'customer_cancelled', 'restaurant_cancelled']);
      expect((await c.query('select count(*)::int as n from public.reservation_tables where reservation_id = $1 and active', [id])).rows[0].n).toBe(0);
    }));

  it('fuera de plazo o ya cancelada: CHANGE_CLOSED; con la reserva online apagada se puede cancelar igual', () =>
    tx(async (c) => {
      await setup(c, { status: 'cancelled_restaurant' });
      await asServiceRole(c);
      await expectDbError(c, CANCEL, ['enlace', TOKEN], /CHANGE_CLOSED/);
      await expectDbError(c, CANCEL, ['otro', TOKEN], /NOT_FOUND/);
    }));

  it('con la reserva online apagada se puede cancelar', () =>
    tx(async (c) => {
      const { a, id } = await setup(c);
      await c.query('update public.booking_settings set online_enabled = false where restaurant_id = $1', [a]);
      await asService(c, () => c.query(CANCEL, ['enlace', TOKEN]));
      expect((await c.query('select status from public.reservations where id = $1', [id])).rows[0].status).toBe('cancelled_customer');
    }));
});

describe('funciones del panel (versiones del 4B)', () => {
  const CREATE = 'select public.create_panel_reservation($1, $2, null, 2, null, false, $3, $4, $5, null, null, $6, $7, $8) as r';
  const CREATE_4A = 'select public.create_panel_reservation($1, $2, null, 2, null, false, $3, $4, $5, null, null) as r';

  async function staffSetup(c: pg.PoolClient) {
    const base = await setup(c);
    const staff = await createUser(c, 'sala@example.com');
    await addMember(c, base.a, staff.id, 'staff');
    return { ...base, staff };
  }

  it('reserva por teléfono con aviso: guarda el id y la huella y manda solo el email al cliente', () =>
    tx(async (c) => {
      const { a, staff } = await staffSetup(c);
      const at = (await localSlot(c, 6, 21 * 60)).at;
      const id = crypto.randomUUID();
      await as(c, staff);
      const r = (await c.query(CREATE, [a, at, 'Luis', '+34600000001', 'luis@example.com', id, true, fakeTokenHash(500)])).rows[0].r;
      expect(r.id).toBe(id);
      await asSuperuser(c);
      const { rows } = await c.query('select notify_customer, manage_token_hash, source from public.reservations where id = $1', [id]);
      expect(rows[0]).toEqual({ notify_customer: true, manage_token_hash: fakeTokenHash(500), source: 'phone' });
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed']);
    }));

  it('sin aviso no se guarda la huella ni sale ningún email; con aviso y sin email: INVALID_INPUT; la llamada del 4A sigue valiendo', () =>
    tx(async (c) => {
      const { a, staff } = await staffSetup(c);
      const at = (await localSlot(c, 6, 21 * 60)).at;
      await as(c, staff);
      const quiet = (await c.query(CREATE, [a, at, 'Luis', '+34600000001', 'luis@example.com', null, false, fakeTokenHash(501)])).rows[0].r;
      await expectDbError(c, CREATE, [a, at, 'Eva', '+34600000002', null, crypto.randomUUID(), true, fakeTokenHash(502)], /INVALID_INPUT/);
      const old = (await c.query(CREATE_4A, [a, at, 'Eva', '+34600000002', null])).rows[0].r;
      await asSuperuser(c);
      for (const id of [quiet.id, old.id]) {
        expect((await c.query('select notify_customer, manage_token_hash from public.reservations where id = $1', [id])).rows[0]).toEqual({
          notify_customer: false,
          manage_token_hash: null,
        });
        expect(await outboxKinds(c, id)).toEqual([]);
      }
    }));

  it('activar los avisos al cambiar una reserva telefónica: pone la huella y manda la confirmación', () =>
    tx(async (c) => {
      const { a, staff, slot } = await staffSetup(c);
      const customerId = await insertCustomer(c, a, { name: 'Eva', phone: '+34600000003', email: 'eva@example.com' });
      const id = await insertReservation(c, a, { startsAt: slot.at, customerId });
      const UPDATE = 'select public.update_panel_reservation($1, $2, $3, 90, 2, $4, true, null, null, $5, $6)';
      await as(c, staff);
      await c.query(UPDATE, [a, id, slot.at, [], true, fakeTokenHash(600)]);
      await asSuperuser(c);
      expect((await c.query('select notify_customer, manage_token_hash from public.reservations where id = $1', [id])).rows[0]).toEqual({
        notify_customer: true,
        manage_token_hash: fakeTokenHash(600),
      });
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed']);
      const noEmail = await insertReservation(c, a, { startsAt: slot.at, customerId: await insertCustomer(c, a, { name: 'Sin email', phone: '+34600000004' }) });
      await as(c, staff);
      await expectDbError(c, UPDATE, [a, noEmail, slot.at, [], true, fakeTokenHash(601)], /NO_CUSTOMER_EMAIL/);
      // null: no se tocan los avisos; cambiar la hora avisa del cambio.
      const later = (await localSlot(c, 4, 21 * 60)).at;
      await c.query('select public.update_panel_reservation($1, $2, $3, 90, 2, $4, true, null, null)', [a, id, later, []]);
      await asSuperuser(c);
      expect(await outboxKinds(c, id)).toEqual(['customer_confirmed', 'customer_modified']);
    }));
});
````

En `tests/db/reservations.test.ts`, sustituye:

````ts
      for (const fn of [
        'public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text)',
        'public.create_walk_in(uuid, integer, uuid[], integer, text)',
        'public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text)',
        'public.set_reservation_status(uuid, uuid, public.reservation_status)',
````

por:

````ts
      for (const fn of [
        // Versiones del Hito 4B (20261128000300): los parámetros nuevos van al final.
        'public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text, uuid, boolean, text)',
        'public.create_walk_in(uuid, integer, uuid[], integer, text)',
        'public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text, boolean, text)',
        'public.set_reservation_status(uuid, uuid, public.reservation_status)',
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:db tests/db/booking-manage.test.ts tests/db/reservations.test.ts tests/db/reservations-functions.test.ts tests/db/reservations-concurrency.test.ts`
Expected: FAIL: `function public.get_public_reservation(...) does not exist`, y en `reservations.test.ts`, `function "public.create_panel_reservation(uuid, timestamptz, …, uuid, boolean, text)" does not exist` (aún no existe la versión nueva). Las pruebas del 4A con 11 y 9 argumentos siguen pasando.

- [ ] **Step 3: Implementa**

Crea `supabase/migrations/20261128000300_reserva_enlace_panel.sql`:

````sql
-- Mesa · Hito 4B · enlace del comensal (ver, modificar y cancelar con el token) y nuevas versiones de las funciones
-- del panel que crean y cambian reservas (id, aviso por email y huella del enlace). Las del enlace, solo service_role.

/** La reserva de ese enlace en ese restaurante activo (para update si p_lock), o nada. */
create or replace function public.reservation_by_token(p_slug text, p_token_hash text, p_lock boolean)
returns public.reservations language plpgsql security definer set search_path = '' as $$
declare
  v public.reservations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  if p_lock then
    select x.* into v from public.reservations x
      join public.restaurants r on r.id = x.restaurant_id
     where r.slug = lower(btrim(coalesce(p_slug, ''))) and r.status = 'active' and x.manage_token_hash = p_token_hash
       for update of x;
  else
    select x.* into v from public.reservations x
      join public.restaurants r on r.id = x.restaurant_id
     where r.slug = lower(btrim(coalesce(p_slug, ''))) and r.status = 'active' and x.manage_token_hash = p_token_hash;
  end if;
  if not found then
    return null;
  end if;
  return v;
end $$;

/** ¿Puede el comensal cambiar o cancelar? Pendiente o confirmada y antes del límite de cancelación. */
create or replace function public.customer_can_change(p_status public.reservation_status, p_starts_at timestamptz, p_cancel_limit_hours integer)
returns boolean language sql stable set search_path = '' as $$
  select p_status in ('pending', 'confirmed') and now() < p_starts_at - make_interval(hours => p_cancel_limit_hours)
$$;

/**
 * Página del enlace: nombre del cliente, día, hora, personas, zona, notas, estado e idioma, y si se puede cambiar
 * y hasta cuándo. Ni teléfono ni email. null si el token no existe o es de otro restaurante.
 */
create or replace function public.get_public_reservation(p_slug text, p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.reservations%rowtype;
  s public.booking_settings;
  v_zone record;
begin
  v := public.reservation_by_token(p_slug, p_token_hash, false);
  if v.id is null then
    return null;
  end if;
  s := public.booking_settings_of(v.restaurant_id);
  select z.id, z.name into v_zone
    from public.reservation_tables rt
    join public.tables t on t.id = rt.table_id and t.restaurant_id = rt.restaurant_id
    join public.zones z on z.id = t.zone_id and z.restaurant_id = t.restaurant_id
   where rt.reservation_id = v.id and rt.restaurant_id = v.restaurant_id
   order by z.position, t.position, t.name collate "C"
   limit 1;
  return jsonb_build_object(
    'status', v.status,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'party_size', v.party_size,
    'customer_name', (select c.name from public.customers c where c.id = v.customer_id and c.restaurant_id = v.restaurant_id),
    'notes', v.notes,
    'locale', v.locale,
    'zone_id', v_zone.id,
    'zone_name', v_zone.name,
    'change_until', v.starts_at - make_interval(hours => s.cancel_limit_hours),
    'can_change', public.customer_can_change(v.status, v.starts_at, s.cancel_limit_hours),
    'online_enabled', s.online_enabled
  );
end $$;

/**
 * El comensal cambia día, hora, personas o zona: solo en pendiente o confirmada, antes del límite (si no,
 * CHANGE_CLOSED) y con la reserva online activada (BOOKING_CLOSED). Se vuelve a asignar mesa como en el alta (o
 * solicitud sin mesa por encima del máximo online); con confirmación manual queda pendiente.
 * Devuelve {"status", "table_ids"}.
 */
create or replace function public.modify_public_reservation(
  p_slug text, p_token_hash text, p_party integer, p_starts_at timestamptz, p_zone_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.reservations%rowtype;
  s public.booking_settings;
  v_ends timestamptz;
  v_table uuid;
  v_status public.reservation_status;
begin
  perform set_config('mesa.actor', 'customer', true);
  v := public.reservation_by_token(p_slug, p_token_hash, true);
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  s := public.booking_settings_of(v.restaurant_id);
  if not public.customer_can_change(v.status, v.starts_at, s.cancel_limit_hours) then
    raise exception 'CHANGE_CLOSED' using errcode = 'P0001';
  end if;
  if not s.online_enabled then
    raise exception 'BOOKING_CLOSED' using errcode = 'P0001';
  end if;
  if p_party is null or p_party not between 1 and 50 or p_starts_at is null
     or (p_zone_id is not null and not exists (select 1 from public.zones z where z.id = p_zone_id and z.restaurant_id = v.restaurant_id)) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if not public.is_bookable_slot(v.restaurant_id, p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_ends := p_starts_at + make_interval(mins => public.reservation_duration(v.restaurant_id, p_party));
  perform public.lock_reservation_days(v.restaurant_id, array[tstzrange(v.starts_at, v.ends_at), tstzrange(p_starts_at, v_ends)]);
  if p_party <= s.max_online_party then
    v_table := public.pick_online_table(v.restaurant_id, p_party, p_starts_at, v_ends, p_zone_id, v.id);
    if v_table is null then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    end if;
    v_status := case when s.auto_confirm then 'confirmed' else 'pending' end;
  else
    v_status := 'pending';
  end if;
  begin
    -- Primero se sueltan las mesas: si no, el trigger las movería a la hora nueva y podrían chocar.
    delete from public.reservation_tables rt where rt.reservation_id = v.id and rt.restaurant_id = v.restaurant_id;
    update public.reservations
       set starts_at = p_starts_at, ends_at = v_ends, party_size = p_party, status = v_status,
           previous_status = case when v_status <> v.status then null else previous_status end,
           status_changed_at = case when v_status <> v.status then now() else status_changed_at end
     where id = v.id;
    if v_table is not null then
      insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values (v.id, v_table, v.restaurant_id);
    end if;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('status', v_status,
                            'table_ids', case when v_table is null then '[]'::jsonb else jsonb_build_array(v_table) end);
end $$;

/** El comensal cancela: solo en pendiente o confirmada y antes del límite (si no, CHANGE_CLOSED). */
create or replace function public.cancel_public_reservation(p_slug text, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.reservations%rowtype;
  s public.booking_settings;
begin
  perform set_config('mesa.actor', 'customer', true);
  v := public.reservation_by_token(p_slug, p_token_hash, true);
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  s := public.booking_settings_of(v.restaurant_id);
  if not public.customer_can_change(v.status, v.starts_at, s.cancel_limit_hours) then
    raise exception 'CHANGE_CLOSED' using errcode = 'P0001';
  end if;
  update public.reservations
     set status = 'cancelled_customer', previous_status = v.status, status_changed_at = now()
   where id = v.id;
end $$;

-- Panel: nuevas versiones (los parámetros nuevos van al final y con valor por defecto, así el código del 4A sigue
-- funcionando entre la migración y el despliegue) ---------------------------------------------------------------
drop function public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text);
drop function public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text);

/**
 * Reserva del panel (por teléfono): nace confirmada. Mesas: p_force → sin mesa; sin p_table_ids → la propuesta;
 * con p_table_ids → esas. p_duration_min null → la del tramo. p_id: el id que pone la app (si no, uno nuevo).
 * p_notify_customer: el cliente recibe los emails (exige email, p_id y la huella del enlace).
 * Devuelve {"id": …, "table_ids": […]}.
 */
create or replace function public.create_panel_reservation(
  p_restaurant_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer,
  p_table_ids uuid[], p_force boolean,
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_notes text, p_internal_notes text,
  p_id uuid default null, p_notify_customer boolean default false, p_token_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_duration integer;
  v_ends timestamptz;
  v_tables uuid[];
  v_customer uuid;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_notify boolean := coalesce(p_notify_customer, false);
begin
  perform set_config('mesa.actor', 'staff', true);
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_starts_at is null or p_party_size is null or p_party_size not between 1 and 50
     or (p_duration_min is not null and (p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0))
     or nullif(btrim(p_customer_name), '') is null
     or (nullif(btrim(p_customer_phone), '') is null and nullif(btrim(p_customer_email), '') is null)
     or (v_notify and (p_id is null or nullif(btrim(p_customer_email), '') is null
                       or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$')) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_duration := coalesce(p_duration_min, public.reservation_duration(p_restaurant_id, p_party_size));
  v_ends := p_starts_at + make_interval(mins => v_duration);
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(p_starts_at, v_ends)]);
  v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, p_starts_at, v_ends, p_table_ids, p_force, null, null);
  v_customer := public.upsert_customer(p_restaurant_id, p_customer_name, p_customer_phone, p_customer_email);
  begin
    insert into public.reservations (id, restaurant_id, customer_id, party_size, starts_at, ends_at, status, source,
                                     notes, internal_notes, created_by, notify_customer, manage_token_hash)
    values (v_id, p_restaurant_id, v_customer, p_party_size, p_starts_at, v_ends, 'confirmed', 'phone',
            nullif(btrim(p_notes), ''), nullif(btrim(p_internal_notes), ''), auth.uid(),
            v_notify, case when v_notify then p_token_hash end);
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select v_id, t, p_restaurant_id from unnest(v_tables) t;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'INVALID_INPUT' using errcode = '22023';
  end;
  return jsonb_build_object('id', v_id, 'table_ids', to_jsonb(v_tables));
end $$;

/**
 * Cambia hora, personas, duración, mesas y notas de una reserva activa (igual que en el 4A). p_notify_customer:
 * null = no se toca; true = el cliente recibe los emails (exige email del cliente y, si la reserva aún no tiene
 * enlace, la huella p_token_hash); false = deja de recibirlos.
 */
create or replace function public.update_panel_reservation(
  p_restaurant_id uuid, p_reservation_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer,
  p_table_ids uuid[], p_force boolean, p_notes text, p_internal_notes text,
  p_notify_customer boolean default null, p_token_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations%rowtype;
  v_ends timestamptz;
  v_current uuid[];
  v_tables uuid[];
  v_token text;
begin
  perform set_config('mesa.actor', 'staff', true);
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_starts_at is null or p_party_size is null or p_party_size not between 1 and 50 or p_duration_min is null
     or p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into r from public.reservations x where x.id = p_reservation_id and x.restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'confirmed', 'seated') then
    raise exception 'RESERVATION_CLOSED' using errcode = 'P0001';
  end if;
  v_token := r.manage_token_hash;
  if p_notify_customer then
    if r.source = 'walk_in' or not exists (
      select 1 from public.customers c where c.id = r.customer_id and c.restaurant_id = p_restaurant_id and c.email is not null
    ) then
      raise exception 'NO_CUSTOMER_EMAIL' using errcode = 'P0001';
    end if;
    v_token := coalesce(v_token, case when p_token_hash ~ '^[0-9a-f]{64}$' then p_token_hash end);
    if v_token is null then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;
  end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  v_current := array(select rt.table_id from public.reservation_tables rt
                      where rt.reservation_id = r.id and rt.restaurant_id = p_restaurant_id order by rt.table_id);
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(r.starts_at, r.ends_at), tstzrange(p_starts_at, v_ends)]);
  -- Mismas mesas y misma hora (p. ej., solo cambian las notas): no se vuelve a mirar si están libres o bloqueadas.
  if not coalesce(p_force, false) and cardinality(v_current) > 0 and p_table_ids is not null
     and array(select distinct x from unnest(p_table_ids) x order by x) = v_current
     and p_starts_at = r.starts_at and v_ends = r.ends_at then
    v_tables := v_current;
    if (select coalesce(sum(t.max_capacity), 0) from public.tables t
         where t.id = any (v_current) and t.restaurant_id = p_restaurant_id) < p_party_size then
      raise exception 'TABLE_TOO_SMALL' using errcode = 'P0001';
    end if;
  elsif not coalesce(p_force, false) and p_table_ids is not null and cardinality(p_table_ids) = 0 and cardinality(v_current) = 0 then
    -- Array vacío explícito en una reserva que ya no tiene mesa (p. ej., editar una forzada sin mesa): sigue sin mesa.
    v_tables := '{}';
  else
    v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, p_starts_at, v_ends, p_table_ids, p_force,
                                                  r.id, v_current);
  end if;
  begin
    -- Primero se sueltan las mesas que se van: si no, el trigger las movería a la hora nueva y chocarían con otras.
    delete from public.reservation_tables rt where rt.reservation_id = r.id and not (rt.table_id = any (v_tables));
    update public.reservations
       set starts_at = p_starts_at, ends_at = v_ends, party_size = p_party_size,
           notes = nullif(btrim(p_notes), ''), internal_notes = nullif(btrim(p_internal_notes), ''),
           notify_customer = coalesce(p_notify_customer, notify_customer),
           manage_token_hash = v_token
     where id = r.id;
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select r.id, t, p_restaurant_id from unnest(v_tables) t
     where not (t = any (v_current));
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'INVALID_INPUT' using errcode = '22023';
  end;
  return jsonb_build_object('id', r.id, 'table_ids', to_jsonb(v_tables));
end $$;

-- Privilegios -----------------------------------------------------------------------------------------------------
revoke execute on function public.reservation_by_token(text, text, boolean),
  public.customer_can_change(public.reservation_status, timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_public_reservation(text, text),
  public.modify_public_reservation(text, text, integer, timestamptz, uuid),
  public.cancel_public_reservation(text, text)
  from public, anon, authenticated;
grant execute on function public.get_public_reservation(text, text),
  public.modify_public_reservation(text, text, integer, timestamptz, uuid),
  public.cancel_public_reservation(text, text)
  to service_role;
revoke execute on function
  public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text, uuid, boolean, text),
  public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text, boolean, text)
  from public, anon;
grant execute on function
  public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text, uuid, boolean, text),
  public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text, boolean, text)
  to authenticated;
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:db tests/db/booking-manage.test.ts tests/db/reservations.test.ts tests/db/reservations-functions.test.ts tests/db/reservations-concurrency.test.ts`
Expected: PASS: `booking-manage.test.ts` (14 pruebas) y las del 4A sin cambios (las llamadas de 11 y 9 argumentos siguen valiendo por los valores por defecto).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261128000300_reserva_enlace_panel.sql tests/db/booking-manage.test.ts tests/db/reservations.test.ts
git commit -m "BD: enlace del comensal (ver, modificar y cancelar) y funciones del panel con aviso por email"
```

---

### Task 4: Migración 4: cola de emails (reclamar, terminar, descartar, reintentar, datos) y tarea horaria con pg_cron

**Files:**
- Create: `supabase/migrations/20261128000400_emails_tareas.sql`
- Create (prueba): `tests/db/booking-jobs.test.ts`

**Interfaces:**
- Consumes: Tareas 1–3 (`email_outbox`, `rate_limits`, `booking_settings_of`, el trigger de encolado); del 4A, el trigger `update_customer_counters` (cuenta la visita al pasar a `completed`).
- Produces:
  - Solo `service_role`: `public.claim_outbox(p_limit integer) → setof public.email_outbox` (marca `sending`, gasta un intento y deja `next_attempt_at = now() + 10 min` como plazo; recupera los que se quedaron enviando; con 3 intentos, `failed`), `public.finish_outbox(p_id uuid, p_ok boolean, p_provider_id text, p_error text) → void` (+15 min, +1 h, `failed`), `public.skip_outbox(p_id uuid, p_reason text) → void` y `public.outbox_email_data(p_id uuid) → jsonb {kind, to, skip, reservation{…, manage_token_hash}, customer, restaurant{…, notification_email}, zone_name, cancel_limit_hours}` (motivos de `skip`: `RESTAURANT_NOT_ACTIVE`, `NO_RECIPIENT`, `NOT_CONFIRMED`).
  - Panel (authenticated): `public.retry_outbox(p_restaurant_id uuid, p_id uuid) → void` (`FORBIDDEN`, `NOT_RETRYABLE`).
  - `public.run_hourly_jobs() → jsonb {reminders, completed, purged, called}` (nadie salvo su dueño; la ejecuta pg_cron) y el job `mesa-hourly` (`7 * * * *`) solo si hay `pg_cron` y `pg_net`.

Lee antes la sección «Tarea horaria» de las decisiones (29) y `tests/db/booking-online.test.ts` (cómo se anota la cola).

En la BD de pruebas no existen `pg_cron`, `pg_net` ni Vault: la migración no crea el job y `run_hourly_jobs()` no llama a nadie (`called: false`). La prueba crea esquemas `net` y `vault` falsos **dentro de su transacción** para probar la llamada. PL/pgSQL solo resuelve `net.http_post` y `vault.decrypted_secrets` al ejecutar esa rama, así que la función se crea sin ellos.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `tests/db/booking-jobs.test.ts`:

````ts
import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asServiceRole,
  asSuperuser,
  bookableRestaurant,
  createUser,
  expectDbError,
  fakeTokenHash,
  insertCustomer,
  insertReservation,
  outboxKinds,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

type Row = { id: string; kind: string; status: string; attempts: number; last_error: string | null; provider_id: string | null; next_attempt_at: Date };

/** «cola» con una reserva online confirmada de Ana (que ya deja un customer_confirmed pendiente en la cola). */
async function setup(c: pg.PoolClient) {
  const a = await bookableRestaurant(c, 'cola');
  const b = await bookableRestaurant(c, 'otra-cola');
  const customerId = await insertCustomer(c, a, { name: 'Ana', email: 'ana@example.com' });
  const reservationId = await insertReservation(c, a, {
    startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    source: 'online',
    customerId,
    notifyCustomer: true,
    tokenHash: fakeTokenHash(1),
  });
  const outboxId = (await c.query('select id from public.email_outbox where reservation_id = $1', [reservationId])).rows[0].id as string;
  return { a, b, customerId, reservationId, outboxId };
}

async function row(c: pg.PoolClient, id: string): Promise<Row> {
  await asSuperuser(c);
  return (await c.query('select id, kind::text, status::text, attempts, last_error, provider_id, next_attempt_at from public.email_outbox where id = $1', [id])).rows[0];
}

async function service<T>(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<T[]> {
  await asServiceRole(c);
  const { rows } = await c.query(sql, params);
  await asSuperuser(c);
  return rows as T[];
}

const claim = (c: pg.PoolClient, limit = 10) => service<{ id: string; attempts: number }>(c, 'select * from public.claim_outbox($1)', [limit]);
const finish = (c: pg.PoolClient, id: string, ok: boolean, provider: string | null, error: string | null) =>
  service(c, 'select public.finish_outbox($1, $2, $3, $4)', [id, ok, provider, error]);
const minutesFromNow = (d: Date) => Math.round((d.getTime() - Date.now()) / 60_000);

describe('privilegios', () => {
  it('la cola: solo service_role; reintentar: el panel; la tarea horaria: nadie (la ejecuta pg_cron)', () =>
    tx(async (c) => {
      const expectations: [string, Record<string, boolean>][] = [
        ['public.claim_outbox(integer)', { anon: false, authenticated: false, service_role: true }],
        ['public.finish_outbox(uuid, boolean, text, text)', { anon: false, authenticated: false, service_role: true }],
        ['public.skip_outbox(uuid, text)', { anon: false, authenticated: false, service_role: true }],
        ['public.outbox_email_data(uuid)', { anon: false, authenticated: false, service_role: true }],
        ['public.retry_outbox(uuid, uuid)', { anon: false, authenticated: true, service_role: false }],
        ['public.run_hourly_jobs()', { anon: false, authenticated: false, service_role: false }],
      ];
      for (const [fn, roles] of expectations) {
        for (const [role, ok] of Object.entries(roles)) {
          expect((await c.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0].ok, `${role} ${fn}`).toBe(ok);
        }
      }
    }));
});

describe('claim_outbox y finish_outbox', () => {
  it('reclama los pendientes (gasta un intento) y no los vuelve a dar mientras se envían', () =>
    tx(async (c) => {
      const { outboxId } = await setup(c);
      const first = await claim(c);
      expect(first.map((r) => [r.id, r.attempts])).toEqual([[outboxId, 1]]);
      const r = await row(c, outboxId);
      expect(r.status).toBe('sending');
      expect(minutesFromNow(r.next_attempt_at)).toBe(10);
      expect(await claim(c)).toEqual([]);
    }));

  it('bien: enviado con el id del proveedor', () =>
    tx(async (c) => {
      const { outboxId } = await setup(c);
      await claim(c);
      await finish(c, outboxId, true, 'em_123', null);
      expect(await row(c, outboxId)).toMatchObject({ status: 'sent', provider_id: 'em_123', last_error: null });
      expect((await c.query('select sent_at from public.email_outbox where id = $1', [outboxId])).rows[0].sent_at).not.toBeNull();
    }));

  it('mal: reintenta a los 15 min, luego a la hora, y al tercer fallo queda fallido', () =>
    tx(async (c) => {
      const { outboxId } = await setup(c);
      const again = async () => {
        await c.query("update public.email_outbox set next_attempt_at = now() - interval '1 minute' where id = $1", [outboxId]);
        expect((await claim(c)).map((r) => r.id)).toEqual([outboxId]);
      };
      await claim(c);
      await finish(c, outboxId, false, null, 'validation_error');
      let r = await row(c, outboxId);
      expect(r).toMatchObject({ status: 'pending', attempts: 1, last_error: 'validation_error' });
      expect(minutesFromNow(r.next_attempt_at)).toBe(15);
      await again();
      await finish(c, outboxId, false, null, null);
      r = await row(c, outboxId);
      expect(r).toMatchObject({ status: 'pending', attempts: 2, last_error: 'SEND_FAILED' });
      expect(minutesFromNow(r.next_attempt_at)).toBe(60);
      await again();
      await finish(c, outboxId, false, null, 'NETWORK');
      expect(await row(c, outboxId)).toMatchObject({ status: 'failed', attempts: 3, last_error: 'NETWORK' });
      expect(await claim(c)).toEqual([]);
    }));

  it('un envío que se quedó a medias más de 10 min se reclama otra vez; con 3 intentos gastados, fallido', () =>
    tx(async (c) => {
      const { outboxId } = await setup(c);
      await claim(c);
      await c.query("update public.email_outbox set next_attempt_at = now() - interval '1 minute' where id = $1", [outboxId]);
      expect((await claim(c)).map((r) => [r.id, r.attempts])).toEqual([[outboxId, 2]]);
      await c.query("update public.email_outbox set attempts = 3, next_attempt_at = now() - interval '1 minute' where id = $1", [outboxId]);
      expect(await claim(c)).toEqual([]);
      expect(await row(c, outboxId)).toMatchObject({ status: 'failed', last_error: 'TIMEOUT' });
    }));

  it('respeta el límite y solo toca filas que se están enviando', () =>
    tx(async (c) => {
      const { a, outboxId } = await setup(c);
      const second = await insertReservation(c, a, {
        startsAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        source: 'online',
        customerId: await insertCustomer(c, a, { name: 'Luis', phone: '+34600000002', email: 'luis@example.com' }),
        notifyCustomer: true,
        tokenHash: fakeTokenHash(2),
      });
      expect(await claim(c, 1)).toHaveLength(1);
      expect(await claim(c, 1)).toHaveLength(1);
      expect(await outboxKinds(c, second)).toEqual(['customer_confirmed']);
      await service(c, 'select public.skip_outbox($1, $2)', [outboxId, 'NOT_CONFIRMED']);
      expect(await row(c, outboxId)).toMatchObject({ status: 'skipped', last_error: 'NOT_CONFIRMED' });
      await finish(c, outboxId, true, 'em_x', null);
      expect((await row(c, outboxId)).status).toBe('skipped');
    }));
});

describe('retry_outbox', () => {
  it('un miembro reintenta un email fallido de su restaurante; nada más', () =>
    tx(async (c) => {
      const { a, b, outboxId } = await setup(c);
      const staff = await createUser(c, 'sala@example.com');
      const other = await createUser(c, 'otro@example.com');
      await addMember(c, a, staff.id, 'staff');
      await addMember(c, b, other.id, 'admin');
      await as(c, staff);
      await expectDbError(c, 'select public.retry_outbox($1, $2)', [a, outboxId], /NOT_RETRYABLE/);
      await asSuperuser(c);
      await c.query("update public.email_outbox set status = 'failed', attempts = 3, last_error = 'NETWORK' where id = $1", [outboxId]);
      await as(c, other);
      await expectDbError(c, 'select public.retry_outbox($1, $2)', [a, outboxId], /FORBIDDEN/);
      await expectDbError(c, 'select public.retry_outbox($1, $2)', [b, outboxId], /NOT_RETRYABLE/);
      await as(c, staff);
      await c.query('select public.retry_outbox($1, $2)', [a, outboxId]);
      expect(await row(c, outboxId)).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
    }));
});

describe('outbox_email_data', () => {
  const data = async (c: pg.PoolClient, id: string) => (await service<{ d: Record<string, unknown> }>(c, 'select public.outbox_email_data($1) as d', [id]))[0].d;

  it('trae los datos actuales y el destinatario de cada tipo', () =>
    tx(async (c) => {
      const { a, reservationId, outboxId } = await setup(c);
      const d = await data(c, outboxId);
      expect(d).toMatchObject({
        kind: 'customer_confirmed',
        to: 'ana@example.com',
        skip: null,
        reservation: { id: reservationId, status: 'confirmed', party_size: 2, locale: 'es', source: 'online', manage_token_hash: fakeTokenHash(1) },
        customer: { name: 'Ana', email: 'ana@example.com', no_show_count: 0 },
        restaurant: { id: a, slug: 'cola', name: 'Rest cola', contact_email: 'hola@cola.es', timezone: 'Europe/Madrid' },
        cancel_limit_hours: 2,
      });
      await c.query("update public.customers set email = 'nuevo@example.com' where email = 'ana@example.com'");
      expect((await data(c, outboxId)).to).toBe('nuevo@example.com');
      await c.query("insert into public.email_outbox (restaurant_id, reservation_id, kind) values ($1, $2, 'restaurant_new')", [a, reservationId]);
      const toRestaurant = (await c.query("select id from public.email_outbox where kind = 'restaurant_new'")).rows[0].id;
      expect((await data(c, toRestaurant)).to).toBe('hola@cola.es');
      await c.query("update public.booking_settings set notification_email = 'avisos@cola.es' where restaurant_id = $1", [a]);
      expect((await data(c, toRestaurant)).to).toBe('avisos@cola.es');
      await c.query('update public.booking_settings set notify_restaurant = false where restaurant_id = $1', [a]);
      expect(await data(c, toRestaurant)).toMatchObject({ to: null, skip: 'NO_RECIPIENT' });
    }));

  it('motivos para no enviar: sin avisos, recordatorio de una que ya no está confirmada, restaurante no activo', () =>
    tx(async (c) => {
      const { a, reservationId, outboxId } = await setup(c);
      await c.query("insert into public.email_outbox (restaurant_id, reservation_id, kind) values ($1, $2, 'customer_reminder')", [a, reservationId]);
      const reminder = (await c.query("select id from public.email_outbox where kind = 'customer_reminder'")).rows[0].id;
      await c.query("update public.reservations set status = 'cancelled_restaurant' where id = $1", [reservationId]);
      expect((await data(c, reminder)).skip).toBe('NOT_CONFIRMED');
      await c.query('update public.reservations set notify_customer = false where id = $1', [reservationId]);
      expect((await data(c, outboxId)).skip).toBe('NO_RECIPIENT');
      await c.query("update public.restaurants set status = 'disabled' where id = $1", [a]);
      expect((await data(c, outboxId)).skip).toBe('RESTAURANT_NOT_ACTIVE');
      expect((await service<{ d: unknown }>(c, 'select public.outbox_email_data($1) as d', [crypto.randomUUID()]))[0].d).toBeNull();
    }));
});

describe('run_hourly_jobs', () => {
  const run = async (c: pg.PoolClient) => {
    await asSuperuser(c);
    return (await c.query('select public.run_hourly_jobs() as r')).rows[0].r;
  };

  async function reservationAt(c: pg.PoolClient, restaurantId: string, n: number, hoursFromNow: number, o: { status?: 'confirmed' | 'pending' | 'seated'; notify?: boolean; createdHoursAgo?: number } = {}) {
    const customerId = await insertCustomer(c, restaurantId, { name: `Cliente ${n}`, phone: `+3460000010${n}`, email: `c${n}@example.com` });
    const id = await insertReservation(c, restaurantId, {
      startsAt: new Date(Date.now() + hoursFromNow * 3_600_000).toISOString(),
      status: o.status ?? 'confirmed',
      source: 'online',
      customerId,
      notifyCustomer: o.notify ?? true,
      tokenHash: fakeTokenHash(100 + n),
    });
    await c.query("update public.reservations set created_at = now() - make_interval(hours => $2) where id = $1", [id, o.createdHoursAgo ?? 48]);
    return { id, customerId };
  }

  it('recordatorio para las confirmadas de dentro de 23–25 h con avisos, creadas hace más de 6 h; solo uno', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const yes = await reservationAt(c, a, 1, 24);
      const tooSoon = await reservationAt(c, a, 2, 22);
      const tooLate = await reservationAt(c, a, 3, 26);
      const fresh = await reservationAt(c, a, 4, 24, { createdHoursAgo: 2 });
      const quiet = await reservationAt(c, a, 5, 24, { notify: false });
      const pending = await reservationAt(c, a, 6, 24, { status: 'pending' });
      expect(await run(c)).toMatchObject({ reminders: 1, called: false });
      expect(await outboxKinds(c, yes.id)).toEqual(['customer_confirmed', 'customer_reminder']);
      for (const other of [tooSoon, tooLate, fresh, quiet, pending]) {
        expect(await outboxKinds(c, other.id)).not.toContain('customer_reminder');
      }
      expect(await run(c)).toMatchObject({ reminders: 0 });
    }));

  it('cierra las «en mesa» 2 h después de acabar (actor del sistema: sin emails) y cuenta la visita', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const old = await reservationAt(c, a, 1, -5, { status: 'seated' });
      const recent = await reservationAt(c, a, 2, -2, { status: 'seated' });
      expect(await run(c)).toMatchObject({ completed: 1 });
      expect((await c.query('select status, previous_status from public.reservations where id = $1', [old.id])).rows[0]).toEqual({
        status: 'completed',
        previous_status: 'seated',
      });
      expect((await c.query('select status from public.reservations where id = $1', [recent.id])).rows[0].status).toBe('seated');
      expect((await c.query('select visits_count from public.customers where id = $1', [old.customerId])).rows[0].visits_count).toBe(1);
      expect(await outboxKinds(c, old.id)).toEqual([]);
    }));

  it('borra los intentos de más de un día', () =>
    tx(async (c) => {
      await c.query("insert into public.rate_limits (key, window_start, hits) values ('vieja', now() - interval '2 days', 3), ('nueva', now(), 1)");
      expect(await run(c)).toMatchObject({ purged: 1 });
      expect((await c.query('select key from public.rate_limits')).rows).toEqual([{ key: 'nueva' }]);
    }));

  it('con pg_net y los secretos de Vault avisa a la app; sin secretos, no', () =>
    tx(async (c) => {
      await c.query('create schema net');
      await c.query('create table net.calls (url text, body jsonb, headers jsonb, timeout_milliseconds integer)');
      await c.query(`create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 2000)
                     returns bigint language sql as $$ insert into net.calls values (url, body, headers, timeout_milliseconds) returning 1::bigint $$`);
      await c.query('create schema vault');
      await c.query('create table vault.decrypted_secrets (name text, decrypted_secret text)');
      expect(await run(c)).toMatchObject({ called: false });
      await c.query("insert into vault.decrypted_secrets values ('mesa_site_url', 'https://mesa.example.com/'), ('mesa_cron_secret', 's3cr3t')");
      expect(await run(c)).toMatchObject({ called: true });
      expect((await c.query('select * from net.calls')).rows).toEqual([
        {
          url: 'https://mesa.example.com/api/cron/hourly',
          body: {},
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer s3cr3t' },
          timeout_milliseconds: 30000,
        },
      ]);
    }));

  it('en la BD de pruebas no hay pg_cron: la migración no crea el job', () =>
    tx(async (c) => {
      expect((await c.query("select to_regnamespace('cron') as s")).rows[0].s).toBeNull();
    }));
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:db tests/db/booking-jobs.test.ts`
Expected: FAIL: `function public.claim_outbox(integer) does not exist`.

- [ ] **Step 3: Implementa**

Crea `supabase/migrations/20261128000400_emails_tareas.sql`:

````sql
-- Mesa · Hito 4B · cola de emails (reclamar, terminar, descartar, reintentar y datos para pintar cada email) y la tarea
-- horaria (recordatorios, cierre automático, limpieza y aviso a la app con pg_net). La cola la vacía la app con la
-- clave de servicio; reintentar es del panel.

/**
 * Reclama hasta p_limit emails para enviarlos: los pendientes que tocan y los que se quedaron «enviando» más de
 * 10 minutos (la app se cayó a medias). Cada reclamación gasta un intento; los que ya gastaron los 3, fallidos.
 */
create or replace function public.claim_outbox(p_limit integer) returns setof public.email_outbox
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.email_outbox o
     set status = 'failed', last_error = coalesce(o.last_error, 'TIMEOUT')
   where o.status = 'sending' and o.next_attempt_at <= now() and o.attempts >= 3;
  return query
    update public.email_outbox o
       set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now() + interval '10 minutes'
     where o.id in (
       select x.id from public.email_outbox x
        where x.status in ('pending', 'sending') and x.next_attempt_at <= now() and x.attempts < 3
        order by x.next_attempt_at, x.created_at
        limit least(greatest(coalesce(p_limit, 20), 1), 100)
        for update skip locked)
    returning o.*;
end $$;

/**
 * Resultado de un envío reclamado. Bien: «sent». Mal: vuelve a «pending» a los 15 minutos (tras el primer intento) o a
 * la hora (tras el segundo); al tercer fallo, «failed». p_error: un código corto, sin datos personales.
 */
create or replace function public.finish_outbox(p_id uuid, p_ok boolean, p_provider_id text, p_error text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.email_outbox o
     set status = case when p_ok then 'sent' when o.attempts >= 3 then 'failed' else 'pending' end::public.email_status,
         sent_at = case when p_ok then now() end,
         provider_id = case when p_ok then left(p_provider_id, 200) end,
         last_error = case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'SEND_FAILED'), 200) end,
         next_attempt_at = case
           when p_ok or o.attempts >= 3 then o.next_attempt_at
           when o.attempts = 1 then now() + interval '15 minutes'
           else now() + interval '1 hour' end
   where o.id = p_id and o.status = 'sending';
end $$;

/** Un email que ya no toca (p. ej., el recordatorio de una reserva que ya no está confirmada): «skipped». */
create or replace function public.skip_outbox(p_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.email_outbox o
     set status = 'skipped', last_error = left(coalesce(nullif(btrim(p_reason), ''), 'SKIPPED'), 200)
   where o.id = p_id and o.status = 'sending';
end $$;

/** Botón «Reintentar» del panel: un email fallido vuelve a la cola con sus 3 intentos. */
create or replace function public.retry_outbox(p_restaurant_id uuid, p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.email_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
   where o.id = p_id and o.restaurant_id = p_restaurant_id and o.status = 'failed';
  if not found then
    raise exception 'NOT_RETRYABLE' using errcode = 'P0001';
  end if;
end $$;

/**
 * Lo que hace falta para pintar y enviar un email de la cola, con los datos actuales: reserva, cliente, restaurante,
 * zona, ajustes, destinatario ("to") y, si ya no toca enviarlo, el motivo ("skip"). null si la fila no existe.
 */
create or replace function public.outbox_email_data(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  o public.email_outbox%rowtype;
  v public.reservations%rowtype;
  r public.restaurants%rowtype;
  c public.customers%rowtype;
  s public.booking_settings;
  v_customer_kind boolean;
  v_to text;
  v_skip text;
begin
  select * into o from public.email_outbox x where x.id = p_id;
  if not found then
    return null;
  end if;
  select * into v from public.reservations x where x.id = o.reservation_id and x.restaurant_id = o.restaurant_id;
  select * into r from public.restaurants x where x.id = o.restaurant_id;
  select * into c from public.customers x where x.id = v.customer_id and x.restaurant_id = v.restaurant_id;
  s := public.booking_settings_of(o.restaurant_id);
  v_customer_kind := o.kind::text like 'customer\_%';
  if v_customer_kind then
    v_to := case when v.notify_customer and c.anonymized_at is null then c.email end;
  else
    v_to := case when s.notify_restaurant then coalesce(s.notification_email, r.contact_email) end;
  end if;
  v_skip := case
    when r.status <> 'active' then 'RESTAURANT_NOT_ACTIVE'
    when v_to is null then 'NO_RECIPIENT'
    when o.kind = 'customer_reminder' and v.status <> 'confirmed' then 'NOT_CONFIRMED'
  end;
  return jsonb_build_object(
    'kind', o.kind,
    'to', v_to,
    'skip', v_skip,
    'reservation', jsonb_build_object(
      'id', v.id, 'status', v.status, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'party_size', v.party_size,
      'notes', v.notes, 'locale', v.locale, 'source', v.source, 'updated_at', v.updated_at,
      'manage_token_hash', v.manage_token_hash),
    'customer', case when c.id is null then null else jsonb_build_object(
      'name', c.name, 'email', c.email, 'phone', c.phone, 'tags', to_jsonb(c.tags),
      'visits_count', c.visits_count, 'no_show_count', c.no_show_count, 'cancel_count', c.cancel_count) end,
    'restaurant', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'name', r.name, 'timezone', r.timezone, 'accent_color', r.accent_color,
      'logo_path', r.logo_path, 'address_line', r.address_line, 'postal_code', r.postal_code, 'city', r.city,
      'phone', r.phone, 'contact_email', r.contact_email, 'notification_email', s.notification_email),
    'zone_name', (
      select z.name
        from public.reservation_tables rt
        join public.tables t on t.id = rt.table_id and t.restaurant_id = rt.restaurant_id
        join public.zones z on z.id = t.zone_id and z.restaurant_id = t.restaurant_id
       where rt.reservation_id = v.id and rt.restaurant_id = v.restaurant_id
       order by z.position, t.position, t.name collate "C"
       limit 1),
    'cancel_limit_hours', s.cancel_limit_hours
  );
end $$;

/**
 * Tarea horaria (pg_cron, actor «system»): recordatorios de las confirmadas que empiezan dentro de 23–25 h (creadas
 * hace más de 6 h, con avisos y email), cierre automático de las «en mesa» 2 h después de acabar (cuenta como visita),
 * limpieza del límite de intentos y aviso a la app para que vacíe la cola. Sin pg_net o sin los secretos de Vault
 * (p. ej., en la BD de pruebas) no llama a nadie. Devuelve lo que ha hecho.
 */
create or replace function public.run_hourly_jobs() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reminders integer;
  v_completed integer;
  v_purged integer;
  v_called boolean := false;
  v_site text;
  v_secret text;
begin
  perform set_config('mesa.actor', 'system', true);
  insert into public.email_outbox (restaurant_id, reservation_id, kind)
  select x.restaurant_id, x.id, 'customer_reminder'
    from public.reservations x
    join public.restaurants r on r.id = x.restaurant_id and r.status = 'active'
    join public.customers c on c.id = x.customer_id and c.restaurant_id = x.restaurant_id and c.email is not null
   where x.status = 'confirmed' and x.notify_customer
     and x.starts_at between now() + interval '23 hours' and now() + interval '25 hours'
     and x.created_at < now() - interval '6 hours'
  on conflict do nothing;
  get diagnostics v_reminders = row_count;

  update public.reservations x
     set status = 'completed', previous_status = 'seated', status_changed_at = now()
   where x.status = 'seated' and x.ends_at < now() - interval '2 hours';
  get diagnostics v_completed = row_count;

  delete from public.rate_limits l where l.window_start < now() - interval '1 day';
  get diagnostics v_purged = row_count;

  if to_regnamespace('net') is not null and to_regclass('vault.decrypted_secrets') is not null then
    select d.decrypted_secret into v_site from vault.decrypted_secrets d where d.name = 'mesa_site_url';
    select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.name = 'mesa_cron_secret';
    if v_site is not null and v_secret is not null then
      perform net.http_post(
        url := rtrim(v_site, '/') || '/api/cron/hourly',
        body := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
        timeout_milliseconds := 30000);
      v_called := true;
    end if;
  end if;

  return jsonb_build_object('reminders', v_reminders, 'completed', v_completed, 'purged', v_purged, 'called', v_called);
end $$;

-- Privilegios: la cola, solo service_role (la app); reintentar, el panel; la tarea horaria la ejecuta pg_cron como
-- dueño de la función.
revoke execute on function public.claim_outbox(integer), public.finish_outbox(uuid, boolean, text, text),
  public.skip_outbox(uuid, text), public.outbox_email_data(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_outbox(integer), public.finish_outbox(uuid, boolean, text, text),
  public.skip_outbox(uuid, text), public.outbox_email_data(uuid)
  to service_role;
revoke execute on function public.retry_outbox(uuid, uuid) from public, anon, service_role;
grant execute on function public.retry_outbox(uuid, uuid) to authenticated;
revoke execute on function public.run_hourly_jobs() from public, anon, authenticated, service_role;

-- Tarea horaria: solo si el servidor tiene pg_cron y pg_net (Supabase sí; la BD de pruebas no). Los secretos de Vault
-- (mesa_site_url, mesa_cron_secret) se crean al publicar. cron.schedule con el mismo nombre sustituye el job.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('mesa-hourly', '7 * * * *', 'select public.run_hourly_jobs()');
  end if;
end $$;
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:db tests/db/booking-jobs.test.ts`
Expected: PASS: 14 pruebas (incluida la llamada a la app con un `net.http_post` y un `vault.decrypted_secrets` falsos creados dentro de la transacción de la prueba).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261128000400_emails_tareas.sql tests/db/booking-jobs.test.ts
git commit -m "BD: cola de emails y tarea horaria (recordatorios, cierre automático, limpieza y aviso a la app)"
```

---

### Task 5: Concurrencia: dos altas online a la vez en la última mesa online

**Files:**
- Create (prueba): `tests/db/booking-concurrency.test.ts`

**Interfaces:**
- Consumes: Tarea 2: `public.create_public_reservation(...)`, ejecutada como `service_role`; `fakeTokenHash`.
- Produces:
  La prueba `tests/db/booking-concurrency.test.ts` (restaurante `concurrencia-4b`, borrado al acabar).

Lee antes `tests/db/reservations-concurrency.test.ts` (mismo patrón del 4A: datos confirmados de verdad y limpieza al final).

- [ ] **Step 1: Escribe la prueba**

Crea `tests/db/booking-concurrency.test.ts`:

````ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import type pg from 'pg';
import { fakeTokenHash, pool } from './helpers';

// Aquí los datos se confirman de verdad (commit): cada conexión solo ve lo que la otra ya ha confirmado.
// Al acabar se borra el restaurante (en cascada).
const CREATE = "select public.create_public_reservation('concurrencia-4b', $1, $2, 2, $3, null, $4, $5, $6, null, 'es', false) as r";
let restaurantId = '';
let startsAt = '';

beforeAll(async () => {
  const c = await pool.connect();
  try {
    restaurantId = (await c.query("insert into public.restaurants (name, slug, status) values ('Concurrencia 4B', 'concurrencia-4b', 'active') returning id")).rows[0].id;
    await c.query(
      `update public.restaurants set address_line = 'Calle Mayor 1', postal_code = '28013', city = 'Madrid', phone = '910000000',
              contact_email = 'hola@concurrencia.es', legal_name = 'Taberna Pepe SL', tax_id = 'B12345674' where id = $1`,
      [restaurantId],
    );
    for (let weekday = 1; weekday <= 7; weekday++) {
      await c.query("insert into public.services (restaurant_id, name, weekday, start_minute, end_minute) values ($1, 'Cena', $2, 1200, 1410)", [restaurantId, weekday]);
    }
    await c.query('insert into public.booking_settings (restaurant_id, min_advance_min) values ($1, 0)', [restaurantId]);
    const zone = (await c.query("insert into public.zones (restaurant_id, name) values ($1, 'Sala') returning id", [restaurantId])).rows[0].id;
    // La última mesa online: la otra no se reserva online.
    await c.query("insert into public.tables (restaurant_id, zone_id, name, max_capacity) values ($1, $2, 'T1', 2)", [restaurantId, zone]);
    await c.query("insert into public.tables (restaurant_id, zone_id, name, max_capacity, online_bookable) values ($1, $2, 'T2', 4, false)", [restaurantId, zone]);
    startsAt = (
      await c.query("select (((now() at time zone 'Europe/Madrid')::date + 3)::timestamp + interval '21 hours') at time zone 'Europe/Madrid' as t")
    ).rows[0].t.toISOString();
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await pool.query('delete from public.restaurants where id = $1', [restaurantId]);
  await pool.end();
});

/** Una conexión con su transacción abierta, como la app con la clave de servicio. */
async function session(): Promise<pg.PoolClient> {
  const c = await pool.connect();
  await c.query('begin');
  await c.query('set local role service_role');
  return c;
}

async function close(...clients: pg.PoolClient[]) {
  for (const c of clients) {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

it('dos altas online a la vez en la última mesa online: la segunda espera al bloqueo y da SLOT_TAKEN', async () => {
  const one = await session();
  const two = await session();
  try {
    const first = (await one.query(CREATE, [crypto.randomUUID(), fakeTokenHash(1), startsAt, 'Primera', 'primera@example.com', '+34600000001'])).rows[0].r;
    let settled = false;
    const second = two
      .query(CREATE, [crypto.randomUUID(), fakeTokenHash(2), startsAt, 'Segunda', 'segunda@example.com', '+34600000002'])
      .then(
        () => ({ ok: true as const }),
        (e: Error) => ({ ok: false as const, message: e.message }),
      )
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const waited = !settled;
    await one.query('commit');
    const result = await second;
    await two.query(result.ok ? 'commit' : 'rollback');
    expect(first.status).toBe('confirmed');
    expect(waited).toBe(true);
    expect(result).toEqual({ ok: false, message: 'SLOT_TAKEN' });
  } finally {
    await close(one, two);
  }
  const { rows } = await pool.query('select count(*)::int as n from public.reservations where restaurant_id = $1', [restaurantId]);
  expect(rows[0].n).toBe(1);
});
````

- [ ] **Step 2: Comprueba**

Run: `pnpm test:db tests/db/booking-concurrency.test.ts`
Expected: PASS: 1 prueba — la segunda conexión espera al advisory lock y recibe `SLOT_TAKEN`; queda una sola reserva. (Si diera `BOOKING_CLOSED`, el restaurante de la prueba no se ha creado `active` con sus datos publicados.)

- [ ] **Step 3: Commit**

```bash
git add tests/db/booking-concurrency.test.ts
git commit -m "Pruebas: dos altas online a la vez en la última mesa online"
```

---

### Task 6: App: ajustes nuevos, origen «Online» y variables de entorno del 4B

**Files:**
- Modify: `src/lib/reservations/settings.ts`
- Modify: `src/lib/reservations/rows.ts`
- Modify: `src/lib/reservations/rows.test.ts`
- Modify: `src/lib/reservations/codes.ts`
- Create (prueba): `src/lib/reservations/codes.test.ts`
- Modify: `src/lib/reservations/data.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Tarea 1 (columnas `online_enabled`, `notify_restaurant`, `notification_email`).
- Produces:
  - `BookingSettings` gana `onlineEnabled: boolean`, `notifyRestaurant: boolean`, `notificationEmail: string | null` (y `DEFAULT_BOOKING_SETTINGS`, `SettingsRow`, `toBookingSettings`, el `select` de `loadBookingConfig`).
  - `SOURCE_LABELS_ES.online = 'Online'`.
  - En `src/lib/env.ts` (se leen al usarlas; el build no las necesita): `TURNSTILE_TEST_SITE_KEY`, `TURNSTILE_TEST_SECRET_KEY`, `manageTokenSecret() → string` (≥ 32; obligatoria en producción; fija en desarrollo), `cronSecret() → string | null`, `turnstileKeys() → { siteKey, secretKey } | null` (de prueba fuera de producción), `reservationsFromAddress() → string` (por defecto `reservas@fbytesolutions.com`).
  - `.env.example` con las cinco variables nuevas, sin valores reales.

Lee antes `src/lib/env.ts`, `src/lib/reservations/settings.ts`, `src/lib/reservations/rows.ts` y `src/lib/reservations/data.ts`.

- [ ] **Step 1: Escribe las pruebas que fallan**

En `src/lib/reservations/rows.test.ts`, sustituye:

````ts
        auto_confirm: false,
      }),
````

por:

````ts
        auto_confirm: false,
        online_enabled: false,
        notify_restaurant: true,
        notification_email: 'avisos@lataberna.es',
      }),
````

En `src/lib/reservations/rows.test.ts`, sustituye:

````ts
      autoConfirm: false,
    });
````

por:

````ts
      autoConfirm: false,
      onlineEnabled: false,
      notifyRestaurant: true,
      notificationEmail: 'avisos@lataberna.es',
    });
````

Crea `src/lib/reservations/codes.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { SOURCE_LABELS_ES } from './codes';

describe('etiquetas de origen', () => {
  it('online es «Online» (como en la vista del día)', () => {
    expect(SOURCE_LABELS_ES).toEqual({ online: 'Online', phone: 'Teléfono', walk_in: 'Walk-in' });
  });
});
````

En `src/lib/env.test.ts`, sustituye:

````ts
  expect(emailConfigured()).toBe(true);
});
````

por:

````ts
  expect(emailConfigured()).toBe(true);
});

describe('variables del Hito 4B (se leen al usarlas)', () => {
  it('MANAGE_TOKEN_SECRET: obligatoria en producción; en desarrollo hay una fija; corta, error', async () => {
    const { manageTokenSecret } = await import('./env');
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MANAGE_TOKEN_SECRET', '');
    expect(manageTokenSecret().length).toBeGreaterThanOrEqual(32);
    vi.stubEnv('MANAGE_TOKEN_SECRET', 'corta');
    expect(() => manageTokenSecret()).toThrow(/MANAGE_TOKEN_SECRET/);
    vi.stubEnv('MANAGE_TOKEN_SECRET', 'x'.repeat(32));
    expect(manageTokenSecret()).toBe('x'.repeat(32));
    vi.stubEnv('MANAGE_TOKEN_SECRET', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => manageTokenSecret()).toThrow(/MANAGE_TOKEN_SECRET/);
  });

  it('CRON_SECRET: null si falta o es corta', async () => {
    const { cronSecret } = await import('./env');
    vi.stubEnv('CRON_SECRET', '');
    expect(cronSecret()).toBeNull();
    vi.stubEnv('CRON_SECRET', 'corta');
    expect(cronSecret()).toBeNull();
    vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
    expect(cronSecret()).toBe('c'.repeat(40));
  });

  it('Turnstile: las del entorno; si faltan, las de prueba en desarrollo y ninguna en producción', async () => {
    const { turnstileKeys, TURNSTILE_TEST_SECRET_KEY, TURNSTILE_TEST_SITE_KEY } = await import('./env');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(turnstileKeys()).toEqual({ siteKey: TURNSTILE_TEST_SITE_KEY, secretKey: TURNSTILE_TEST_SECRET_KEY });
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(turnstileKeys()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '0x4AAA');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '0x4BBB');
    expect(turnstileKeys()).toEqual({ siteKey: '0x4AAA', secretKey: '0x4BBB' });
  });

  it('RESERVATIONS_FROM_ADDRESS: por defecto reservas@fbytesolutions.com; si no es un email, error', async () => {
    const { reservationsFromAddress } = await import('./env');
    vi.stubEnv('RESERVATIONS_FROM_ADDRESS', '');
    expect(reservationsFromAddress()).toBe('reservas@fbytesolutions.com');
    vi.stubEnv('RESERVATIONS_FROM_ADDRESS', 'reservas@mesa.example.com');
    expect(reservationsFromAddress()).toBe('reservas@mesa.example.com');
    vi.stubEnv('RESERVATIONS_FROM_ADDRESS', 'Mesa <x>');
    expect(() => reservationsFromAddress()).toThrow(/RESERVATIONS_FROM_ADDRESS/);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/reservations src/lib/env.test.ts`
Expected: FAIL: en `rows.test.ts`, `expected {…} to deeply equal {…}` (faltan los campos nuevos); en `env.test.ts`, `manageTokenSecret is not a function`; en `codes.test.ts`, `online: "Web"`.

- [ ] **Step 3: Implementa**

En `src/lib/reservations/settings.ts`, sustituye:

````ts
  autoConfirm: boolean;
};
````

por:

````ts
  autoConfirm: boolean;
  /** Hito 4B: reserva desde la web, avisos al restaurante y su email (null = el email del local). */
  onlineEnabled: boolean;
  notifyRestaurant: boolean;
  notificationEmail: string | null;
};
````

En `src/lib/reservations/settings.ts`, sustituye:

````ts
  autoConfirm: true,
};
````

por:

````ts
  autoConfirm: true,
  onlineEnabled: true,
  notifyRestaurant: true,
  notificationEmail: null,
};
````

En `src/lib/reservations/rows.ts`, sustituye:

````ts
  auto_confirm: boolean;
};
````

por:

````ts
  auto_confirm: boolean;
  online_enabled: boolean;
  notify_restaurant: boolean;
  notification_email: string | null;
};
````

En `src/lib/reservations/rows.ts`, sustituye:

````ts
    autoConfirm: row.auto_confirm,
  };
````

por:

````ts
    autoConfirm: row.auto_confirm,
    onlineEnabled: row.online_enabled,
    notifyRestaurant: row.notify_restaurant,
    notificationEmail: row.notification_email,
  };
````

En `src/lib/reservations/codes.ts`, sustituye:

````ts
export const SOURCE_LABELS_ES: Record<ReservationSource, string> = {
  online: 'Web',
  phone: 'Teléfono',
````

por:

````ts
export const SOURCE_LABELS_ES: Record<ReservationSource, string> = {
  online: 'Online',
  phone: 'Teléfono',
````

En `src/lib/reservations/data.ts`, sustituye:

````ts
      .from('booking_settings')
      .select('default_duration_min, duration_rules, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm')
      .eq('restaurant_id', restaurantId)
````

por:

````ts
      .from('booking_settings')
      .select(
        'default_duration_min, duration_rules, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm, online_enabled, notify_restaurant, notification_email',
      )
      .eq('restaurant_id', restaurantId)
````

En `src/lib/reservations/data.ts`, sustituye:

````ts
  return count ?? 0;
}
````

por:

````ts
  return count ?? 0;
}

````

En `src/lib/env.ts`, sustituye:

````ts
  return Boolean(process.env.RESEND_API_KEY);
}
````

por:

````ts
  return Boolean(process.env.RESEND_API_KEY);
}

// Hito 4B ------------------------------------------------------------------------------------------------------
// Se leen al usarlas (nunca en el build): así `pnpm build` no necesita ningún secreto.

/** Solo para desarrollo y pruebas: en producción falta la variable y se avisa. */
const DEV_MANAGE_TOKEN_SECRET = 'solo-desarrollo-no-usar-en-produccion-0123456789';

/** Claves de prueba oficiales de Cloudflare Turnstile: siempre aprueban. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

/**
 * Secreto de los enlaces de los comensales (HMAC). Al menos 32 caracteres. En producción es obligatorio; en
 * desarrollo, si falta, se usa uno fijo. Cambiarlo invalida todos los enlaces enviados.
 */
export function manageTokenSecret(): string {
  const value = process.env.MANAGE_TOKEN_SECRET ?? '';
  if (value.length >= 32) return value;
  if (isProductionDeploy() || value !== '') {
    throw new Error('Falta MANAGE_TOKEN_SECRET (o tiene menos de 32 caracteres). Revisa .env.example.');
  }
  return DEV_MANAGE_TOKEN_SECRET;
}

/** Clave con la que pg_cron llama a /api/cron/hourly. null si no está (la ruta responde 503). */
export function cronSecret(): string | null {
  const value = process.env.CRON_SECRET ?? '';
  return value.length >= 32 ? value : null;
}

/**
 * Claves de Turnstile. Con las dos variables, esas; sin ellas, en desarrollo, las de prueba de Cloudflare; en
 * producción, null (el alta online se rechaza con un mensaje claro).
 */
export function turnstileKeys(): { siteKey: string; secretKey: string } | null {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const secretKey = process.env.TURNSTILE_SECRET_KEY ?? '';
  if (siteKey && secretKey) return { siteKey, secretKey };
  if (isProductionDeploy()) return null;
  return { siteKey: TURNSTILE_TEST_SITE_KEY, secretKey: TURNSTILE_TEST_SECRET_KEY };
}

/** Remitente de los emails de reservas (el nombre visible se compone por restaurante). */
export function reservationsFromAddress(): string {
  const value = (process.env.RESERVATIONS_FROM_ADDRESS ?? '').trim();
  if (value === '') return 'reservas@fbytesolutions.com';
  if (!z.email().safeParse(value).success) {
    throw new Error('RESERVATIONS_FROM_ADDRESS no es un email válido. Revisa .env.example.');
  }
  return value;
}
````

En `.env.example`, sustituye:

````bash

# Solo para pruebas e2e (superadmin creado con pnpm admin:create)
````

por:

````bash

# Hito 4B: reserva online, emails de reservas y tarea horaria.
# Secreto de los enlaces de los comensales (al menos 32 caracteres aleatorios: openssl rand -base64 48).
# Si lo cambias, dejan de funcionar TODOS los enlaces ya enviados. En desarrollo, si falta, se usa uno fijo.
MANAGE_TOKEN_SECRET=
# Clave con la que pg_cron llama a /api/cron/hourly (al menos 32 caracteres). La misma va en Vault (mesa_cron_secret).
CRON_SECRET=
# Cloudflare Turnstile. Sin claves, en desarrollo se usan las de prueba de Cloudflare (siempre aprueban);
# en producción, sin claves, la web no acepta reservas online.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
# Remitente de los emails de reservas (dominio verificado en Resend). El nombre visible es «<Restaurante> vía Mesa».
RESERVATIONS_FROM_ADDRESS=reservas@fbytesolutions.com

# Solo para pruebas e2e (superadmin creado con pnpm admin:create)
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/reservations src/lib/env.test.ts`
Expected: PASS: todas las de `src/lib/reservations` (con `codes.test.ts`, nueva) y `env.test.ts` (4 pruebas nuevas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/settings.ts src/lib/reservations/rows.ts src/lib/reservations/rows.test.ts src/lib/reservations/codes.ts src/lib/reservations/codes.test.ts src/lib/reservations/data.ts src/lib/env.ts src/lib/env.test.ts .env.example
git commit -m "App: ajustes de la reserva online, origen «Online» y variables del Hito 4B"
```

---

### Task 7: Token del enlace, Turnstile y límite de intentos (servidor)

**Files:**
- Create: `src/lib/booking/token.ts`
- Create (prueba): `src/lib/booking/token.test.ts`
- Create: `src/lib/booking/turnstile.ts`
- Create (prueba): `src/lib/booking/turnstile.test.ts`
- Create: `src/lib/booking/rate-limit.ts`
- Create (prueba): `src/lib/booking/rate-limit.test.ts`

**Interfaces:**
- Consumes: `manageTokenSecret()` (tarea 6); `public.hit_rate_limit` (tarea 2).
- Produces:
  - `src/lib/booking/token.ts` (`server-only`): `TOKEN_PATTERN`, `manageTokenWith(secret, reservationId) → string` (base64url de HMAC-SHA256 de `'reservation:' + id`, 43 caracteres), `tokenHash(token) → string` (hex sha256), `isTokenShape(value) → value is string`, `manageToken(reservationId)`, `newBookingIdentity() → { id, token, tokenHash }`, `manageUrl(site, slug, token, locale) → string`, `ipFingerprint(ip) → string` (32 hex).
  - `src/lib/booking/turnstile.ts` (`server-only`): `type TurnstileResult = 'ok' | 'failed' | 'not_configured'` y `verifyTurnstile(token, ip, { secret, fetchImpl? }) → Promise<TurnstileResult>`.
  - `src/lib/booking/rate-limit.ts` (`server-only`): `RATE_LIMITS` (`book`: 5/10 min y 20/día; `token`: 30/10 min; `slots`: 120/10 min), `type RateLimitAction`, `rateLimitKeys(action, slug, fingerprint)`, `clientIpFrom(headers) → string`, `withinRateLimit(admin, action, slug, ip) → Promise<boolean>`.

Lee antes las decisiones 11–13 y `src/lib/env.ts` (tarea 6).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/booking/token.test.ts`:

````ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ipFingerprint, isTokenShape, manageToken, manageTokenWith, manageUrl, newBookingIdentity, tokenHash } = await import('./token');

afterEach(() => vi.unstubAllEnvs());

describe('token del enlace', () => {
  const secret = 's'.repeat(32);
  const id = '11111111-1111-4111-8111-111111111111';

  it('es determinista, de 43 caracteres base64url, y cambia con el id o con el secreto', () => {
    const token = manageTokenWith(secret, id);
    expect(token).toBe(manageTokenWith(secret, id));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(token)).toBe(true);
    expect(manageTokenWith(secret, '22222222-2222-4222-8222-222222222222')).not.toBe(token);
    expect(manageTokenWith('t'.repeat(32), id)).not.toBe(token);
  });

  it('la huella son 64 hexadecimales de sha256 del token', () => {
    expect(tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(tokenHash(manageTokenWith(secret, id))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('con MANAGE_TOKEN_SECRET: el id nuevo trae su token y su huella', () => {
    vi.stubEnv('MANAGE_TOKEN_SECRET', secret);
    const identity = newBookingIdentity();
    expect(identity.token).toBe(manageTokenWith(secret, identity.id));
    expect(identity.tokenHash).toBe(tokenHash(identity.token));
    expect(manageToken(id)).toBe(manageTokenWith(secret, id));
  });

  it('forma del token y enlace', () => {
    expect(isTokenShape('corto')).toBe(false);
    expect(isTokenShape(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isTokenShape(null)).toBe(false);
    expect(manageUrl('https://mesa.test', 'la-taberna', 'tok', 'en')).toBe('https://mesa.test/la-taberna/reserva/tok?lang=en');
  });

  it('la huella de la IP no contiene la IP y depende del secreto', () => {
    vi.stubEnv('MANAGE_TOKEN_SECRET', secret);
    const a = ipFingerprint('203.0.113.7');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('203');
    expect(ipFingerprint('203.0.113.7')).toBe(a);
    vi.stubEnv('MANAGE_TOKEN_SECRET', 'u'.repeat(32));
    expect(ipFingerprint('203.0.113.7')).not.toBe(a);
  });
});
````

Crea `src/lib/booking/turnstile.test.ts`:

````ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { verifyTurnstile } = await import('./turnstile');

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('verifyTurnstile', () => {
  it('manda el secreto, el token y la IP a siteverify y acepta success: true', async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile('tok', '203.0.113.7', { secret: 'sec', fetchImpl })).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: 'sec', response: 'tok', remoteip: '203.0.113.7' });
  });

  it('success: false, error HTTP o fallo de red: fallido (y el log no lleva IP ni token)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await verifyTurnstile('tok', null, { secret: 'sec', fetchImpl: reply({ success: false, 'error-codes': ['invalid-input-response'] }) })).toBe('failed');
    expect(await verifyTurnstile('tok', '203.0.113.7', { secret: 'sec', fetchImpl: reply({}, 500) })).toBe('failed');
    const broken = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await verifyTurnstile('tok', '203.0.113.7', { secret: 'sec', fetchImpl: broken })).toBe('failed');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/203\.0\.113\.7|tok/);
    log.mockRestore();
  });

  it('sin secreto no se deja pasar; sin token no se llama', async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile('tok', null, { secret: null, fetchImpl })).toBe('not_configured');
    expect(await verifyTurnstile('', null, { secret: 'sec', fetchImpl })).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
````

Crea `src/lib/booking/rate-limit.test.ts`:

````ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

const { clientIpFrom, rateLimitKeys, withinRateLimit } = await import('./rate-limit');

beforeEach(() => vi.stubEnv('MANAGE_TOKEN_SECRET', 's'.repeat(32)));

describe('límite de intentos', () => {
  it('claves por acción, restaurante y huella, con los límites de cada ventana', () => {
    expect(rateLimitKeys('book', 'la-taberna', 'abc')).toEqual([
      { key: 'book10m:la-taberna:abc', max: 5, windowSeconds: 600 },
      { key: 'bookday:la-taberna:abc', max: 20, windowSeconds: 86_400 },
    ]);
    expect(rateLimitKeys('token', 'la-taberna', 'abc')).toEqual([{ key: 'token:la-taberna:abc', max: 30, windowSeconds: 600 }]);
  });

  it('IP: la primera de x-forwarded-for, si no x-real-ip, si no «unknown»', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });

  it('pasa si todos los límites dicen que sí; la IP no llega nunca a la BD', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await withinRateLimit({ rpc } as unknown as SupabaseClient, 'book', 'la-taberna', '203.0.113.7')).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.7');
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await withinRateLimit({ rpc } as unknown as SupabaseClient, 'book', 'la-taberna', '203.0.113.7')).toBe(false);
  });

  it('si la BD falla, deja pasar y lo registra', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'caída' } }));
    expect(await withinRateLimit({ rpc } as unknown as SupabaseClient, 'token', 'la-taberna', '203.0.113.7')).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/booking`
Expected: FAIL: `Failed to resolve import "./token"` (y `./turnstile`, `./rate-limit`).

- [ ] **Step 3: Implementa**

Crea `src/lib/booking/token.ts`:

````ts
import 'server-only';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { manageTokenSecret } from '@/lib/env';

/** Un token del enlace: 43 caracteres base64url (HMAC-SHA256 sin relleno). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** token = base64url(HMAC-SHA256(secreto, 'reservation:' + id)). Siempre el mismo para la misma reserva. */
export function manageTokenWith(secret: string, reservationId: string): string {
  return createHmac('sha256', secret).update(`reservation:${reservationId}`).digest('base64url');
}

/** Lo único que guarda la BD: hex(sha256(token)). */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isTokenShape(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** Token del enlace de una reserva, con MANAGE_TOKEN_SECRET. */
export function manageToken(reservationId: string): string {
  return manageTokenWith(manageTokenSecret(), reservationId);
}

/** Id nuevo (lo pone la app) con su token y la huella que se guarda. */
export function newBookingIdentity(): { id: string; token: string; tokenHash: string } {
  const id = randomUUID();
  const token = manageToken(id);
  return { id, token, tokenHash: tokenHash(token) };
}

/** Enlace del comensal: https://…/la-taberna/reserva/<token>?lang=en. */
export function manageUrl(site: string, slug: string, token: string, locale: string): string {
  return `${site}/${slug}/reserva/${token}?lang=${locale}`;
}

/** Huella de la IP para el límite de intentos (la IP nunca se guarda): sha256(secreto + IP). */
export function ipFingerprint(ip: string): string {
  return createHash('sha256').update(`${manageTokenSecret()}${ip}`).digest('hex').slice(0, 32);
}
````

Crea `src/lib/booking/turnstile.ts`:

````ts
import 'server-only';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = 'ok' | 'failed' | 'not_configured';

/**
 * Comprueba en el servidor el token del widget de Turnstile (siteverify) antes de tocar la BD. Sin secreto (producción
 * sin claves) nunca se deja pasar. Un fallo de red o una respuesta rara cuentan como fallido. Logs sin la IP ni el token.
 */
export async function verifyTurnstile(
  token: string,
  ip: string | null,
  opts: { secret: string | null; fetchImpl?: typeof fetch },
): Promise<TurnstileResult> {
  if (!opts.secret) return 'not_configured';
  if (!token || token.length > 2048) return 'failed';
  const body = new URLSearchParams({ secret: opts.secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await (opts.fetchImpl ?? fetch)(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error('[turnstile] siteverify respondió', res.status);
      return 'failed';
    }
    const data = (await res.json()) as { success?: unknown };
    return data.success === true ? 'ok' : 'failed';
  } catch (e) {
    console.error('[turnstile] no se pudo comprobar', e instanceof Error ? e.name : 'error');
    return 'failed';
  }
}
````

Crea `src/lib/booking/rate-limit.ts`:

````ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ipFingerprint } from './token';

/** Límites de la decisión 13 (y uno generoso para consultar horas libres). */
export const RATE_LIMITS = {
  /** Alta online: 5 cada 10 min y 20 al día. */
  book: [
    { name: 'book10m', max: 5, windowSeconds: 600 },
    { name: 'bookday', max: 20, windowSeconds: 86_400 },
  ],
  /** Ver, modificar y cancelar con el token: 30 cada 10 min. */
  token: [{ name: 'token', max: 30, windowSeconds: 600 }],
  /** Pedir las horas libres de un día: 120 cada 10 min. */
  slots: [{ name: 'slots', max: 120, windowSeconds: 600 }],
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/** Claves `<acción>:<restaurante>:<huella de la IP>` con su límite. */
export function rateLimitKeys(action: RateLimitAction, slug: string, fingerprint: string) {
  return RATE_LIMITS[action].map((l) => ({ key: `${l.name}:${slug}:${fingerprint}`, max: l.max, windowSeconds: l.windowSeconds }));
}

/** IP del comensal según el proxy (Vercel pone x-forwarded-for); 'unknown' si no llega. */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Suma un intento a cada límite de la acción y dice si sigue dentro. Si la BD falla, deja pasar (lo registra): la
 * operación de después fallará igual y no queremos un «demasiados intentos» falso.
 */
export async function withinRateLimit(admin: SupabaseClient, action: RateLimitAction, slug: string, ip: string): Promise<boolean> {
  let ok = true;
  for (const l of rateLimitKeys(action, slug, ipFingerprint(ip))) {
    const { data, error } = await admin.rpc('hit_rate_limit', { p_key: l.key, p_max_hits: l.max, p_window_seconds: l.windowSeconds });
    if (error) {
      console.error('[rate-limit] no se pudo comprobar', action, error.message);
      continue;
    }
    if (data !== true) ok = false;
  }
  return ok;
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/booking`
Expected: PASS: 12 pruebas (token determinista y huella; siteverify con `fetch` simulado; claves y huella de la IP).

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/token.ts src/lib/booking/token.test.ts src/lib/booking/turnstile.ts src/lib/booking/turnstile.test.ts src/lib/booking/rate-limit.ts src/lib/booking/rate-limit.test.ts
git commit -m "Reserva online: token del enlace, verificación de Turnstile y límite de intentos"
```

---

### Task 8: Disponibilidad online, horas alternativas, plazo de cambios, calendario y fechas por idioma (módulos puros)

**Files:**
- Create: `src/lib/booking/online.ts`
- Create (prueba): `src/lib/booking/online.test.ts`
- Create: `src/lib/booking/calendar.ts`
- Create (prueba): `src/lib/booking/calendar.test.ts`
- Create: `src/lib/booking/format.ts`
- Create (prueba): `src/lib/booking/format.test.ts`

**Interfaces:**
- Consumes: `getAvailableSlots`, `BookingTable`, `Occupancy`, `BlockSpan`, `servicesForDate`, `ServiceConfig`, `ExceptionConfig`, `durationFor`, `BookingSettings`, `addDays`, `localParts`, `weekdayOf`, `minutesToTime`.
- Produces:
  - `src/lib/booking/online.ts`: `type OnlineRules`, `type PublicZone = { id, name, position }`, `type PublicBookingDay = { timezone, rules, services, exceptions, zones, tables, occupancy, blocks }`, `bookingWindow(nowMs, rules) → { notBeforeMs, notAfterMs }`, `isGroupRequest(partySize, rules)`, `type OnlineSlot = { minute, startMs, label, available }`, `type SlotGroup = { serviceKey, serviceName, slots }`, `onlineSlots(day, date, partySize, zoneId, nowMs = Date.now()) → SlotGroup[]`, `nearestAlternatives(groups, startMs, limit = 4) → OnlineSlot[]`, `openDates(day, nowMs = Date.now()) → string[]`, `changeDeadline(startMs, cancelLimitHours)`, `canChangeOnline(status, startMs, cancelLimitHours, nowMs)`.
  - `src/lib/booking/calendar.ts`: `monthOf(date)`, `addMonths(month, n)`, `monthGrid(month) → (string | null)[][]`, `type CalendarKey`, `CALENDAR_KEYS`, `moveDate(date, key, { min, max })`.
  - `src/lib/booking/format.ts`: `INTL_LOCALES`, `formatLongDate(ms, locale, timeZone, withYear = true)`, `formatIsoDate(date, locale, withYear = true)`, `capitalize(text)`, `formatMonth(month, locale)`, `weekdayNames(locale, style)`.

Lee antes `src/lib/reservations/availability.ts` (`getAvailableSlots` con `onlineOnly`, `zoneId`, `notBeforeMs`, `notAfterMs`) y `src/lib/reservations/day.ts`.

Los valores por defecto `nowMs = Date.now()` existen para que las páginas (componentes de servidor) no llamen a `Date.now()` dentro del componente (regla `react-hooks/purity`). Las pruebas de fechas en inglés aceptan las dos formas que da ICU (`Saturday 15 June` o `Saturday, 15 June`).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/booking/online.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import type { BookingTable } from '@/lib/reservations/availability';
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/reservations/settings';
import { bookingWindow, canChangeOnline, changeDeadline, isGroupRequest, nearestAlternatives, onlineSlots, openDates, type PublicBookingDay } from './online';

const table = (t: Partial<BookingTable> & Pick<BookingTable, 'id' | 'name'>): BookingTable => ({
  zoneId: 'sala',
  zoneName: 'Sala',
  zonePosition: 0,
  minCapacity: 1,
  maxCapacity: 2,
  onlineBookable: true,
  active: true,
  position: 0,
  ...t,
});

// Viernes 14/06/2030 en Madrid (UTC+2). Cena de 20:00 a 22:00, última reserva 21:00, cada 30 min.
const DATE = '2030-06-14';
const NOW = Date.parse('2030-06-14T10:00:00Z');
const at = (hhmm: string) => Date.parse(`${DATE}T${hhmm}:00+02:00`);

const day: PublicBookingDay = {
  timezone: 'Europe/Madrid',
  rules: { ...DEFAULT_BOOKING_SETTINGS, minAdvanceMin: 60, maxAdvanceDays: 30, maxOnlineParty: 6 },
  services: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    id: `s${weekday}`,
    name: 'Cena',
    weekday,
    startMinute: 1200,
    endMinute: 1320,
    lastBookingMinute: 1260,
    slotIntervalMin: 30,
  })),
  exceptions: [{ dateFrom: '2030-06-16', dateTo: '2030-06-16', kind: 'closed', customServices: [] }],
  zones: [
    { id: 'sala', name: 'Sala', position: 0 },
    { id: 'terraza', name: 'Terraza', position: 1 },
  ],
  tables: [table({ id: 'T1', name: 'T1' }), table({ id: 'T2', name: 'T2', minCapacity: 2, maxCapacity: 4, zoneId: 'terraza', zoneName: 'Terraza', zonePosition: 1 })],
  occupancy: [{ reservationId: '', tableId: 'T1', startMs: at('20:00'), endMs: at('21:30') }],
  blocks: [],
};

const labels = (groups: ReturnType<typeof onlineSlots>) => groups.flatMap((g) => g.slots.map((s) => `${s.label}${s.available ? '' : ' (ocupada)'}`));

describe('horas de la reserva online', () => {
  it('agrupadas por servicio, con hueco si queda una mesa online libre', () => {
    const groups = onlineSlots(day, DATE, 2, null, NOW);
    expect(groups.map((g) => g.serviceName)).toEqual(['Cena']);
    // A las 20:00 T1 está ocupada pero T2 (2–4) sirve.
    expect(labels(groups)).toEqual(['20:00', '20:30', '21:00']);
    expect(groups[0].slots[0]).toEqual({ minute: 1200, startMs: at('20:00'), label: '20:00', available: true });
  });

  it('solo mesas online: si la única libre no es online, no hay hueco', () => {
    const offline = { ...day, tables: [day.tables[0], { ...day.tables[1], onlineBookable: false }] };
    expect(labels(onlineSlots(offline, DATE, 2, null, NOW))).toEqual(['20:00 (ocupada)', '20:30 (ocupada)', '21:00 (ocupada)']);
  });

  it('con zona, solo las mesas de esa zona', () => {
    expect(labels(onlineSlots(day, DATE, 1, 'sala', NOW))).toEqual(['20:00 (ocupada)', '20:30 (ocupada)', '21:00 (ocupada)']);
    expect(labels(onlineSlots(day, DATE, 1, 'terraza', NOW))).toEqual(['20:00 (ocupada)', '20:30 (ocupada)', '21:00 (ocupada)']);
    expect(labels(onlineSlots(day, DATE, 2, 'terraza', NOW))).toEqual(['20:00', '20:30', '21:00']);
  });

  it('antelación mínima y máxima', () => {
    expect(labels(onlineSlots(day, DATE, 2, null, at('19:15')))).toEqual(['20:30', '21:00']);
    expect(onlineSlots(day, '2030-07-20', 2, null, NOW)).toEqual([]);
    expect(bookingWindow(NOW, day.rules)).toEqual({ notBeforeMs: NOW + 3_600_000, notAfterMs: NOW + 30 * 86_400_000 });
  });

  it('por encima del máximo online es una solicitud: todas las horas ofrecidas valen, aunque no quepan en ninguna mesa', () => {
    expect(isGroupRequest(6, day.rules)).toBe(false);
    expect(isGroupRequest(7, day.rules)).toBe(true);
    expect(labels(onlineSlots(day, DATE, 5, null, NOW))).toEqual(['20:00 (ocupada)', '20:30 (ocupada)', '21:00 (ocupada)']);
    expect(labels(onlineSlots(day, DATE, 12, null, NOW))).toEqual(['20:00', '20:30', '21:00']);
  });

  it('día cerrado: sin servicios', () => {
    expect(onlineSlots(day, '2030-06-16', 2, null, NOW)).toEqual([]);
  });
});

describe('horas alternativas', () => {
  const groups = [
    {
      serviceKey: '780',
      serviceName: 'Comida',
      slots: [
        { minute: 780, startMs: 780, label: '13:00', available: true },
        { minute: 810, startMs: 810, label: '13:30', available: false },
      ],
    },
    {
      serviceKey: '1200',
      serviceName: 'Cena',
      slots: [1200, 1230, 1260, 1290, 1320].map((m) => ({ minute: m, startMs: m, label: String(m), available: m !== 1260 })),
    },
  ];

  it('las más cercanas a la pedida, sin ella ni las ocupadas, en orden de hora', () => {
    expect(nearestAlternatives(groups, 1260).map((s) => s.minute)).toEqual([1200, 1230, 1290, 1320]);
    expect(nearestAlternatives(groups, 1260, 2).map((s) => s.minute)).toEqual([1230, 1290]);
    // A igual distancia, la de antes.
    expect(nearestAlternatives(groups, 1245, 1).map((s) => s.minute)).toEqual([1230]);
    expect(nearestAlternatives([], 1260)).toEqual([]);
  });
});

describe('días del calendario', () => {
  it('los que tienen alguna hora dentro de la antelación, sin los cerrados', () => {
    const dates = openDates(day, NOW);
    expect(dates[0]).toBe(DATE);
    expect(dates).not.toContain('2030-06-13');
    expect(dates).not.toContain('2030-06-16');
    expect(dates).toContain('2030-06-17');
    expect(dates.at(-1)).toBe('2030-07-13');
    // Pasada la última hora de hoy, hoy ya no se puede elegir.
    expect(openDates(day, at('20:30'))[0]).toBe('2030-06-15');
  });

  it('de madrugada se puede elegir la víspera si su cena pasa de medianoche', () => {
    const late = { ...day, rules: { ...day.rules, minAdvanceMin: 0 }, services: day.services.map((s) => ({ ...s, endMinute: 1620, lastBookingMinute: 1560 })) };
    // Sábado 15/06 a las 00:10: la cena del viernes admite reservas hasta la 02:00.
    expect(openDates(late, Date.parse('2030-06-14T22:10:00Z'))[0]).toBe('2030-06-14');
  });
});

describe('plazo para cambiar o cancelar', () => {
  const start = at('21:00');
  it('hasta el inicio menos el límite, y solo pendientes o confirmadas', () => {
    expect(changeDeadline(start, 2)).toBe(at('19:00'));
    expect(canChangeOnline('confirmed', start, 2, at('18:59'))).toBe(true);
    expect(canChangeOnline('pending', start, 2, at('18:59'))).toBe(true);
    expect(canChangeOnline('confirmed', start, 2, at('19:00'))).toBe(false);
    expect(canChangeOnline('cancelled_customer', start, 2, at('10:00'))).toBe(false);
    expect(canChangeOnline('confirmed', start, 0, at('20:59'))).toBe(true);
  });
});
````

Crea `src/lib/booking/calendar.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { addMonths, monthGrid, monthOf, moveDate } from './calendar';

describe('calendario', () => {
  it('meses: el de una fecha y sumar o restar', () => {
    expect(monthOf('2027-03-15')).toBe('2027-03');
    expect(addMonths('2027-12', 1)).toBe('2028-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('semanas de lunes a domingo con huecos', () => {
    // Marzo de 2027 empieza en lunes y tiene 31 días.
    const march = monthGrid('2027-03');
    expect(march).toHaveLength(5);
    expect(march[0][0]).toBe('2027-03-01');
    expect(march[4]).toEqual(['2027-03-29', '2027-03-30', '2027-03-31', null, null, null, null]);
    // Febrero de 2027 empieza en lunes y tiene 28 días: 4 semanas justas.
    expect(monthGrid('2027-02')).toHaveLength(4);
    // Diciembre de 2026 empieza en martes.
    expect(monthGrid('2026-12')[0].slice(0, 2)).toEqual([null, '2026-12-01']);
  });

  it('teclado: flechas, Inicio y Fin de la semana, meses con Re Pág y Av Pág, sin salirse de los límites', () => {
    const bounds = { min: '2026-11-28', max: '2027-01-27' };
    expect(moveDate('2026-12-10', 'ArrowRight', bounds)).toBe('2026-12-11');
    expect(moveDate('2026-12-10', 'ArrowLeft', bounds)).toBe('2026-12-09');
    expect(moveDate('2026-12-10', 'ArrowDown', bounds)).toBe('2026-12-17');
    expect(moveDate('2026-12-10', 'ArrowUp', bounds)).toBe('2026-12-03');
    // 10/12/2026 es jueves.
    expect(moveDate('2026-12-10', 'Home', bounds)).toBe('2026-12-07');
    expect(moveDate('2026-12-10', 'End', bounds)).toBe('2026-12-13');
    expect(moveDate('2026-12-31', 'PageDown', bounds)).toBe('2027-01-27');
    expect(moveDate('2027-01-15', 'PageUp', bounds)).toBe('2026-12-15');
    expect(moveDate('2026-11-29', 'ArrowUp', bounds)).toBe('2026-11-28');
  });
});
````

Crea `src/lib/booking/format.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { capitalize, formatIsoDate, formatLongDate, formatMonth, weekdayNames } from './format';

describe('fechas en el idioma del comensal', () => {
  const night = Date.parse('2030-06-14T22:30:00Z');

  it('con la zona del restaurante (las 00:30 de Madrid ya son sábado)', () => {
    expect(formatLongDate(night, 'es', 'Europe/Madrid')).toBe('sábado, 15 de junio de 2030');
    expect(formatLongDate(night, 'es', 'Atlantic/Canary')).toBe('viernes, 14 de junio de 2030');
    expect(formatLongDate(night, 'en', 'Europe/Madrid')).toMatch(/^Saturday,? 15 June 2030$/);
    expect(formatLongDate(night, 'de', 'Europe/Madrid', false)).toBe('Samstag, 15. Juni');
  });

  it('una fecha de servicio no cambia de día con la zona', () => {
    expect(formatIsoDate('2030-06-14', 'es')).toBe('viernes, 14 de junio de 2030');
    expect(capitalize(formatIsoDate('2030-06-14', 'ca', false))).toBe('Divendres, 14 de juny');
    expect(formatIsoDate('2030-06-14', 'fr', false)).toBe('vendredi 14 juin');
  });

  it('mes y días de la semana para el calendario, de lunes a domingo', () => {
    expect(formatMonth('2030-06', 'es')).toBe('junio de 2030');
    expect(formatMonth('2030-06', 'it')).toBe('giugno 2030');
    expect(weekdayNames('es', 'long')[0]).toBe('lunes');
    expect(weekdayNames('en', 'short')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/booking`
Expected: FAIL: `Failed to resolve import "./online"` (y `./calendar`, `./format`).

- [ ] **Step 3: Implementa**

Crea `src/lib/booking/online.ts`:

````ts
import { getAvailableSlots, type BlockSpan, type BookingTable, type Occupancy } from '@/lib/reservations/availability';
import type { ReservationStatus } from '@/lib/reservations/codes';
import { servicesForDate, type ExceptionConfig, type ServiceConfig } from '@/lib/reservations/day';
import { durationFor, type BookingSettings } from '@/lib/reservations/settings';
import { addDays, localParts } from '@/lib/reservations/time';
import { minutesToTime } from '@/lib/schedule';

/** Reglas que mira la reserva online. */
export type OnlineRules = Pick<
  BookingSettings,
  'defaultDurationMin' | 'durationRules' | 'minAdvanceMin' | 'maxAdvanceDays' | 'maxOnlineParty' | 'cancelLimitHours' | 'autoConfirm'
>;

export type PublicZone = { id: string; name: string; position: number };

/** Un día público (get_public_booking_day): sin datos personales; mesas, solo las online y activas. */
export type PublicBookingDay = {
  timezone: string;
  rules: OnlineRules;
  services: ServiceConfig[];
  exceptions: ExceptionConfig[];
  zones: PublicZone[];
  tables: BookingTable[];
  occupancy: Occupancy[];
  blocks: BlockSpan[];
};

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Antelación: no antes de ahora + mínimo, ni después de ahora + días máximos. */
export function bookingWindow(nowMs: number, rules: Pick<OnlineRules, 'minAdvanceMin' | 'maxAdvanceDays'>): { notBeforeMs: number; notAfterMs: number } {
  return { notBeforeMs: nowMs + rules.minAdvanceMin * MINUTE, notAfterMs: nowMs + rules.maxAdvanceDays * DAY };
}

/** Por encima del máximo online es una solicitud al restaurante (pendiente y sin mesa). */
export function isGroupRequest(partySize: number, rules: Pick<OnlineRules, 'maxOnlineParty'>): boolean {
  return partySize > rules.maxOnlineParty;
}

export type OnlineSlot = { minute: number; startMs: number; label: string; available: boolean };
export type SlotGroup = { serviceKey: string; serviceName: string; slots: OnlineSlot[] };

/**
 * Horas de un día para la web, agrupadas por servicio: dentro de la antelación y, hasta el máximo online, con hueco si
 * queda una mesa online (de la zona, si se elige) libre toda la duración. Una solicitud de grupo no mira mesas: todas
 * las horas ofrecidas valen. Los servicios sin ninguna hora no salen.
 */
export function onlineSlots(day: PublicBookingDay, date: string, partySize: number, zoneId: string | null, nowMs: number = Date.now()): SlotGroup[] {
  const group = isGroupRequest(partySize, day.rules);
  const slots = getAvailableSlots({
    date,
    timeZone: day.timezone,
    services: servicesForDate(date, day.services, day.exceptions),
    partySize,
    durationMin: durationFor(partySize, day.rules),
    tables: day.tables,
    occupancy: day.occupancy,
    blocks: day.blocks,
    zoneId,
    onlineOnly: true,
    ...bookingWindow(nowMs, day.rules),
  });
  const groups: SlotGroup[] = [];
  for (const s of slots) {
    let g = groups.find((x) => x.serviceKey === s.serviceKey);
    if (!g) {
      g = { serviceKey: s.serviceKey, serviceName: s.serviceName, slots: [] };
      groups.push(g);
    }
    g.slots.push({ minute: s.minute, startMs: s.startMs, label: minutesToTime(s.minute), available: group || s.table !== null });
  }
  return groups;
}

/** Las horas libres más cercanas a la pedida (sin ella), por cercanía y, a igualdad, la de antes; en orden de hora. */
export function nearestAlternatives(groups: readonly SlotGroup[], startMs: number, limit = 4): OnlineSlot[] {
  return groups
    .flatMap((g) => g.slots)
    .filter((s) => s.available && s.startMs !== startMs)
    .sort((a, b) => Math.abs(a.startMs - startMs) - Math.abs(b.startMs - startMs) || a.startMs - b.startMs)
    .slice(0, limit)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Días que se pueden elegir en el calendario: los que tienen alguna hora dentro de la antelación (sin mirar mesas).
 * Empieza en la víspera (de madrugada aún se puede reservar la cena que pasa de medianoche).
 */
export function openDates(day: Pick<PublicBookingDay, 'timezone' | 'rules' | 'services' | 'exceptions'>, nowMs: number = Date.now()): string[] {
  const today = localParts(nowMs, day.timezone).date;
  const window = bookingWindow(nowMs, day.rules);
  const out: string[] = [];
  for (let i = -1; i <= day.rules.maxAdvanceDays + 1; i++) {
    const date = addDays(today, i);
    const slots = getAvailableSlots({
      date,
      timeZone: day.timezone,
      services: servicesForDate(date, day.services, day.exceptions),
      partySize: 1,
      durationMin: 15,
      tables: [],
      occupancy: [],
      blocks: [],
      ...window,
    });
    if (slots.length > 0) out.push(date);
  }
  return out;
}

/** Hasta cuándo el comensal puede cambiar o cancelar: el inicio menos el límite de cancelación. */
export function changeDeadline(startMs: number, cancelLimitHours: number): number {
  return startMs - cancelLimitHours * 3_600_000;
}

/** Igual que public.customer_can_change: pendiente o confirmada y antes del límite. */
export function canChangeOnline(status: ReservationStatus, startMs: number, cancelLimitHours: number, nowMs: number): boolean {
  return (status === 'pending' || status === 'confirmed') && nowMs < changeDeadline(startMs, cancelLimitHours);
}
````

Crea `src/lib/booking/calendar.ts`:

````ts
import { addDays, weekdayOf } from '@/lib/reservations/time';

/** '2027-03-15' → '2027-03'. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** '2027-12' + 1 → '2028-01'. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Semanas del mes, de lunes a domingo; null en los huecos de antes del día 1 y de después del último. */
export function monthGrid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const cells: (string | null)[] = Array.from({ length: weekdayOf(first) - 1 }, () => null);
  for (let d = 1; d <= daysIn(month); d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type CalendarKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';
export const CALENDAR_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

/**
 * Teclado del calendario (patrón «date picker» de WAI-ARIA): flechas de día en día y de semana en semana, Inicio y Fin
 * al lunes y al domingo, Re Pág y Av Pág al mes anterior y siguiente (mismo día o el último del mes). Nunca sale de
 * [min, max].
 */
export function moveDate(date: string, key: CalendarKey, bounds: { min: string; max: string }): string {
  let next = date;
  if (key === 'ArrowLeft') next = addDays(date, -1);
  else if (key === 'ArrowRight') next = addDays(date, 1);
  else if (key === 'ArrowUp') next = addDays(date, -7);
  else if (key === 'ArrowDown') next = addDays(date, 7);
  else if (key === 'Home') next = addDays(date, 1 - weekdayOf(date));
  else if (key === 'End') next = addDays(date, 7 - weekdayOf(date));
  else {
    const month = addMonths(monthOf(date), key === 'PageUp' ? -1 : 1);
    next = `${month}-${String(Math.min(Number(date.slice(8)), daysIn(month))).padStart(2, '0')}`;
  }
  return next < bounds.min ? bounds.min : next > bounds.max ? bounds.max : next;
}
````

Crea `src/lib/booking/format.ts`:

````ts
import type { Locale } from '@/lib/i18n/locales';

/** Idioma de la web → formato de Intl (fechas en el idioma del comensal). */
export const INTL_LOCALES: Record<Locale, string> = { es: 'es-ES', en: 'en-GB', ca: 'ca-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: Locale, timeZone: string, withYear: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${withYear}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** Instante → 'viernes, 14 de junio de 2030' en el idioma y la zona del restaurante. */
export function formatLongDate(ms: number, locale: Locale, timeZone: string, withYear = true): string {
  return formatter(locale, timeZone, withYear).format(new Date(ms));
}

/** Fecha AAAA-MM-DD (día de servicio) → 'viernes, 14 de junio de 2030'. */
export function formatIsoDate(date: string, locale: Locale, withYear = true): string {
  return formatter(locale, 'UTC', withYear).format(new Date(`${date}T12:00:00Z`));
}

/** Primera letra en mayúscula (Intl da «viernes» en minúscula en castellano). */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** Nombre del mes de un calendario: 'junio de 2030'. */
export function formatMonth(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00Z`));
}

/** Iniciales de los días de la semana, de lunes a domingo: ['L', 'M', …] o ['lun', 'mar', …]. */
export function weekdayNames(locale: Locale, style: 'narrow' | 'short' | 'long'): string[] {
  const f = new Intl.DateTimeFormat(INTL_LOCALES[locale], { timeZone: 'UTC', weekday: style });
  // 2024-01-01 fue lunes.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i, 12))));
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/booking`
Expected: PASS: 16 pruebas más (antelación mínima y máxima, solo mesas online, zona, máximo online y solicitud de grupo, alternativas, días del calendario, plazo, teclado del calendario y fechas en seis idiomas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/online.ts src/lib/booking/online.test.ts src/lib/booking/calendar.ts src/lib/booking/calendar.test.ts src/lib/booking/format.ts src/lib/booking/format.test.ts
git commit -m "Reserva online: horas libres, alternativas, plazo de cambios, calendario y fechas por idioma"
```

---

### Task 9: .ics propio y nombre del remitente

**Files:**
- Create: `src/lib/email/ics.ts`
- Create (prueba): `src/lib/email/ics.test.ts`
- Create: `src/lib/email/sender.ts`
- Create (prueba): `src/lib/email/sender.test.ts`

**Interfaces:**
- Consumes: `BRAND.productName` (`src/config/brand.ts`); en la prueba, `zonedTimeToUtc`.
- Produces:
  - `src/lib/email/ics.ts`: `type IcsEvent = { uid, startMs, endMs, nowMs, sequence, summary, location?, description?, url? }`, `escapeIcsText(value)`, `foldIcsLine(line)` (75 octetos UTF-8), `icsDate(ms)`, `icsSequence(updatedAtMs)`, `buildIcs(event) → string` (CRLF, `METHOD:PUBLISH`, `UID:<id>@mesa`).
  - `src/lib/email/sender.ts`: `senderName(restaurantName, product = BRAND.productName) → '… vía Mesa'` y `fromHeader(name, address) → '"name" <address>'`.

Lee antes las decisiones 32 y 34.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/email/ics.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '@/lib/reservations/time';
import { buildIcs, escapeIcsText, foldIcsLine, icsDate, icsSequence } from './ics';

const event = {
  uid: '11111111-1111-4111-8111-111111111111',
  startMs: Date.parse('2030-06-14T19:00:00Z'),
  endMs: Date.parse('2030-06-14T20:30:00Z'),
  nowMs: Date.parse('2030-06-01T08:00:00Z'),
  sequence: 3,
  summary: 'Reserva en La Taberna, de Pepe',
  location: 'Calle Mayor 1; 28013 Madrid',
  description: 'Mesa para 2\nGestionar: https://mesa.test/x',
  url: 'https://mesa.test/la-taberna/reserva/tok?lang=es',
};

describe('.ics', () => {
  it('evento PUBLISH con UID, horas en UTC y SEQUENCE, en líneas CRLF', () => {
    const ics = buildIcs(event);
    expect(ics.endsWith('\r\n')).toBe(true);
    const lines = ics.split('\r\n');
    expect(lines.slice(0, 6)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FByte Solutions//Mesa//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT']);
    expect(lines).toContain('UID:11111111-1111-4111-8111-111111111111@mesa');
    expect(lines).toContain('DTSTART:20300614T190000Z');
    expect(lines).toContain('DTEND:20300614T203000Z');
    expect(lines).toContain('DTSTAMP:20300601T080000Z');
    expect(lines).toContain('SEQUENCE:3');
    expect(lines).toContain('SUMMARY:Reserva en La Taberna\\, de Pepe');
    expect(lines).toContain('LOCATION:Calle Mayor 1\; 28013 Madrid');
    expect(ics).toContain('DESCRIPTION:Mesa para 2\\nGestionar: https://mesa.test/x');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('sin dirección ni descripción no salen esas líneas', () => {
    const ics = buildIcs({ ...event, location: null, description: null, url: null });
    expect(ics).not.toMatch(/LOCATION|DESCRIPTION|URL:/);
  });

  it('escapa barras, puntos y coma, comas y saltos de línea', () => {
    expect(escapeIcsText('a\\b;c,d\r\ne\nf')).toBe('a\\\\b\;c\\,d\\ne\\nf');
  });

  it('pliega a 75 octetos sin partir caracteres de varios bytes', () => {
    const line = `SUMMARY:${'á'.repeat(60)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
    expect(foldIcsLine('corta')).toBe('corta');
  });

  it('horas en UTC también los días de cambio de hora y en Canarias', () => {
    // 28/03/2027 a las 13:00 en Madrid ya es horario de verano (UTC+2).
    expect(icsDate(zonedTimeToUtc('2027-03-28', 780, 'Europe/Madrid'))).toBe('20270328T110000Z');
    // 31/10/2027 a las 13:00 en Madrid vuelve a UTC+1.
    expect(icsDate(zonedTimeToUtc('2027-10-31', 780, 'Europe/Madrid'))).toBe('20271031T120000Z');
    // En Canarias, una hora menos que en la Península.
    expect(icsDate(zonedTimeToUtc('2027-06-14', 1260, 'Atlantic/Canary'))).toBe('20270614T200000Z');
  });

  it('SEQUENCE sube con cada modificación', () => {
    expect(icsSequence(Date.UTC(2026, 0, 1))).toBe(0);
    expect(icsSequence(Date.UTC(2026, 0, 1, 0, 0, 10))).toBe(10);
    expect(icsSequence(Date.parse('2030-06-01T08:00:01Z'))).toBeGreaterThan(icsSequence(Date.parse('2030-06-01T08:00:00Z')));
  });
});
````

Crea `src/lib/email/sender.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { fromHeader, senderName } from './sender';

describe('remitente de los emails de reservas', () => {
  it('«<Restaurante> vía Mesa»', () => {
    expect(senderName('La Taberna de Pepe')).toBe('La Taberna de Pepe vía Mesa');
    expect(fromHeader(senderName('La Taberna'), 'reservas@fbytesolutions.com')).toBe('"La Taberna vía Mesa" <reservas@fbytesolutions.com>');
  });

  it('sin comillas, ángulos, barras ni caracteres de control; con comas y acentos', () => {
    expect(senderName('Casa "Paco" <bar>\\')).toBe('Casa Paco bar vía Mesa');
    expect(senderName('Bar\r\nBcc: x@y.com')).toBe('Bar Bcc: x@y.com vía Mesa');
    expect(senderName('L’Àpat, «el bo»\u200b')).toBe('L’Àpat, el bo vía Mesa');
  });

  it('nombres larguísimos se recortan; vacío, solo el producto', () => {
    expect(senderName('x'.repeat(100))).toBe(`${'x'.repeat(60)} vía Mesa`);
    expect(senderName(' "" ')).toBe('Mesa');
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/email/ics.test.ts src/lib/email/sender.test.ts`
Expected: FAIL: `Failed to resolve import "./ics"` (y `./sender`).

- [ ] **Step 3: Implementa**

Crea `src/lib/email/ics.ts`:

````ts
/** Archivo .ics propio (RFC 5545), sin librería: un evento con las horas en UTC. */
export type IcsEvent = {
  uid: string;
  startMs: number;
  endMs: number;
  /** DTSTAMP: cuándo se genera. */
  nowMs: number;
  sequence: number;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
};

/** Texto de una propiedad: barra invertida, punto y coma, coma y saltos de línea escapados. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Líneas de como mucho 75 octetos (UTF-8); las siguientes empiezan por un espacio. No parte un carácter. */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** 2030-06-14T19:00:00Z → '20300614T190000Z'. */
export function icsDate(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** SEQUENCE a partir de la última modificación de la reserva: segundos desde el 1/1/2026 (sube con cada cambio). */
export function icsSequence(updatedAtMs: number): number {
  return Math.max(0, Math.floor((updatedAtMs - Date.UTC(2026, 0, 1)) / 1000));
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FByte Solutions//Mesa//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@mesa`,
    `DTSTAMP:${icsDate(e.nowMs)}`,
    `DTSTART:${icsDate(e.startMs)}`,
    `DTEND:${icsDate(e.endMs)}`,
    `SEQUENCE:${e.sequence}`,
    `SUMMARY:${escapeIcsText(e.summary)}`,
    ...(e.location ? [`LOCATION:${escapeIcsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${escapeIcsText(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
````

Crea `src/lib/email/sender.ts`:

````ts
import { BRAND } from '@/config/brand';

/**
 * Nombre visible del remitente: «La Taberna vía Mesa». Sin comillas, barras invertidas, ángulos ni caracteres de
 * control (no pueden romper la cabecera From), espacios juntados y como mucho 60 caracteres del restaurante.
 */
export function senderName(restaurantName: string, product: string = BRAND.productName): string {
  const clean = restaurantName
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/["\\<>«»“”„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return clean ? `${clean} vía ${product}` : product;
}

/** Cabecera From: "La Taberna vía Mesa" <reservas@fbytesolutions.com>. */
export function fromHeader(name: string, address: string): string {
  return `"${name}" <${address}>`;
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/email/ics.test.ts src/lib/email/sender.test.ts`
Expected: PASS: 9 pruebas (escapado, plegado, UTC con cambio de hora y Canarias, SEQUENCE; remitente sin comillas ni caracteres de control).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/ics.ts src/lib/email/ics.test.ts src/lib/email/sender.ts src/lib/email/sender.test.ts
git commit -m "Emails: archivo .ics propio y nombre visible del remitente"
```

---

### Task 10: Textos de la reserva online, del enlace y de los emails al comensal en los 6 idiomas

**Files:**
- Create: `src/lib/i18n/booking/types.ts`
- Create: `src/lib/i18n/booking/es.ts`
- Create: `src/lib/i18n/booking/en.ts`
- Create: `src/lib/i18n/booking/ca.ts`
- Create: `src/lib/i18n/booking/fr.ts`
- Create: `src/lib/i18n/booking/de.ts`
- Create: `src/lib/i18n/booking/it.ts`
- Create: `src/lib/i18n/booking/index.ts`
- Create (prueba): `src/lib/i18n/booking/messages.test.ts`

**Interfaces:**
- Consumes: `Locale`, `LOCALES`; `CustomerEmailKind` (tarea 1); `ReservationStatus`, `RESERVATION_STATUSES`.
- Produces:
  - `src/lib/i18n/booking/types.ts`: `BOOKING_ERRORS` (`slotTaken`, `unavailable`, `changeClosed`, `tooMany`, `turnstile`, `turnstileMissing`, `bookingClosed`, `notFound`, `generic`), `type BookingError`, `BOOKING_FIELD_ERRORS` (`nameRequired`, `nameTooLong`, `emailInvalid`, `phoneRequired`, `phoneInvalid`, `notesTooLong`, `privacyRequired`, `partyInvalid`, `pickDate`, `pickTime`), `type BookingFieldError`, `type BookingMessages` (todas las claves que usan los componentes, la página del enlace y las plantillas: `emails.subject/heading/intro`, `emails.manage`, `emails.directions`, `emails.icsTitle`, …).
  - `src/lib/i18n/booking/{es,en,ca,fr,de,it}.ts` y `index.ts`: `BOOKING_MESSAGES`, `getBookingMessages(locale)` y los reexportes.

Lee antes `src/lib/i18n/messages.ts` y su prueba (mismo estilo: un objeto por idioma y prueba de completitud).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/i18n/booking/messages.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/locales';
import { RESERVATION_STATUSES } from '@/lib/reservations/codes';
import { BOOKING_ERRORS, BOOKING_FIELD_ERRORS, BOOKING_MESSAGES, getBookingMessages } from './index';

/** Todos los textos de un objeto de mensajes (las funciones, con datos de ejemplo). */
function texts(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') return [[path, String((value as (...a: unknown[]) => unknown)('X', 'Y', 'Z'))]];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

describe('textos de la reserva online', () => {
  it('los seis idiomas, con las mismas claves y sin textos vacíos', () => {
    expect(Object.keys(BOOKING_MESSAGES).sort()).toEqual([...LOCALES].sort());
    const keys = texts(BOOKING_MESSAGES.es).map(([k]) => k);
    for (const locale of LOCALES) {
      const all = texts(getBookingMessages(locale));
      expect(all.map(([k]) => k), locale).toEqual(keys);
      for (const [key, text] of all) expect(text.trim(), `${locale}.${key}`).not.toBe('');
      const m = getBookingMessages(locale);
      expect(Object.keys(m.errors).sort(), locale).toEqual([...BOOKING_ERRORS].sort());
      expect(Object.keys(m.fields).sort(), locale).toEqual([...BOOKING_FIELD_ERRORS].sort());
      expect(Object.keys(m.status).sort(), locale).toEqual([...RESERVATION_STATUSES].sort());
      expect(m.groupNotice(8), locale).toContain('8');
      expect(m.partyOption(1), locale).not.toBe(m.partyOption(2).replace('2', '1'));
      expect(m.emails.subject.customer_confirmed('La Taberna'), locale).toContain('La Taberna');
      expect(m.emailSent('ana@example.com'), locale).toContain('ana@example.com');
    }
  });

  it('en castellano, los textos de las decisiones', () => {
    const es = getBookingMessages('es');
    expect(es.errors.slotTaken).toBe('Vaya, esa hora se acaba de ocupar. Te enseño las más cercanas.');
    expect(es.errors.tooMany).toBe('Has hecho demasiados intentos. Espera unos minutos y vuelve a probar.');
    expect(es.errors.turnstile).toBe('No hemos podido comprobar que no eres un robot. Vuelve a intentarlo.');
    expect(es.groupNotice(8)).toBe('Para grupos de más de 8 personas enviamos una solicitud al restaurante.');
    expect(es.emailSent('ana@example.com')).toBe('Te hemos enviado un email a ana@example.com.');
    expect(es.callToChange('910 00 00 00')).toBe('Para cambiar algo, llama al restaurante: 910 00 00 00.');
    expect(es.emails.manage).toBe('Gestionar mi reserva');
    expect(es.emails.directions).toBe('Cómo llegar');
    expect(es.emails.icsTitle('La Taberna')).toBe('Reserva en La Taberna');
    expect(es.partyOption(1)).toBe('1 persona');
    expect(es.partyOption(4)).toBe('4 personas');
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/i18n`
Expected: FAIL: `Failed to resolve import "./index"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/i18n/booking/types.ts`:

````ts
import type { CustomerEmailKind } from '@/lib/email/outbox-rules';
import type { ReservationStatus } from '@/lib/reservations/codes';

/** Códigos de error que devuelven las acciones públicas (nunca el texto de la BD). */
export const BOOKING_ERRORS = [
  'slotTaken',
  'unavailable',
  'changeClosed',
  'tooMany',
  'turnstile',
  'turnstileMissing',
  'bookingClosed',
  'notFound',
  'generic',
] as const;
export type BookingError = (typeof BOOKING_ERRORS)[number];

/** Errores de los campos del formulario público (los mismos esquemas en el navegador y en el servidor). */
export const BOOKING_FIELD_ERRORS = [
  'nameRequired',
  'nameTooLong',
  'emailInvalid',
  'phoneRequired',
  'phoneInvalid',
  'notesTooLong',
  'privacyRequired',
  'partyInvalid',
  'pickDate',
  'pickTime',
] as const;
export type BookingFieldError = (typeof BOOKING_FIELD_ERRORS)[number];

/** Textos de la reserva online, del enlace del comensal y de sus emails (voz neutra de las páginas públicas). */
export type BookingMessages = {
  book: string;
  bookTitle: (restaurant: string) => string;
  bookIntro: string;
  partyLabel: string;
  partyOption: (n: number) => string;
  groupNotice: (max: number) => string;
  dateLabel: string;
  prevMonth: string;
  nextMonth: string;
  dayUnavailable: string;
  timeLabel: string;
  pickDayFirst: string;
  loadingTimes: string;
  noTimes: string;
  timeTaken: string;
  zoneLabel: string;
  anyZone: string;
  detailsTitle: string;
  name: string;
  email: string;
  emailHint: string;
  phone: string;
  phoneHint: string;
  notes: string;
  notesHint: string;
  privacyInfo: (holder: string) => string;
  privacyAccept: string;
  privacyLink: string;
  marketing: (restaurant: string) => string;
  securityCheck: string;
  submit: string;
  submitRequest: string;
  sending: string;
  summary: (date: string, time: string, party: string) => string;
  confirmedTitle: string;
  confirmedText: string;
  pendingTitle: string;
  pendingText: string;
  emailSent: (email: string) => string;
  alternatives: string;
  noAlternatives: string;
  errors: Record<BookingError, string>;
  fields: Record<BookingFieldError, string>;
  phoneOnlyTitle: string;
  phoneOnlyText: string;
  phoneOnlyNoPhone: string;
  manageTitle: string;
  status: Record<ReservationStatus, string>;
  detailName: string;
  detailDate: string;
  detailTime: string;
  detailParty: string;
  detailZone: string;
  detailNotes: string;
  changeUntil: (date: string, time: string) => string;
  modifyTitle: string;
  saveChanges: string;
  cancelBooking: string;
  cancelQuestion: string;
  cancelYes: string;
  cancelNo: string;
  cancelledNotice: string;
  modifiedNotice: string;
  callToChange: (phone: string) => string;
  contactToChange: string;
  notFoundTitle: string;
  notFoundText: string;
  privacyTitle: string;
  emails: {
    subject: Record<CustomerEmailKind, (restaurant: string) => string>;
    heading: Record<CustomerEmailKind, string>;
    intro: Record<CustomerEmailKind, string>;
    stillPending: string;
    manage: string;
    directions: string;
    callUs: (phone: string) => string;
    calendarNote: string;
    icsTitle: (restaurant: string) => string;
  };
};
````

Crea `src/lib/i18n/booking/es.ts`:

````ts
import type { BookingMessages } from './types';

export const es: BookingMessages = {
  book: 'Reservar',
  bookTitle: (r) => `Reservar en ${r}`,
  bookIntro: 'Elige cuántos sois, el día y la hora.',
  partyLabel: 'Personas',
  partyOption: (n) => (n === 1 ? '1 persona' : `${n} personas`),
  groupNotice: (max) => `Para grupos de más de ${max} personas enviamos una solicitud al restaurante.`,
  dateLabel: 'Día',
  prevMonth: 'Mes anterior',
  nextMonth: 'Mes siguiente',
  dayUnavailable: 'no disponible',
  timeLabel: 'Hora',
  pickDayFirst: 'Elige un día para ver las horas.',
  loadingTimes: 'Buscando horas libres…',
  noTimes: 'Ese día no queda ninguna hora libre. Prueba otro día.',
  timeTaken: 'completa',
  zoneLabel: 'Zona',
  anyZone: 'Me da igual',
  detailsTitle: 'Tus datos',
  name: 'Nombre',
  email: 'Email',
  emailHint: 'Te enviaremos aquí la confirmación y el enlace para cambiarla.',
  phone: 'Teléfono',
  phoneHint: 'Si no es de España, empieza por + y el prefijo.',
  notes: 'Notas (opcional)',
  notesHint: 'Alergias, una trona, una celebración…',
  privacyInfo: (holder) =>
    `Responsable: ${holder}. Finalidad: gestionar tu reserva. Puedes acceder a tus datos, corregirlos o pedir que los borremos, entre otros derechos.`,
  privacyAccept: 'He leído la información de privacidad y la acepto.',
  privacyLink: 'Política de privacidad',
  marketing: (r) => `Quiero recibir noticias y ofertas de ${r} (opcional).`,
  securityCheck: 'Comprobación de seguridad',
  submit: 'Reservar',
  submitRequest: 'Enviar solicitud',
  sending: 'Enviando…',
  summary: (date, time, party) => `${date} · ${time} · ${party}`,
  confirmedTitle: 'Reserva confirmada',
  confirmedText: '¡Te esperamos!',
  pendingTitle: 'Solicitud enviada',
  pendingText: 'El restaurante la revisará y te avisaremos por email.',
  emailSent: (email) => `Te hemos enviado un email a ${email}.`,
  alternatives: 'Horas más cercanas',
  noAlternatives: 'No quedan horas cerca. Prueba otro día.',
  errors: {
    slotTaken: 'Vaya, esa hora se acaba de ocupar. Te enseño las más cercanas.',
    unavailable: 'Esa hora ya no se puede reservar. Elige otra.',
    changeClosed: 'Ya no se puede cambiar ni cancelar online.',
    tooMany: 'Has hecho demasiados intentos. Espera unos minutos y vuelve a probar.',
    turnstile: 'No hemos podido comprobar que no eres un robot. Vuelve a intentarlo.',
    turnstileMissing: 'Ahora mismo no se puede reservar online. Llama al restaurante, por favor.',
    bookingClosed: 'Este restaurante no acepta reservas online ahora mismo.',
    notFound: 'No encontramos esta reserva.',
    generic: 'Algo ha fallado. Vuelve a intentarlo en un momento.',
  },
  fields: {
    nameRequired: 'Escribe tu nombre.',
    nameTooLong: 'Como mucho 120 caracteres.',
    emailInvalid: 'Ese email no parece correcto.',
    phoneRequired: 'Escribe un teléfono de contacto.',
    phoneInvalid: 'Ese teléfono no parece correcto. Si es de fuera, empieza por + y el prefijo.',
    notesTooLong: 'Como mucho 500 caracteres.',
    privacyRequired: 'Para reservar tienes que aceptar la información de privacidad.',
    partyInvalid: 'Elige cuántas personas sois.',
    pickDate: 'Elige un día.',
    pickTime: 'Elige una hora.',
  },
  phoneOnlyTitle: 'Reserva por teléfono',
  phoneOnlyText: 'Las reservas de este restaurante son por teléfono:',
  phoneOnlyNoPhone: 'Este restaurante no acepta reservas online. Ponte en contacto con él para reservar.',
  manageTitle: 'Tu reserva',
  status: {
    pending: 'Pendiente de confirmar',
    confirmed: 'Confirmada',
    seated: 'En la mesa',
    completed: 'Finalizada',
    cancelled_customer: 'Cancelada',
    cancelled_restaurant: 'Cancelada por el restaurante',
    rejected: 'No confirmada',
    no_show: 'Finalizada',
  },
  detailName: 'A nombre de',
  detailDate: 'Día',
  detailTime: 'Hora',
  detailParty: 'Personas',
  detailZone: 'Zona',
  detailNotes: 'Notas',
  changeUntil: (date, time) => `Puedes cambiarla o cancelarla hasta el ${date} a las ${time}.`,
  modifyTitle: 'Cambiar la reserva',
  saveChanges: 'Guardar cambios',
  cancelBooking: 'Cancelar reserva',
  cancelQuestion: '¿Seguro que quieres cancelar la reserva?',
  cancelYes: 'Sí, cancelarla',
  cancelNo: 'No, mantenerla',
  cancelledNotice: 'Reserva cancelada. Te hemos enviado un email.',
  modifiedNotice: 'Cambios guardados. Te hemos enviado un email.',
  callToChange: (phone) => `Para cambiar algo, llama al restaurante: ${phone}.`,
  contactToChange: 'Para cambiar algo, ponte en contacto con el restaurante.',
  notFoundTitle: 'No encontramos esta reserva',
  notFoundText: 'Revisa el enlace del email o ponte en contacto con el restaurante.',
  privacyTitle: 'Política de privacidad',
  emails: {
    subject: {
      customer_pending: (r) => `Hemos recibido tu solicitud en ${r}`,
      customer_confirmed: (r) => `Reserva confirmada en ${r}`,
      customer_modified: (r) => `Tu reserva en ${r} ha cambiado`,
      customer_cancelled: (r) => `Reserva cancelada en ${r}`,
      customer_rejected: (r) => `${r} no puede confirmar tu reserva`,
      customer_reminder: (r) => `Te esperamos en ${r}`,
    },
    heading: {
      customer_pending: 'Solicitud recibida',
      customer_confirmed: 'Reserva confirmada',
      customer_modified: 'Reserva modificada',
      customer_cancelled: 'Reserva cancelada',
      customer_rejected: 'Reserva no confirmada',
      customer_reminder: 'Te esperamos',
    },
    intro: {
      customer_pending: 'El restaurante revisará tu solicitud y te escribiremos en cuanto la confirme.',
      customer_confirmed: 'Todo listo. Estos son los datos de tu reserva:',
      customer_modified: 'Hemos guardado los cambios. Así queda tu reserva:',
      customer_cancelled: 'Tu reserva está cancelada. Si quieres, puedes hacer otra cuando quieras.',
      customer_rejected: 'Lo sentimos: el restaurante no puede atenderte en esa fecha. Si quieres, llámalo para buscar otra hora.',
      customer_reminder: 'Te recordamos tu reserva:',
    },
    stillPending: 'Queda pendiente de que el restaurante la confirme.',
    manage: 'Gestionar mi reserva',
    directions: 'Cómo llegar',
    callUs: (phone) => `Teléfono del restaurante: ${phone}`,
    calendarNote: 'Te adjuntamos la reserva para que la añadas a tu calendario.',
    icsTitle: (r) => `Reserva en ${r}`,
  },
};
````

Crea `src/lib/i18n/booking/en.ts`:

````ts
import type { BookingMessages } from './types';

export const en: BookingMessages = {
  book: 'Book a table',
  bookTitle: (r) => `Book a table at ${r}`,
  bookIntro: 'Choose how many of you there are, the day and the time.',
  partyLabel: 'Guests',
  partyOption: (n) => (n === 1 ? '1 guest' : `${n} guests`),
  groupNotice: (max) => `For groups of more than ${max} we send a request to the restaurant.`,
  dateLabel: 'Day',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  dayUnavailable: 'not available',
  timeLabel: 'Time',
  pickDayFirst: 'Choose a day to see the times.',
  loadingTimes: 'Looking for free times…',
  noTimes: 'There are no free times left that day. Try another day.',
  timeTaken: 'full',
  zoneLabel: 'Area',
  anyZone: 'No preference',
  detailsTitle: 'Your details',
  name: 'Name',
  email: 'Email',
  emailHint: 'We will send the confirmation and the link to change it here.',
  phone: 'Phone',
  phoneHint: 'If it is not a Spanish number, start with + and the country code.',
  notes: 'Notes (optional)',
  notesHint: 'Allergies, a high chair, a celebration…',
  privacyInfo: (holder) =>
    `Controller: ${holder}. Purpose: managing your booking. You can access, correct or ask us to delete your data, among other rights.`,
  privacyAccept: 'I have read and accept the privacy information.',
  privacyLink: 'Privacy policy',
  marketing: (r) => `I would like to receive news and offers from ${r} (optional).`,
  securityCheck: 'Security check',
  submit: 'Book',
  submitRequest: 'Send request',
  sending: 'Sending…',
  summary: (date, time, party) => `${date} · ${time} · ${party}`,
  confirmedTitle: 'Booking confirmed',
  confirmedText: 'See you soon!',
  pendingTitle: 'Request sent',
  pendingText: 'The restaurant will review it and we will let you know by email.',
  emailSent: (email) => `We have sent an email to ${email}.`,
  alternatives: 'Closest times',
  noAlternatives: 'There are no times nearby. Try another day.',
  errors: {
    slotTaken: 'Sorry, that time has just been taken. Here are the closest ones.',
    unavailable: 'That time can no longer be booked. Choose another one.',
    changeClosed: 'It can no longer be changed or cancelled online.',
    tooMany: 'You have tried too many times. Wait a few minutes and try again.',
    turnstile: 'We could not check that you are not a robot. Please try again.',
    turnstileMissing: 'Online booking is not available right now. Please call the restaurant.',
    bookingClosed: 'This restaurant is not taking online bookings right now.',
    notFound: 'We cannot find this booking.',
    generic: 'Something went wrong. Please try again in a moment.',
  },
  fields: {
    nameRequired: 'Enter your name.',
    nameTooLong: 'At most 120 characters.',
    emailInvalid: 'That email does not look right.',
    phoneRequired: 'Enter a contact phone number.',
    phoneInvalid: 'That phone number does not look right. If it is not Spanish, start with + and the country code.',
    notesTooLong: 'At most 500 characters.',
    privacyRequired: 'To book you need to accept the privacy information.',
    partyInvalid: 'Choose how many guests.',
    pickDate: 'Choose a day.',
    pickTime: 'Choose a time.',
  },
  phoneOnlyTitle: 'Book by phone',
  phoneOnlyText: 'This restaurant takes bookings by phone:',
  phoneOnlyNoPhone: 'This restaurant is not taking online bookings. Please contact it to book.',
  manageTitle: 'Your booking',
  status: {
    pending: 'Awaiting confirmation',
    confirmed: 'Confirmed',
    seated: 'At the table',
    completed: 'Finished',
    cancelled_customer: 'Cancelled',
    cancelled_restaurant: 'Cancelled by the restaurant',
    rejected: 'Not confirmed',
    no_show: 'Finished',
  },
  detailName: 'Name',
  detailDate: 'Day',
  detailTime: 'Time',
  detailParty: 'Guests',
  detailZone: 'Area',
  detailNotes: 'Notes',
  changeUntil: (date, time) => `You can change or cancel it until ${date} at ${time}.`,
  modifyTitle: 'Change the booking',
  saveChanges: 'Save changes',
  cancelBooking: 'Cancel booking',
  cancelQuestion: 'Are you sure you want to cancel the booking?',
  cancelYes: 'Yes, cancel it',
  cancelNo: 'No, keep it',
  cancelledNotice: 'Booking cancelled. We have sent you an email.',
  modifiedNotice: 'Changes saved. We have sent you an email.',
  callToChange: (phone) => `To change anything, call the restaurant: ${phone}.`,
  contactToChange: 'To change anything, contact the restaurant.',
  notFoundTitle: 'We cannot find this booking',
  notFoundText: 'Check the link in the email or contact the restaurant.',
  privacyTitle: 'Privacy policy',
  emails: {
    subject: {
      customer_pending: (r) => `We have received your request at ${r}`,
      customer_confirmed: (r) => `Booking confirmed at ${r}`,
      customer_modified: (r) => `Your booking at ${r} has changed`,
      customer_cancelled: (r) => `Booking cancelled at ${r}`,
      customer_rejected: (r) => `${r} cannot confirm your booking`,
      customer_reminder: (r) => `See you at ${r}`,
    },
    heading: {
      customer_pending: 'Request received',
      customer_confirmed: 'Booking confirmed',
      customer_modified: 'Booking changed',
      customer_cancelled: 'Booking cancelled',
      customer_rejected: 'Booking not confirmed',
      customer_reminder: 'See you soon',
    },
    intro: {
      customer_pending: 'The restaurant will review your request and we will write to you as soon as it is confirmed.',
      customer_confirmed: 'All set. These are your booking details:',
      customer_modified: 'We have saved the changes. This is your booking now:',
      customer_cancelled: 'Your booking is cancelled. You can make a new one whenever you like.',
      customer_rejected: 'Sorry: the restaurant cannot take your booking on that date. You can call them to find another time.',
      customer_reminder: 'A reminder of your booking:',
    },
    stillPending: 'It is waiting for the restaurant to confirm it.',
    manage: 'Manage my booking',
    directions: 'Get directions',
    callUs: (phone) => `Restaurant phone: ${phone}`,
    calendarNote: 'We have attached the booking so you can add it to your calendar.',
    icsTitle: (r) => `Booking at ${r}`,
  },
};
````

Crea `src/lib/i18n/booking/ca.ts`:

````ts
import type { BookingMessages } from './types';

export const ca: BookingMessages = {
  book: 'Reservar',
  bookTitle: (r) => `Reservar a ${r}`,
  bookIntro: 'Tria quants sou, el dia i l’hora.',
  partyLabel: 'Persones',
  partyOption: (n) => (n === 1 ? '1 persona' : `${n} persones`),
  groupNotice: (max) => `Per a grups de més de ${max} persones enviem una sol·licitud al restaurant.`,
  dateLabel: 'Dia',
  prevMonth: 'Mes anterior',
  nextMonth: 'Mes següent',
  dayUnavailable: 'no disponible',
  timeLabel: 'Hora',
  pickDayFirst: 'Tria un dia per veure les hores.',
  loadingTimes: 'Buscant hores lliures…',
  noTimes: 'Aquell dia no queda cap hora lliure. Prova un altre dia.',
  timeTaken: 'completa',
  zoneLabel: 'Zona',
  anyZone: 'M’és igual',
  detailsTitle: 'Les teves dades',
  name: 'Nom',
  email: 'Correu electrònic',
  emailHint: 'T’hi enviarem la confirmació i l’enllaç per canviar-la.',
  phone: 'Telèfon',
  phoneHint: 'Si no és d’Espanya, comença per + i el prefix.',
  notes: 'Notes (opcional)',
  notesHint: 'Al·lèrgies, una trona, una celebració…',
  privacyInfo: (holder) =>
    `Responsable: ${holder}. Finalitat: gestionar la teva reserva. Pots accedir a les teves dades, corregir-les o demanar que les esborrem, entre altres drets.`,
  privacyAccept: 'He llegit la informació de privadesa i l’accepto.',
  privacyLink: 'Política de privadesa',
  marketing: (r) => `Vull rebre notícies i ofertes de ${r} (opcional).`,
  securityCheck: 'Comprovació de seguretat',
  submit: 'Reservar',
  submitRequest: 'Enviar la sol·licitud',
  sending: 'Enviant…',
  summary: (date, time, party) => `${date} · ${time} · ${party}`,
  confirmedTitle: 'Reserva confirmada',
  confirmedText: 'T’esperem!',
  pendingTitle: 'Sol·licitud enviada',
  pendingText: 'El restaurant la revisarà i t’avisarem per correu.',
  emailSent: (email) => `T’hem enviat un correu a ${email}.`,
  alternatives: 'Hores més properes',
  noAlternatives: 'No queden hores a prop. Prova un altre dia.',
  errors: {
    slotTaken: 'Vaja, aquesta hora s’acaba d’ocupar. T’ensenyo les més properes.',
    unavailable: 'Aquesta hora ja no es pot reservar. Tria’n una altra.',
    changeClosed: 'Ja no es pot canviar ni cancel·lar en línia.',
    tooMany: 'Has fet massa intents. Espera uns minuts i torna-ho a provar.',
    turnstile: 'No hem pogut comprovar que no ets un robot. Torna-ho a provar.',
    turnstileMissing: 'Ara mateix no es pot reservar en línia. Truca al restaurant, si us plau.',
    bookingClosed: 'Aquest restaurant no accepta reserves en línia ara mateix.',
    notFound: 'No trobem aquesta reserva.',
    generic: 'Alguna cosa ha fallat. Torna-ho a provar d’aquí a un moment.',
  },
  fields: {
    nameRequired: 'Escriu el teu nom.',
    nameTooLong: 'Com a màxim 120 caràcters.',
    emailInvalid: 'Aquest correu no sembla correcte.',
    phoneRequired: 'Escriu un telèfon de contacte.',
    phoneInvalid: 'Aquest telèfon no sembla correcte. Si és de fora, comença per + i el prefix.',
    notesTooLong: 'Com a màxim 500 caràcters.',
    privacyRequired: 'Per reservar has d’acceptar la informació de privadesa.',
    partyInvalid: 'Tria quantes persones sou.',
    pickDate: 'Tria un dia.',
    pickTime: 'Tria una hora.',
  },
  phoneOnlyTitle: 'Reserva per telèfon',
  phoneOnlyText: 'Les reserves d’aquest restaurant són per telèfon:',
  phoneOnlyNoPhone: 'Aquest restaurant no accepta reserves en línia. Posa’t en contacte amb ell per reservar.',
  manageTitle: 'La teva reserva',
  status: {
    pending: 'Pendent de confirmar',
    confirmed: 'Confirmada',
    seated: 'A taula',
    completed: 'Finalitzada',
    cancelled_customer: 'Cancel·lada',
    cancelled_restaurant: 'Cancel·lada pel restaurant',
    rejected: 'No confirmada',
    no_show: 'Finalitzada',
  },
  detailName: 'A nom de',
  detailDate: 'Dia',
  detailTime: 'Hora',
  detailParty: 'Persones',
  detailZone: 'Zona',
  detailNotes: 'Notes',
  changeUntil: (date, time) => `La pots canviar o cancel·lar fins al ${date} a les ${time}.`,
  modifyTitle: 'Canviar la reserva',
  saveChanges: 'Desar els canvis',
  cancelBooking: 'Cancel·lar la reserva',
  cancelQuestion: 'Segur que vols cancel·lar la reserva?',
  cancelYes: 'Sí, cancel·la-la',
  cancelNo: 'No, mantén-la',
  cancelledNotice: 'Reserva cancel·lada. T’hem enviat un correu.',
  modifiedNotice: 'Canvis desats. T’hem enviat un correu.',
  callToChange: (phone) => `Per canviar alguna cosa, truca al restaurant: ${phone}.`,
  contactToChange: 'Per canviar alguna cosa, posa’t en contacte amb el restaurant.',
  notFoundTitle: 'No trobem aquesta reserva',
  notFoundText: 'Revisa l’enllaç del correu o posa’t en contacte amb el restaurant.',
  privacyTitle: 'Política de privadesa',
  emails: {
    subject: {
      customer_pending: (r) => `Hem rebut la teva sol·licitud a ${r}`,
      customer_confirmed: (r) => `Reserva confirmada a ${r}`,
      customer_modified: (r) => `La teva reserva a ${r} ha canviat`,
      customer_cancelled: (r) => `Reserva cancel·lada a ${r}`,
      customer_rejected: (r) => `${r} no pot confirmar la teva reserva`,
      customer_reminder: (r) => `T’esperem a ${r}`,
    },
    heading: {
      customer_pending: 'Sol·licitud rebuda',
      customer_confirmed: 'Reserva confirmada',
      customer_modified: 'Reserva modificada',
      customer_cancelled: 'Reserva cancel·lada',
      customer_rejected: 'Reserva no confirmada',
      customer_reminder: 'T’esperem',
    },
    intro: {
      customer_pending: 'El restaurant revisarà la teva sol·licitud i t’escriurem tan bon punt la confirmi.',
      customer_confirmed: 'Tot a punt. Aquestes són les dades de la teva reserva:',
      customer_modified: 'Hem desat els canvis. Així queda la teva reserva:',
      customer_cancelled: 'La teva reserva està cancel·lada. Si vols, en pots fer una altra quan vulguis.',
      customer_rejected: 'Ho sentim: el restaurant no et pot atendre aquella data. Si vols, truca-hi per buscar una altra hora.',
      customer_reminder: 'Et recordem la teva reserva:',
    },
    stillPending: 'Queda pendent que el restaurant la confirmi.',
    manage: 'Gestionar la meva reserva',
    directions: 'Com arribar-hi',
    callUs: (phone) => `Telèfon del restaurant: ${phone}`,
    calendarNote: 'T’adjuntem la reserva perquè l’afegeixis al teu calendari.',
    icsTitle: (r) => `Reserva a ${r}`,
  },
};
````

Crea `src/lib/i18n/booking/fr.ts`:

````ts
import type { BookingMessages } from './types';

export const fr: BookingMessages = {
  book: 'Réserver',
  bookTitle: (r) => `Réserver chez ${r}`,
  bookIntro: 'Choisissez le nombre de personnes, le jour et l’heure.',
  partyLabel: 'Personnes',
  partyOption: (n) => (n === 1 ? '1 personne' : `${n} personnes`),
  groupNotice: (max) => `Pour les groupes de plus de ${max} personnes, nous envoyons une demande au restaurant.`,
  dateLabel: 'Jour',
  prevMonth: 'Mois précédent',
  nextMonth: 'Mois suivant',
  dayUnavailable: 'indisponible',
  timeLabel: 'Heure',
  pickDayFirst: 'Choisissez un jour pour voir les horaires.',
  loadingTimes: 'Recherche des horaires libres…',
  noTimes: 'Il ne reste aucun horaire libre ce jour-là. Essayez un autre jour.',
  timeTaken: 'complet',
  zoneLabel: 'Zone',
  anyZone: 'Peu importe',
  detailsTitle: 'Vos coordonnées',
  name: 'Nom',
  email: 'E-mail',
  emailHint: 'Nous y enverrons la confirmation et le lien pour la modifier.',
  phone: 'Téléphone',
  phoneHint: 'Si ce n’est pas un numéro espagnol, commencez par + et l’indicatif.',
  notes: 'Remarques (facultatif)',
  notesHint: 'Allergies, une chaise haute, une célébration…',
  privacyInfo: (holder) =>
    `Responsable : ${holder}. Finalité : gérer votre réservation. Vous pouvez accéder à vos données, les rectifier ou demander leur effacement, entre autres droits.`,
  privacyAccept: 'J’ai lu les informations sur la confidentialité et je les accepte.',
  privacyLink: 'Politique de confidentialité',
  marketing: (r) => `Je souhaite recevoir les actualités et offres de ${r} (facultatif).`,
  securityCheck: 'Contrôle de sécurité',
  submit: 'Réserver',
  submitRequest: 'Envoyer la demande',
  sending: 'Envoi…',
  summary: (date, time, party) => `${date} · ${time} · ${party}`,
  confirmedTitle: 'Réservation confirmée',
  confirmedText: 'À bientôt !',
  pendingTitle: 'Demande envoyée',
  pendingText: 'Le restaurant va l’examiner et nous vous préviendrons par e-mail.',
  emailSent: (email) => `Nous vous avons envoyé un e-mail à ${email}.`,
  alternatives: 'Horaires les plus proches',
  noAlternatives: 'Il n’y a pas d’horaire proche. Essayez un autre jour.',
  errors: {
    slotTaken: 'Oups, cet horaire vient d’être pris. Voici les plus proches.',
    unavailable: 'Cet horaire ne peut plus être réservé. Choisissez-en un autre.',
    changeClosed: 'Elle ne peut plus être modifiée ni annulée en ligne.',
    tooMany: 'Vous avez fait trop de tentatives. Attendez quelques minutes et réessayez.',
    turnstile: 'Nous n’avons pas pu vérifier que vous n’êtes pas un robot. Réessayez.',
    turnstileMissing: 'La réservation en ligne n’est pas disponible pour le moment. Appelez le restaurant, s’il vous plaît.',
    bookingClosed: 'Ce restaurant n’accepte pas de réservations en ligne pour le moment.',
    notFound: 'Nous ne trouvons pas cette réservation.',
    generic: 'Une erreur s’est produite. Réessayez dans un instant.',
  },
  fields: {
    nameRequired: 'Indiquez votre nom.',
    nameTooLong: '120 caractères maximum.',
    emailInvalid: 'Cet e-mail ne semble pas correct.',
    phoneRequired: 'Indiquez un téléphone de contact.',
    phoneInvalid: 'Ce numéro ne semble pas correct. S’il n’est pas espagnol, commencez par + et l’indicatif.',
    notesTooLong: '500 caractères maximum.',
    privacyRequired: 'Pour réserver, vous devez accepter les informations sur la confidentialité.',
    partyInvalid: 'Choisissez le nombre de personnes.',
    pickDate: 'Choisissez un jour.',
    pickTime: 'Choisissez une heure.',
  },
  phoneOnlyTitle: 'Réservation par téléphone',
  phoneOnlyText: 'Ce restaurant prend les réservations par téléphone :',
  phoneOnlyNoPhone: 'Ce restaurant n’accepte pas de réservations en ligne. Contactez-le pour réserver.',
  manageTitle: 'Votre réservation',
  status: {
    pending: 'En attente de confirmation',
    confirmed: 'Confirmée',
    seated: 'À table',
    completed: 'Terminée',
    cancelled_customer: 'Annulée',
    cancelled_restaurant: 'Annulée par le restaurant',
    rejected: 'Non confirmée',
    no_show: 'Terminée',
  },
  detailName: 'Au nom de',
  detailDate: 'Jour',
  detailTime: 'Heure',
  detailParty: 'Personnes',
  detailZone: 'Zone',
  detailNotes: 'Remarques',
  changeUntil: (date, time) => `Vous pouvez la modifier ou l’annuler jusqu’au ${date} à ${time}.`,
  modifyTitle: 'Modifier la réservation',
  saveChanges: 'Enregistrer les modifications',
  cancelBooking: 'Annuler la réservation',
  cancelQuestion: 'Voulez-vous vraiment annuler la réservation ?',
  cancelYes: 'Oui, l’annuler',
  cancelNo: 'Non, la garder',
  cancelledNotice: 'Réservation annulée. Nous vous avons envoyé un e-mail.',
  modifiedNotice: 'Modifications enregistrées. Nous vous avons envoyé un e-mail.',
  callToChange: (phone) => `Pour toute modification, appelez le restaurant : ${phone}.`,
  contactToChange: 'Pour toute modification, contactez le restaurant.',
  notFoundTitle: 'Nous ne trouvons pas cette réservation',
  notFoundText: 'Vérifiez le lien de l’e-mail ou contactez le restaurant.',
  privacyTitle: 'Politique de confidentialité',
  emails: {
    subject: {
      customer_pending: (r) => `Nous avons reçu votre demande chez ${r}`,
      customer_confirmed: (r) => `Réservation confirmée chez ${r}`,
      customer_modified: (r) => `Votre réservation chez ${r} a changé`,
      customer_cancelled: (r) => `Réservation annulée chez ${r}`,
      customer_rejected: (r) => `${r} ne peut pas confirmer votre réservation`,
      customer_reminder: (r) => `À bientôt chez ${r}`,
    },
    heading: {
      customer_pending: 'Demande reçue',
      customer_confirmed: 'Réservation confirmée',
      customer_modified: 'Réservation modifiée',
      customer_cancelled: 'Réservation annulée',
      customer_rejected: 'Réservation non confirmée',
      customer_reminder: 'À bientôt',
    },
    intro: {
      customer_pending: 'Le restaurant va examiner votre demande et nous vous écrirons dès qu’il l’aura confirmée.',
      customer_confirmed: 'Tout est prêt. Voici les détails de votre réservation :',
      customer_modified: 'Nous avons enregistré les modifications. Voici votre réservation :',
      customer_cancelled: 'Votre réservation est annulée. Vous pouvez en faire une autre quand vous le souhaitez.',
      customer_rejected: 'Désolés : le restaurant ne peut pas vous recevoir à cette date. Vous pouvez l’appeler pour trouver un autre horaire.',
      customer_reminder: 'Petit rappel de votre réservation :',
    },
    stillPending: 'Elle attend la confirmation du restaurant.',
    manage: 'Gérer ma réservation',
    directions: 'Itinéraire',
    callUs: (phone) => `Téléphone du restaurant : ${phone}`,
    calendarNote: 'Nous joignons la réservation pour que vous l’ajoutiez à votre agenda.',
    icsTitle: (r) => `Réservation chez ${r}`,
  },
};
````

Crea `src/lib/i18n/booking/de.ts`:

````ts
import type { BookingMessages } from './types';

export const de: BookingMessages = {
  book: 'Reservieren',
  bookTitle: (r) => `Tisch reservieren bei ${r}`,
  bookIntro: 'Wählen Sie die Personenzahl, den Tag und die Uhrzeit.',
  partyLabel: 'Personen',
  partyOption: (n) => (n === 1 ? '1 Person' : `${n} Personen`),
  groupNotice: (max) => `Für Gruppen mit mehr als ${max} Personen senden wir eine Anfrage an das Restaurant.`,
  dateLabel: 'Tag',
  prevMonth: 'Vorheriger Monat',
  nextMonth: 'Nächster Monat',
  dayUnavailable: 'nicht verfügbar',
  timeLabel: 'Uhrzeit',
  pickDayFirst: 'Wählen Sie einen Tag, um die Uhrzeiten zu sehen.',
  loadingTimes: 'Freie Uhrzeiten werden gesucht…',
  noTimes: 'An diesem Tag ist keine Uhrzeit mehr frei. Versuchen Sie einen anderen Tag.',
  timeTaken: 'ausgebucht',
  zoneLabel: 'Bereich',
  anyZone: 'Egal',
  detailsTitle: 'Ihre Angaben',
  name: 'Name',
  email: 'E-Mail',
  emailHint: 'Hierhin senden wir die Bestätigung und den Link zum Ändern.',
  phone: 'Telefon',
  phoneHint: 'Wenn es keine spanische Nummer ist, beginnen Sie mit + und der Ländervorwahl.',
  notes: 'Anmerkungen (optional)',
  notesHint: 'Allergien, ein Kinderstuhl, ein Anlass…',
  privacyInfo: (holder) =>
    `Verantwortlich: ${holder}. Zweck: Verwaltung Ihrer Reservierung. Sie können u. a. Auskunft, Berichtigung oder Löschung Ihrer Daten verlangen.`,
  privacyAccept: 'Ich habe die Datenschutzhinweise gelesen und akzeptiere sie.',
  privacyLink: 'Datenschutzerklärung',
  marketing: (r) => `Ich möchte Neuigkeiten und Angebote von ${r} erhalten (optional).`,
  securityCheck: 'Sicherheitsprüfung',
  submit: 'Reservieren',
  submitRequest: 'Anfrage senden',
  sending: 'Wird gesendet…',
  summary: (date, time, party) => `${date} · ${time} · ${party}`,
  confirmedTitle: 'Reservierung bestätigt',
  confirmedText: 'Wir freuen uns auf Sie!',
  pendingTitle: 'Anfrage gesendet',
  pendingText: 'Das Restaurant prüft sie und wir benachrichtigen Sie per E-Mail.',
  emailSent: (email) => `Wir haben Ihnen eine E-Mail an ${email} gesendet.`,
  alternatives: 'Nächstgelegene Uhrzeiten',
  noAlternatives: 'In der Nähe ist keine Uhrzeit frei. Versuchen Sie einen anderen Tag.',
  errors: {
    slotTaken: 'Diese Uhrzeit wurde gerade vergeben. Hier sind die nächstgelegenen.',
    unavailable: 'Diese Uhrzeit kann nicht mehr reserviert werden. Wählen Sie eine andere.',
    changeClosed: 'Sie kann online nicht mehr geändert oder storniert werden.',
    tooMany: 'Sie haben es zu oft versucht. Warten Sie ein paar Minuten und versuchen Sie es erneut.',
    turnstile: 'Wir konnten nicht prüfen, dass Sie kein Roboter sind. Bitte versuchen Sie es erneut.',
    turnstileMissing: 'Online-Reservierungen sind gerade nicht möglich. Bitte rufen Sie das Restaurant an.',
    bookingClosed: 'Dieses Restaurant nimmt gerade keine Online-Reservierungen an.',
    notFound: 'Wir finden diese Reservierung nicht.',
    generic: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es gleich noch einmal.',
  },
  fields: {
    nameRequired: 'Geben Sie Ihren Namen ein.',
    nameTooLong: 'Höchstens 120 Zeichen.',
    emailInvalid: 'Diese E-Mail-Adresse scheint nicht richtig zu sein.',
    phoneRequired: 'Geben Sie eine Telefonnummer an.',
    phoneInvalid: 'Diese Telefonnummer scheint nicht richtig zu sein. Wenn sie nicht spanisch ist, beginnen Sie mit + und der Vorwahl.',
    notesTooLong: 'Höchstens 500 Zeichen.',
    privacyRequired: 'Zum Reservieren müssen Sie die Datenschutzhinweise akzeptieren.',
    partyInvalid: 'Wählen Sie die Personenzahl.',
    pickDate: 'Wählen Sie einen Tag.',
    pickTime: 'Wählen Sie eine Uhrzeit.',
  },
  phoneOnlyTitle: 'Reservierung per Telefon',
  phoneOnlyText: 'Dieses Restaurant nimmt Reservierungen per Telefon an:',
  phoneOnlyNoPhone: 'Dieses Restaurant nimmt keine Online-Reservierungen an. Bitte kontaktieren Sie es zum Reservieren.',
  manageTitle: 'Ihre Reservierung',
  status: {
    pending: 'Wartet auf Bestätigung',
    confirmed: 'Bestätigt',
    seated: 'Am Tisch',
    completed: 'Abgeschlossen',
    cancelled_customer: 'Storniert',
    cancelled_restaurant: 'Vom Restaurant storniert',
    rejected: 'Nicht bestätigt',
    no_show: 'Abgeschlossen',
  },
  detailName: 'Auf den Namen',
  detailDate: 'Tag',
  detailTime: 'Uhrzeit',
  detailParty: 'Personen',
  detailZone: 'Bereich',
  detailNotes: 'Anmerkungen',
  changeUntil: (date, time) => `Sie können sie bis ${date} um ${time} ändern oder stornieren.`,
  modifyTitle: 'Reservierung ändern',
  saveChanges: 'Änderungen speichern',
  cancelBooking: 'Reservierung stornieren',
  cancelQuestion: 'Möchten Sie die Reservierung wirklich stornieren?',
  cancelYes: 'Ja, stornieren',
  cancelNo: 'Nein, behalten',
  cancelledNotice: 'Reservierung storniert. Wir haben Ihnen eine E-Mail gesendet.',
  modifiedNotice: 'Änderungen gespeichert. Wir haben Ihnen eine E-Mail gesendet.',
  callToChange: (phone) => `Für Änderungen rufen Sie bitte das Restaurant an: ${phone}.`,
  contactToChange: 'Für Änderungen kontaktieren Sie bitte das Restaurant.',
  notFoundTitle: 'Wir finden diese Reservierung nicht',
  notFoundText: 'Prüfen Sie den Link in der E-Mail oder kontaktieren Sie das Restaurant.',
  privacyTitle: 'Datenschutzerklärung',
  emails: {
    subject: {
      customer_pending: (r) => `Wir haben Ihre Anfrage bei ${r} erhalten`,
      customer_confirmed: (r) => `Reservierung bei ${r} bestätigt`,
      customer_modified: (r) => `Ihre Reservierung bei ${r} wurde geändert`,
      customer_cancelled: (r) => `Reservierung bei ${r} storniert`,
      customer_rejected: (r) => `${r} kann Ihre Reservierung nicht bestätigen`,
      customer_reminder: (r) => `Bis bald bei ${r}`,
    },
    heading: {
      customer_pending: 'Anfrage erhalten',
      customer_confirmed: 'Reservierung bestätigt',
      customer_modified: 'Reservierung geändert',
      customer_cancelled: 'Reservierung storniert',
      customer_rejected: 'Reservierung nicht bestätigt',
      customer_reminder: 'Bis bald',
    },
    intro: {
      customer_pending: 'Das Restaurant prüft Ihre Anfrage und wir schreiben Ihnen, sobald sie bestätigt ist.',
      customer_confirmed: 'Alles bereit. Das sind die Details Ihrer Reservierung:',
      customer_modified: 'Wir haben die Änderungen gespeichert. So sieht Ihre Reservierung jetzt aus:',
      customer_cancelled: 'Ihre Reservierung ist storniert. Sie können jederzeit eine neue machen.',
      customer_rejected: 'Leider kann das Restaurant Sie an diesem Datum nicht empfangen. Rufen Sie es gern an, um eine andere Uhrzeit zu finden.',
      customer_reminder: 'Eine Erinnerung an Ihre Reservierung:',
    },
    stillPending: 'Sie wartet auf die Bestätigung des Restaurants.',
    manage: 'Meine Reservierung verwalten',
    directions: 'Route planen',
    callUs: (phone) => `Telefon des Restaurants: ${phone}`,
    calendarNote: 'Im Anhang finden Sie die Reservierung für Ihren Kalender.',
    icsTitle: (r) => `Reservierung bei ${r}`,
  },
};
````

Crea `src/lib/i18n/booking/it.ts`:

````ts
import type { BookingMessages } from './types';

export const it: BookingMessages = {
  book: 'Prenota',
  bookTitle: (r) => `Prenota da ${r}`,
  bookIntro: 'Scegli quanti siete, il giorno e l’ora.',
  partyLabel: 'Persone',
  partyOption: (n) => (n === 1 ? '1 persona' : `${n} persone`),
  groupNotice: (max) => `Per i gruppi di più di ${max} persone inviamo una richiesta al ristorante.`,
  dateLabel: 'Giorno',
  prevMonth: 'Mese precedente',
  nextMonth: 'Mese successivo',
  dayUnavailable: 'non disponibile',
  timeLabel: 'Ora',
  pickDayFirst: 'Scegli un giorno per vedere gli orari.',
  loadingTimes: 'Cerchiamo gli orari liberi…',
  noTimes: 'Quel giorno non resta nessun orario libero. Prova un altro giorno.',
  timeTaken: 'al completo',
  zoneLabel: 'Zona',
  anyZone: 'Indifferente',
  detailsTitle: 'I tuoi dati',
  name: 'Nome',
  email: 'Email',
  emailHint: 'Qui ti invieremo la conferma e il link per modificarla.',
  phone: 'Telefono',
  phoneHint: 'Se non è un numero spagnolo, inizia con + e il prefisso.',
  notes: 'Note (facoltative)',
  notesHint: 'Allergie, un seggiolone, una festa…',
  privacyInfo: (holder) =>
    `Titolare: ${holder}. Finalità: gestire la tua prenotazione. Puoi accedere ai tuoi dati, correggerli o chiederne la cancellazione, tra gli altri diritti.`,
  privacyAccept: 'Ho letto l’informativa sulla privacy e la accetto.',
  privacyLink: 'Informativa sulla privacy',
  marketing: (r) => `Voglio ricevere novità e offerte di ${r} (facoltativo).`,
  securityCheck: 'Controllo di sicurezza',
  submit: 'Prenota',
  submitRequest: 'Invia la richiesta',
  sending: 'Invio in corso…',
  summary: (date, time, party) => `${date} · ${time} · ${party}`,
  confirmedTitle: 'Prenotazione confermata',
  confirmedText: 'Ti aspettiamo!',
  pendingTitle: 'Richiesta inviata',
  pendingText: 'Il ristorante la valuterà e ti avviseremo via email.',
  emailSent: (email) => `Ti abbiamo inviato un’email a ${email}.`,
  alternatives: 'Orari più vicini',
  noAlternatives: 'Non ci sono orari vicini. Prova un altro giorno.',
  errors: {
    slotTaken: 'Peccato, quell’orario è appena stato preso. Ecco i più vicini.',
    unavailable: 'Quell’orario non si può più prenotare. Scegline un altro.',
    changeClosed: 'Non si può più modificare né annullare online.',
    tooMany: 'Hai fatto troppi tentativi. Aspetta qualche minuto e riprova.',
    turnstile: 'Non siamo riusciti a verificare che non sei un robot. Riprova.',
    turnstileMissing: 'Al momento non si può prenotare online. Chiama il ristorante, per favore.',
    bookingClosed: 'Questo ristorante al momento non accetta prenotazioni online.',
    notFound: 'Non troviamo questa prenotazione.',
    generic: 'Qualcosa è andato storto. Riprova tra un momento.',
  },
  fields: {
    nameRequired: 'Scrivi il tuo nome.',
    nameTooLong: 'Al massimo 120 caratteri.',
    emailInvalid: 'Questa email non sembra corretta.',
    phoneRequired: 'Scrivi un telefono di contatto.',
    phoneInvalid: 'Questo telefono non sembra corretto. Se non è spagnolo, inizia con + e il prefisso.',
    notesTooLong: 'Al massimo 500 caratteri.',
    privacyRequired: 'Per prenotare devi accettare l’informativa sulla privacy.',
    partyInvalid: 'Scegli quante persone siete.',
    pickDate: 'Scegli un giorno.',
    pickTime: 'Scegli un orario.',
  },
  phoneOnlyTitle: 'Prenotazione per telefono',
  phoneOnlyText: 'Questo ristorante accetta prenotazioni per telefono:',
  phoneOnlyNoPhone: 'Questo ristorante non accetta prenotazioni online. Contattalo per prenotare.',
  manageTitle: 'La tua prenotazione',
  status: {
    pending: 'In attesa di conferma',
    confirmed: 'Confermata',
    seated: 'Al tavolo',
    completed: 'Conclusa',
    cancelled_customer: 'Annullata',
    cancelled_restaurant: 'Annullata dal ristorante',
    rejected: 'Non confermata',
    no_show: 'Conclusa',
  },
  detailName: 'A nome di',
  detailDate: 'Giorno',
  detailTime: 'Ora',
  detailParty: 'Persone',
  detailZone: 'Zona',
  detailNotes: 'Note',
  changeUntil: (date, time) => `Puoi modificarla o annullarla fino al ${date} alle ${time}.`,
  modifyTitle: 'Modifica la prenotazione',
  saveChanges: 'Salva le modifiche',
  cancelBooking: 'Annulla la prenotazione',
  cancelQuestion: 'Vuoi davvero annullare la prenotazione?',
  cancelYes: 'Sì, annullala',
  cancelNo: 'No, mantienila',
  cancelledNotice: 'Prenotazione annullata. Ti abbiamo inviato un’email.',
  modifiedNotice: 'Modifiche salvate. Ti abbiamo inviato un’email.',
  callToChange: (phone) => `Per modificare qualcosa, chiama il ristorante: ${phone}.`,
  contactToChange: 'Per modificare qualcosa, contatta il ristorante.',
  notFoundTitle: 'Non troviamo questa prenotazione',
  notFoundText: 'Controlla il link dell’email o contatta il ristorante.',
  privacyTitle: 'Informativa sulla privacy',
  emails: {
    subject: {
      customer_pending: (r) => `Abbiamo ricevuto la tua richiesta da ${r}`,
      customer_confirmed: (r) => `Prenotazione confermata da ${r}`,
      customer_modified: (r) => `La tua prenotazione da ${r} è cambiata`,
      customer_cancelled: (r) => `Prenotazione annullata da ${r}`,
      customer_rejected: (r) => `${r} non può confermare la tua prenotazione`,
      customer_reminder: (r) => `Ti aspettiamo da ${r}`,
    },
    heading: {
      customer_pending: 'Richiesta ricevuta',
      customer_confirmed: 'Prenotazione confermata',
      customer_modified: 'Prenotazione modificata',
      customer_cancelled: 'Prenotazione annullata',
      customer_rejected: 'Prenotazione non confermata',
      customer_reminder: 'Ti aspettiamo',
    },
    intro: {
      customer_pending: 'Il ristorante valuterà la tua richiesta e ti scriveremo appena la conferma.',
      customer_confirmed: 'Tutto pronto. Ecco i dati della tua prenotazione:',
      customer_modified: 'Abbiamo salvato le modifiche. Ecco la tua prenotazione:',
      customer_cancelled: 'La tua prenotazione è annullata. Puoi farne un’altra quando vuoi.',
      customer_rejected: 'Ci dispiace: il ristorante non può accoglierti in quella data. Se vuoi, chiamalo per trovare un altro orario.',
      customer_reminder: 'Ti ricordiamo la tua prenotazione:',
    },
    stillPending: 'È in attesa della conferma del ristorante.',
    manage: 'Gestisci la mia prenotazione',
    directions: 'Come arrivare',
    callUs: (phone) => `Telefono del ristorante: ${phone}`,
    calendarNote: 'Ti alleghiamo la prenotazione da aggiungere al tuo calendario.',
    icsTitle: (r) => `Prenotazione da ${r}`,
  },
};
````

Crea `src/lib/i18n/booking/index.ts`:

````ts
import type { Locale } from '@/lib/i18n/locales';
import { ca } from './ca';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import type { BookingMessages } from './types';

export type { BookingError, BookingFieldError, BookingMessages } from './types';
export { BOOKING_ERRORS, BOOKING_FIELD_ERRORS } from './types';

export const BOOKING_MESSAGES: Record<Locale, BookingMessages> = { es, en, ca, fr, de, it };

export function getBookingMessages(locale: Locale): BookingMessages {
  return BOOKING_MESSAGES[locale];
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/i18n`
Expected: PASS: 2 pruebas nuevas (seis idiomas con las mismas claves y sin textos vacíos; los textos de las decisiones en castellano).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/booking/types.ts src/lib/i18n/booking/es.ts src/lib/i18n/booking/en.ts src/lib/i18n/booking/ca.ts src/lib/i18n/booking/fr.ts src/lib/i18n/booking/de.ts src/lib/i18n/booking/it.ts src/lib/i18n/booking/index.ts src/lib/i18n/booking/messages.test.ts
git commit -m "Textos de la reserva online y de los emails al comensal en los seis idiomas"
```

---

### Task 11: Plantillas de React Email: comensal (6 idiomas, marca del restaurante) y restaurante (castellano, FByte)

**Files:**
- Create: `src/lib/email/templates/CustomerBookingEmail.tsx`
- Create: `src/lib/email/templates/RestaurantBookingEmail.tsx`
- Create (prueba): `src/lib/email/templates/BookingEmails.test.tsx`

**Interfaces:**
- Consumes: `getBookingMessages` (tarea 10), `capitalize`, `formatLongDate` (tarea 8), `CustomerEmailKind`, `RestaurantEmailKind`, `EMAIL_KINDS`, `isCustomerKind` (tarea 1), `publicAccentTheme`, `getMessages(locale).poweredBy/logoAlt`, `formatTime`, `formatPhone`, `formatPhoneDisplay`, `customerWarnings`, `STATUS_LABELS_ES`, `LOCALE_LABELS_ES`, `BRAND`.
- Produces:
  - `src/lib/email/templates/CustomerBookingEmail.tsx`: `type CustomerEmailProps = { kind, locale, restaurant: { name, accentColor, logoUrl, address, phone, directionsUrl }, reservation: { customerName, status, startMs, partySize, zoneName, notes, timeZone }, manageUrl, withCalendar }`, `customerEmailSubject(kind, locale, restaurantName)` y `CustomerBookingEmail(props)`.
  - `src/lib/email/templates/RestaurantBookingEmail.tsx`: `type RestaurantEmailProps = { kind, restaurantName, panelUrl, reservation: { status, startMs, partySize, zoneName, notes, locale, timeZone }, customer: CustomerSummary | null }`, `restaurantEmailSubject(props)` y `RestaurantBookingEmail(props)`.

Lee antes `src/lib/email/templates/InvitationEmail.tsx` y su prueba (`render` de `@react-email/components`).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/email/templates/BookingEmails.test.tsx`:

````tsx
import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, isCustomerKind, type CustomerEmailKind, type RestaurantEmailKind } from '@/lib/email/outbox-rules';
import { getBookingMessages } from '@/lib/i18n/booking';
import { LOCALES } from '@/lib/i18n/locales';
import { CustomerBookingEmail, customerEmailSubject, type CustomerEmailProps } from './CustomerBookingEmail';
import { RestaurantBookingEmail, restaurantEmailSubject, type RestaurantEmailProps } from './RestaurantBookingEmail';

const START = Date.parse('2030-06-14T19:00:00Z');
const customerKinds = EMAIL_KINDS.filter(isCustomerKind) as CustomerEmailKind[];
const restaurantKinds = EMAIL_KINDS.filter((k) => !isCustomerKind(k)) as RestaurantEmailKind[];

const customerProps = (kind: CustomerEmailKind, locale: (typeof LOCALES)[number]): CustomerEmailProps => ({
  kind,
  locale,
  restaurant: {
    name: 'La Taberna',
    accentColor: '#17317F',
    logoUrl: 'https://cdn.test/logo.webp',
    address: 'Calle Mayor 1, 28013 Madrid',
    phone: '910000000',
    directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Calle%20Mayor%201',
  },
  reservation: {
    customerName: 'Ana García',
    status: kind === 'customer_pending' ? 'pending' : kind === 'customer_cancelled' ? 'cancelled_customer' : kind === 'customer_rejected' ? 'rejected' : 'confirmed',
    startMs: START,
    partySize: 2,
    zoneName: 'Terraza',
    notes: 'Trona',
    timeZone: 'Europe/Madrid',
  },
  manageUrl: 'https://mesa.test/la-taberna/reserva/TOKEN?lang=es',
  withCalendar: kind === 'customer_confirmed',
});

describe('emails al comensal', () => {
  it('se pintan en los seis idiomas y en los seis tipos, con asunto, datos, enlaces y pie', async () => {
    for (const locale of LOCALES) {
      const m = getBookingMessages(locale);
      for (const kind of customerKinds) {
        const props = customerProps(kind, locale);
        const html = await render(<CustomerBookingEmail {...props} />);
        const where = `${locale} ${kind}`;
        expect(customerEmailSubject(kind, locale, 'La Taberna'), where).toContain('La Taberna');
        expect(html, where).toContain(`lang="${locale}"`);
        expect(html, where).toContain(m.emails.heading[kind]);
        expect(html, where).toContain('21:00');
        expect(html, where).toContain('Terraza');
        expect(html, where).toContain('https://www.google.com/maps/dir/');
        expect(html, where).toContain('tel:910000000');
        expect(html, where).toContain('FByte Solutions');
        const active = props.reservation.status === 'pending' || props.reservation.status === 'confirmed';
        expect(html.includes('https://mesa.test/la-taberna/reserva/TOKEN?lang=es'), where).toBe(active);
      }
    }
  });

  it('en castellano: «Gestionar mi reserva», «Cómo llegar» y el aviso del calendario solo si lleva .ics', async () => {
    const html = await render(<CustomerBookingEmail {...customerProps('customer_confirmed', 'es')} />);
    expect(html).toContain('Gestionar mi reserva');
    expect(html).toContain('Cómo llegar');
    expect(html).toContain('Viernes, 14 de junio de 2030');
    expect(html).toContain('Te adjuntamos la reserva');
    const cancelled = await render(<CustomerBookingEmail {...customerProps('customer_cancelled', 'es')} />);
    expect(cancelled).not.toContain('Te adjuntamos la reserva');
  });

  it('una modificación que queda pendiente lo dice', async () => {
    const props = customerProps('customer_modified', 'es');
    const html = await render(<CustomerBookingEmail {...props} reservation={{ ...props.reservation, status: 'pending' }} />);
    expect(html).toContain('Queda pendiente de que el restaurante la confirme.');
  });
});

describe('avisos al restaurante', () => {
  const props = (kind: RestaurantEmailKind): RestaurantEmailProps => ({
    kind,
    restaurantName: 'La Taberna',
    panelUrl: 'https://mesa.test/panel/r1/reservas/res1',
    reservation: { status: 'confirmed', startMs: START, partySize: 2, zoneName: null, notes: 'Trona', locale: 'en', timeZone: 'Europe/Madrid' },
    customer: { id: 'c1', name: 'Ana García', phone: '+34612345678', email: 'ana@example.com', tags: ['vip'], visitsCount: 0, noShowCount: 2, cancelCount: 0 },
  });

  it('en castellano, con los datos, los avisos del cliente y el botón al panel', async () => {
    for (const kind of restaurantKinds) {
      const html = await render(<RestaurantBookingEmail {...props(kind)} />);
      expect(html, kind).toContain('lang="es"');
      expect(html, kind).toContain('Ana García');
      expect(html, kind).toContain('612 34 56 78');
      expect(html, kind).toContain('2 no-shows');
      expect(html, kind).toContain('Inglés');
      expect(html, kind).toContain('Sin mesa asignada');
      expect(html, kind).toContain('https://mesa.test/panel/r1/reservas/res1');
      expect(html, kind).toContain('Abrir en el panel');
    }
    expect(restaurantEmailSubject(props('restaurant_new'))).toBe('Nueva reserva online: Ana García, Viernes, 14 de junio a las 21:00 (2 personas)');
    expect(restaurantEmailSubject(props('restaurant_cancelled'))).toMatch(/^El cliente ha cancelado su reserva: Ana García/);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/email/templates`
Expected: FAIL: `Failed to resolve import "./CustomerBookingEmail"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/email/templates/CustomerBookingEmail.tsx`:

````tsx
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from '@react-email/components';
import { BRAND } from '@/config/brand';
import { capitalize, formatLongDate } from '@/lib/booking/format';
import { publicAccentTheme } from '@/lib/color';
import type { CustomerEmailKind } from '@/lib/email/outbox-rules';
import { getBookingMessages } from '@/lib/i18n/booking';
import type { Locale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import type { ReservationStatus } from '@/lib/reservations/codes';
import { formatTime } from '@/lib/reservations/time';
import { formatPhone } from '@/lib/spain';

export type CustomerEmailProps = {
  kind: CustomerEmailKind;
  locale: Locale;
  restaurant: {
    name: string;
    accentColor: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    directionsUrl: string | null;
  };
  reservation: {
    customerName: string | null;
    status: ReservationStatus;
    startMs: number;
    partySize: number;
    zoneName: string | null;
    notes: string | null;
    timeZone: string;
  };
  /** Enlace para ver, cambiar o cancelar (null si no se pudo generar). */
  manageUrl: string | null;
  /** Va con el .ics adjunto. */
  withCalendar: boolean;
};

export function customerEmailSubject(kind: CustomerEmailKind, locale: Locale, restaurantName: string): string {
  return getBookingMessages(locale).emails.subject[kind](restaurantName);
}

const text = { fontSize: 16, lineHeight: '24px', margin: '0 0 12px' };
const small = { fontSize: 13, lineHeight: '20px', color: '#525252', margin: '0 0 8px' };
const label = { fontSize: 13, color: '#525252', margin: 0 };
const value = { fontSize: 16, fontWeight: 700, margin: '0 0 10px' };

/** Email al comensal, en el idioma de su reserva y con la marca del restaurante. */
export function CustomerBookingEmail({ kind, locale, restaurant, reservation, manageUrl, withCalendar }: CustomerEmailProps) {
  const m = getBookingMessages(locale);
  const pub = getMessages(locale);
  const theme = publicAccentTheme(restaurant.accentColor);
  const date = capitalize(formatLongDate(reservation.startMs, locale, reservation.timeZone));
  const time = formatTime(reservation.startMs, reservation.timeZone);
  const active = reservation.status === 'pending' || reservation.status === 'confirmed';
  const details: [string, string][] = [
    ...(reservation.customerName ? [[m.detailName, reservation.customerName] as [string, string]] : []),
    [m.detailDate, date],
    [m.detailTime, time],
    [m.detailParty, m.partyOption(reservation.partySize)],
    ...(reservation.zoneName ? [[m.detailZone, reservation.zoneName] as [string, string]] : []),
    ...(reservation.notes ? [[m.detailNotes, reservation.notes] as [string, string]] : []),
  ];
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{`${m.emails.heading[kind]} · ${restaurant.name} · ${date} · ${time}`}</Preview>
      <Body style={{ backgroundColor: '#F5F5F5', color: '#171717', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: '24px', backgroundColor: '#FFFFFF' }}>
          <Section style={{ borderTop: `6px solid ${theme.accent}`, paddingTop: 16 }}>
            {restaurant.logoUrl && <Img src={restaurant.logoUrl} alt={pub.logoAlt(restaurant.name)} width={64} height={64} style={{ objectFit: 'contain' }} />}
            <Text style={{ fontSize: 18, fontWeight: 700, margin: '8px 0 0' }}>{restaurant.name}</Text>
          </Section>
          <Heading as="h1" style={{ fontSize: 26, lineHeight: '32px', margin: '20px 0 12px', color: theme.accentText }}>
            {m.emails.heading[kind]}
          </Heading>
          <Text style={text}>{m.emails.intro[kind]}</Text>
          {kind === 'customer_modified' && reservation.status === 'pending' && <Text style={text}>{m.emails.stillPending}</Text>}
          <Section style={{ margin: '16px 0', padding: '16px', border: '1px solid #E5E5E5', borderRadius: 8 }}>
            {details.map(([k, v]) => (
              <div key={k}>
                <Text style={label}>{k}</Text>
                <Text style={value}>{v}</Text>
              </div>
            ))}
          </Section>
          {manageUrl && active && (
            <Section style={{ margin: '24px 0' }}>
              <Button
                href={manageUrl}
                style={{ backgroundColor: theme.accent, color: theme.onAccent, padding: '14px 24px', borderRadius: 8, fontWeight: 700 }}
              >
                {m.emails.manage}
              </Button>
            </Section>
          )}
          {restaurant.directionsUrl && (
            <Text style={text}>
              <Link href={restaurant.directionsUrl} style={{ color: theme.accentText, fontWeight: 700 }}>
                {m.emails.directions}
              </Link>
              {restaurant.address && ` · ${restaurant.address}`}
            </Text>
          )}
          {restaurant.phone && (
            <Text style={text}>
              <Link href={`tel:${restaurant.phone}`} style={{ color: theme.accentText }}>
                {m.emails.callUs(formatPhone(restaurant.phone))}
              </Link>
            </Text>
          )}
          {withCalendar && <Text style={small}>{m.emails.calendarNote}</Text>}
          {manageUrl && active && <Text style={small}>{manageUrl}</Text>}
          <Hr style={{ borderColor: '#E5E5E5', margin: '24px 0 12px' }} />
          <Text style={{ ...small, fontSize: 12 }}>{pub.poweredBy(BRAND.productName, BRAND.company)}</Text>
        </Container>
      </Body>
    </Html>
  );
}
````

Crea `src/lib/email/templates/RestaurantBookingEmail.tsx`:

````tsx
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components';
import { BRAND } from '@/config/brand';
import { capitalize, formatLongDate } from '@/lib/booking/format';
import type { RestaurantEmailKind } from '@/lib/email/outbox-rules';
import { LOCALE_LABELS_ES, type Locale } from '@/lib/i18n/locales';
import { STATUS_LABELS_ES, type ReservationStatus } from '@/lib/reservations/codes';
import { customerWarnings, type CustomerSummary } from '@/lib/reservations/customers';
import { formatPhoneDisplay } from '@/lib/reservations/phone';
import { formatTime } from '@/lib/reservations/time';

export type RestaurantEmailProps = {
  kind: RestaurantEmailKind;
  restaurantName: string;
  panelUrl: string;
  reservation: {
    status: ReservationStatus;
    startMs: number;
    partySize: number;
    zoneName: string | null;
    notes: string | null;
    locale: Locale;
    timeZone: string;
  };
  customer: CustomerSummary | null;
};

const HEADINGS: Record<RestaurantEmailKind, string> = {
  restaurant_new: 'Nueva reserva online',
  restaurant_request: 'Reserva pendiente de confirmar',
  restaurant_modified: 'El cliente ha cambiado su reserva',
  restaurant_cancelled: 'El cliente ha cancelado su reserva',
};

const INTROS: Record<RestaurantEmailKind, string> = {
  restaurant_new: 'Ha entrado una reserva desde tu web. Ya está confirmada y con mesa.',
  restaurant_request: 'Ha entrado una reserva desde tu web que tienes que confirmar o rechazar. Si es un grupo, asígnale mesa antes.',
  restaurant_modified: 'El cliente ha cambiado su reserva desde el enlace de su email. Así queda:',
  restaurant_cancelled: 'El cliente ha cancelado su reserva desde el enlace de su email. La mesa vuelve a estar libre.',
};

function when(r: RestaurantEmailProps['reservation']): string {
  return `${capitalize(formatLongDate(r.startMs, 'es', r.timeZone, false))} a las ${formatTime(r.startMs, r.timeZone)}`;
}

/** «Nueva reserva online: Ana García, viernes, 14 de junio a las 21:00 (2 personas)». */
export function restaurantEmailSubject(p: Pick<RestaurantEmailProps, 'kind' | 'reservation' | 'customer'>): string {
  const who = p.customer?.name ?? 'Sin nombre';
  const party = p.reservation.partySize === 1 ? '1 persona' : `${p.reservation.partySize} personas`;
  return `${HEADINGS[p.kind]}: ${who}, ${when(p.reservation)} (${party})`;
}

const text = { fontSize: 16, lineHeight: '24px', margin: '0 0 12px' };
const label = { fontSize: 13, color: '#3A4157', margin: 0 };
const value = { fontSize: 16, fontWeight: 700, margin: '0 0 10px' };

/** Aviso al restaurante, en castellano y con la identidad FByte. */
export function RestaurantBookingEmail({ kind, restaurantName, panelUrl, reservation, customer }: RestaurantEmailProps) {
  const rows: [string, string][] = [
    ['Cliente', customer?.name ?? 'Sin nombre'],
    ...(customer?.phone ? [['Teléfono', formatPhoneDisplay(customer.phone)] as [string, string]] : []),
    ...(customer?.email ? [['Email', customer.email] as [string, string]] : []),
    ['Cuándo', when(reservation)],
    ['Personas', String(reservation.partySize)],
    ['Zona', reservation.zoneName ?? 'Sin mesa asignada'],
    ['Estado', STATUS_LABELS_ES[reservation.status]],
    ['Idioma', LOCALE_LABELS_ES[reservation.locale]],
    ...(reservation.notes ? [['Notas del cliente', reservation.notes] as [string, string]] : []),
  ];
  const warnings = customer ? customerWarnings(customer) : [];
  return (
    <Html lang="es">
      <Head />
      <Preview>{restaurantEmailSubject({ kind, reservation, customer })}</Preview>
      <Body style={{ backgroundColor: '#F8F5EF', color: '#0A1330', fontFamily: 'Archivo, Arial, sans-serif' }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px' }}>
          <Text style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>{BRAND.productName}</Text>
          <Text style={{ fontSize: 14, color: '#3A4157', margin: '4px 0 0' }}>{restaurantName}</Text>
          <Heading as="h1" style={{ fontSize: 26, lineHeight: '30px', margin: '24px 0 12px' }}>
            {HEADINGS[kind]}
          </Heading>
          <Text style={text}>{INTROS[kind]}</Text>
          <Section style={{ margin: '16px 0', padding: '16px', backgroundColor: '#FFFFFF', border: '2px solid #0A1330', borderRadius: 6 }}>
            {rows.map(([k, v]) => (
              <div key={k}>
                <Text style={label}>{k}</Text>
                <Text style={value}>{v}</Text>
              </div>
            ))}
            {warnings.length > 0 && (
              <>
                <Text style={label}>Avisos del cliente</Text>
                <Text style={value}>{warnings.map((w) => w.text).join(' · ')}</Text>
              </>
            )}
          </Section>
          <Section style={{ margin: '24px 0' }}>
            <Button href={panelUrl} style={{ backgroundColor: '#FF7A1A', color: '#0A1330', padding: '14px 24px', borderRadius: 6, fontWeight: 700 }}>
              Abrir en el panel
            </Button>
          </Section>
          <Text style={{ fontSize: 13, color: '#3A4157', lineHeight: '20px' }}>
            Puedes apagar estos avisos o cambiar el email que los recibe en Reservas → Ajustes.
          </Text>
          <Text style={{ fontSize: 12, color: '#3A4157', marginTop: 32 }}>
            {BRAND.productName} · un producto de {BRAND.company}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/email/templates`
Expected: PASS: 4 pruebas nuevas (36 combinaciones de idioma y tipo, más las del restaurante) y la de la invitación.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/templates/CustomerBookingEmail.tsx src/lib/email/templates/RestaurantBookingEmail.tsx src/lib/email/templates/BookingEmails.test.tsx
git commit -m "Plantillas de los emails de reservas: comensal en seis idiomas y avisos al restaurante"
```

---

### Task 12: Envío de la cola: Resend con remitente, adjuntos e idempotencia, y deliverOutbox

**Files:**
- Modify: `src/lib/email/send.ts`
- Modify: `src/lib/email/send.test.ts`
- Create: `src/lib/email/outbox-data.ts`
- Create: `src/lib/email/outbox-email.tsx`
- Create: `src/lib/email/fixtures.ts`
- Create (prueba): `src/lib/email/outbox-email.test.tsx`
- Create: `src/lib/email/deliver.ts`
- Create (prueba): `src/lib/email/deliver.test.ts`

**Interfaces:**
- Consumes: Tareas 4 (`claim_outbox`, `outbox_email_data`, `skip_outbox`, `finish_outbox`), 6 (`reservationsFromAddress`, `siteUrl`), 7 (`manageToken`, `manageUrl`, `tokenHash`), 9 (`buildIcs`, `icsSequence`, `fromHeader`, `senderName`), 10 y 11 (plantillas); `mediaUrl` (`@/lib/public/data`), `directionsUrl`, `fullAddress`, `createAdminClient`.
- Produces:
  - `sendEmail(input: { to, subject, react, replyTo?, from?, attachments?: EmailAttachment[], idempotencyKey? }) → SendResult`; `type EmailAttachment = { filename, content, contentType }`; los errores son códigos (`error.name` de Resend, `NETWORK`, `EMAIL_NOT_CONFIGURED`), nunca el mensaje.
  - `src/lib/email/outbox-data.ts`: `outboxEmailDataSchema` y `type OutboxEmailData` (instantes en ms, camelCase).
  - `src/lib/email/outbox-email.tsx`: `type BuiltEmail = { to, subject, react, replyTo?, attachments? }` y `buildOutboxEmail(data & { to }, { site, manageUrl, mediaUrl, nowMs }) → BuiltEmail` (`reserva.ics` en confirmada, modificada y recordatorio; reply-to del restaurante al comensal y del cliente al restaurante).
  - `src/lib/email/fixtures.ts`: `SAMPLE_OUTBOX_DATA` (solo pruebas).
  - `src/lib/email/deliver.ts` (`server-only`): `type DeliveryStats = { claimed, sent, failed, skipped }`, `deliverOutbox({ limit?, admin?, send?, now? }) → Promise<DeliveryStats>` (nunca lanza) y `drainOutbox({ batchSize?, maxBatches?, … })`.

Lee antes `src/lib/email/send.ts`, su prueba y `src/lib/supabase/admin.ts`; comprueba en `node_modules/resend/dist/index.d.mts` que `emails.send(payload, { idempotencyKey })` y `Attachment.contentType` existen (resend 6.39.0).

- [ ] **Step 1: Escribe las pruebas que fallan**

En `src/lib/email/send.test.ts`, sustituye:

````ts
  expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'pepe@example.com', subject: 'Hola' }));
});
````

por:

````ts
  expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'pepe@example.com', subject: 'Hola' }));
});

it('remitente, adjuntos y clave de idempotencia; un rechazo devuelve el código, no el mensaje', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('RESEND_API_KEY', 're_123');
  sendMock.mockResolvedValueOnce({ data: { id: 'em_2' }, error: null });
  const { sendEmail } = await import('./send');
  const attachments = [{ filename: 'reserva.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
  await sendEmail({ ...input, from: '"La Taberna vía Mesa" <reservas@fbytesolutions.com>', attachments, idempotencyKey: 'outbox/1' });
  expect(sendMock).toHaveBeenCalledWith(
    expect.objectContaining({ from: '"La Taberna vía Mesa" <reservas@fbytesolutions.com>', attachments }),
    { idempotencyKey: 'outbox/1' },
  );
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  sendMock.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field: pepe@example.com' } });
  expect(await sendEmail(input)).toEqual({ ok: false, error: 'validation_error' });
  sendMock.mockRejectedValueOnce(new Error('socket hang up'));
  expect(await sendEmail(input)).toEqual({ ok: false, error: 'NETWORK' });
  expect(JSON.stringify(error.mock.calls)).not.toContain('pepe@example.com');
});
````

Crea `src/lib/email/outbox-email.test.tsx`:

````tsx
import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { SAMPLE_OUTBOX_DATA } from './fixtures';
import { outboxEmailDataSchema } from './outbox-data';
import { buildOutboxEmail } from './outbox-email';

const ctx = { site: 'https://mesa.test', manageUrl: 'https://mesa.test/la-taberna/reserva/TOK?lang=en', mediaUrl: (p: string) => `https://cdn.test/${p}`, nowMs: Date.parse('2030-06-01T09:00:00Z') };
const parse = (over: Record<string, unknown> = {}) => {
  const d = outboxEmailDataSchema.parse({ ...SAMPLE_OUTBOX_DATA, ...over });
  return { ...d, to: d.to as string };
};

describe('email de la cola', () => {
  it('al comensal: en su idioma, reply-to del restaurante y reserva.ics con el enlace', async () => {
    const email = buildOutboxEmail(parse(), ctx);
    expect(email.to).toBe('ana@example.com');
    expect(email.subject).toBe('Booking confirmed at La Taberna');
    expect(email.replyTo).toBe('hola@lataberna.es');
    expect(email.attachments).toHaveLength(1);
    const ics = email.attachments?.[0];
    expect(ics?.filename).toBe('reserva.ics');
    expect(ics?.contentType).toBe('text/calendar; charset=utf-8; method=PUBLISH');
    expect(ics?.content).toContain('SUMMARY:Booking at La Taberna');
    expect(ics?.content).toContain('LOCATION:Calle Mayor 1\\, 28013 Madrid');
    expect(ics?.content).toContain('DTSTART:20300614T190000Z');
    const html = await render(email.react);
    expect(html).toContain('https://cdn.test/22222222-2222-4222-8222-222222222222/logo-a.webp');
    expect(html).toContain('https://mesa.test/la-taberna/reserva/TOK?lang=en');
  });

  it('cancelación o rechazo: sin .ics; sin email del restaurante, el de avisos', () => {
    const cancelled = buildOutboxEmail(
      parse({ kind: 'customer_cancelled', restaurant: { ...SAMPLE_OUTBOX_DATA.restaurant, contact_email: null, notification_email: 'avisos@lataberna.es' } }),
      ctx,
    );
    expect(cancelled.attachments).toBeUndefined();
    expect(cancelled.replyTo).toBe('avisos@lataberna.es');
  });

  it('al restaurante: en castellano, botón al panel y reply-to del cliente', async () => {
    const email = buildOutboxEmail(parse({ kind: 'restaurant_new', to: 'hola@lataberna.es' }), ctx);
    expect(email.to).toBe('hola@lataberna.es');
    expect(email.subject).toBe('Nueva reserva online: Ana García, Viernes, 14 de junio a las 21:00 (2 personas)');
    expect(email.replyTo).toBe('ana@example.com');
    expect(email.attachments).toBeUndefined();
    expect(await render(email.react)).toContain('https://mesa.test/panel/22222222-2222-4222-8222-222222222222/reservas/11111111-1111-4111-8111-111111111111');
  });
});
````

Crea `src/lib/email/deliver.test.ts`:

````ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SAMPLE_OUTBOX_DATA } from './fixtures';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/public/data', () => ({ mediaUrl: (p: string) => `https://cdn.test/${p}` }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

const { deliverOutbox, drainOutbox } = await import('./deliver');
const { manageTokenWith, tokenHash } = await import('@/lib/booking/token');

const SECRET = 's'.repeat(32);
const RES_ID = SAMPLE_OUTBOX_DATA.reservation.id;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_x');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://mesa.test');
  vi.stubEnv('MANAGE_TOKEN_SECRET', SECRET);
  vi.stubEnv('RESERVATIONS_FROM_ADDRESS', 'reservas@fbytesolutions.com');
});

/** Cliente admin falso: claim_outbox devuelve `rows`; outbox_email_data, lo que diga `data` por id. */
function fakeAdmin(rows: { id: string; kind: string }[], data: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'claim_outbox') return { data: rows, error: null };
    if (fn === 'outbox_email_data') return { data: data[args.p_id as string] ?? null, error: null };
    return { data: null, error: null };
  });
  return { admin: { rpc } as unknown as SupabaseClient, calls };
}

const withHash = (hash: string | null) => ({ ...SAMPLE_OUTBOX_DATA, reservation: { ...SAMPLE_OUTBOX_DATA.reservation, manage_token_hash: hash } });

describe('deliverOutbox', () => {
  it('envía con el remitente del restaurante, la clave de idempotencia y el enlace del comensal; marca enviado', async () => {
    const token = manageTokenWith(SECRET, RES_ID);
    const { admin, calls } = fakeAdmin([{ id: 'o1', kind: 'customer_confirmed' }], { o1: withHash(tokenHash(token)) });
    const send = vi.fn(async () => ({ ok: true as const, id: 'em_1' }));
    const stats = await deliverOutbox({ admin, send, now: () => Date.parse('2030-06-01T09:00:00Z') });
    expect(stats).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ana@example.com',
        from: '"La Taberna vía Mesa" <reservas@fbytesolutions.com>',
        idempotencyKey: 'outbox/o1',
        replyTo: 'hola@lataberna.es',
      }),
    );
    const attachments = (send.mock.calls[0] as unknown as [{ attachments: { content: string }[] }])[0].attachments;
    // Las líneas del .ics van plegadas a 75 octetos.
    expect(attachments[0].content.replace(/\r\n /g, '')).toContain(`https://mesa.test/la-taberna/reserva/${token}?lang=en`);
    expect(calls.at(-1)).toEqual({ fn: 'finish_outbox', args: { p_id: 'o1', p_ok: true, p_provider_id: 'em_1', p_error: null } });
  });

  it('si la huella no es la de este secreto, va sin enlace (y lo avisa en el log)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { admin } = fakeAdmin([{ id: 'o1', kind: 'customer_confirmed' }], { o1: withHash('b'.repeat(64)) });
    const send = vi.fn(async () => ({ ok: true as const }));
    await deliverOutbox({ admin, send });
    const attachments = (send.mock.calls[0] as unknown as [{ attachments: { content: string }[] }])[0].attachments;
    expect(attachments[0].content.replace(/\r\n /g, '')).not.toContain('/reserva/');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lo que ya no toca se descarta con su motivo; un fallo se anota con el código, sin datos personales en el log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, calls } = fakeAdmin(
      [
        { id: 'skip', kind: 'customer_reminder' },
        { id: 'gone', kind: 'customer_confirmed' },
        { id: 'fail', kind: 'customer_confirmed' },
      ],
      { skip: { ...SAMPLE_OUTBOX_DATA, skip: 'NOT_CONFIRMED', to: 'ana@example.com' }, fail: withHash(null) },
    );
    const send = vi.fn(async () => ({ ok: false as const, error: 'validation_error' }));
    expect(await deliverOutbox({ admin, send })).toEqual({ claimed: 3, sent: 0, failed: 1, skipped: 2 });
    expect(calls).toContainEqual({ fn: 'skip_outbox', args: { p_id: 'skip', p_reason: 'NOT_CONFIRMED' } });
    expect(calls).toContainEqual({ fn: 'skip_outbox', args: { p_id: 'gone', p_reason: 'MISSING' } });
    expect(calls).toContainEqual({ fn: 'finish_outbox', args: { p_id: 'fail', p_ok: false, p_provider_id: null, p_error: 'validation_error' } });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/ana@example\.com|Ana García|612345678/);
    error.mockRestore();
  });

  it('datos con forma inesperada: se anota INTERNAL y sigue con las demás', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, calls } = fakeAdmin([{ id: 'bad', kind: 'customer_confirmed' }, { id: 'ok', kind: 'customer_confirmed' }], { bad: { kind: 'x' }, ok: withHash(null) });
    const send = vi.fn(async () => ({ ok: true as const }));
    expect(await deliverOutbox({ admin, send })).toMatchObject({ sent: 1, failed: 1 });
    expect(calls).toContainEqual({ fn: 'finish_outbox', args: { p_id: 'bad', p_ok: false, p_provider_id: null, p_error: 'INTERNAL' } });
    error.mockRestore();
  });

  it('drainOutbox repite lotes mientras vengan llenos', async () => {
    const rpc = vi.fn(async (fn: string): Promise<{ data: unknown; error: null }> => (fn === 'claim_outbox' ? { data: [], error: null } : { data: null, error: null }));
    rpc.mockResolvedValueOnce({ data: [{ id: 'a', kind: 'customer_confirmed' }], error: null });
    const admin = { rpc } as unknown as SupabaseClient;
    const stats = await drainOutbox({ admin, batchSize: 1, maxBatches: 5, send: vi.fn(async () => ({ ok: true as const })) });
    expect(stats.claimed).toBe(1);
    expect(rpc.mock.calls.filter(([fn]) => fn === 'claim_outbox')).toHaveLength(2);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/email`
Expected: FAIL: `Failed to resolve import "./deliver"` (y `./outbox-email`); en `send.test.ts`, `expected "vi.fn()" to be called with … { idempotencyKey: "outbox/1" }`.

- [ ] **Step 3: Implementa**

En `src/lib/email/send.ts`, sustituye:

````ts

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

````

por:

````ts

/** error: un código corto (nombre del error de Resend o NETWORK), nunca datos personales. */
export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export type EmailAttachment = { filename: string; content: string; contentType: string };

````

En `src/lib/email/send.ts`, sustituye:

````ts
  replyTo?: string;
}): Promise<SendResult> {
````

por:

````ts
  replyTo?: string;
  /** Remitente; por defecto, EMAIL_FROM (invitaciones). */
  from?: string;
  attachments?: EmailAttachment[];
  /** Resend no envía dos veces la misma clave (24 h): reintentos seguros. */
  idempotencyKey?: string;
}): Promise<SendResult> {
````

En `src/lib/email/send.ts`, sustituye:

````ts
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
````

por:

````ts
    const resend = new Resend(env.RESEND_API_KEY);
    const payload = {
      from: input.from ?? env.EMAIL_FROM,
      to: input.to,
````

En `src/lib/email/send.ts`, sustituye:

````ts
      replyTo: input.replyTo,
    });
    if (error) {
      console.error('[email] Resend rechazó el envío', { subject: input.subject, error: error.message });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error('[email] fallo de red al enviar', { subject: input.subject });
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
````

por:

````ts
      replyTo: input.replyTo,
      attachments: input.attachments,
    };
    const { data, error } = input.idempotencyKey
      ? await resend.emails.send(payload, { idempotencyKey: input.idempotencyKey })
      : await resend.emails.send(payload);
    if (error) {
      console.error('[email] Resend rechazó el envío', { subject: input.subject, error: error.name });
      return { ok: false, error: error.name || 'SEND_FAILED' };
    }
    return { ok: true, id: data?.id };
  } catch {
    console.error('[email] fallo de red al enviar', { subject: input.subject });
    return { ok: false, error: 'NETWORK' };
  }
````

Crea `src/lib/email/outbox-data.ts`:

````ts
import { z } from 'zod';
import { LOCALES } from '@/lib/i18n/locales';
import { CUSTOMER_TAGS, RESERVATION_SOURCES, RESERVATION_STATUSES } from '@/lib/reservations/codes';
import { EMAIL_KINDS } from './outbox-rules';

const instant = z.string().transform((v, ctx) => {
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: 'custom', message: 'fecha no válida' });
    return z.NEVER;
  }
  return ms;
});
const text = z.string().nullable();

/** JSON de public.outbox_email_data() → objeto de la app (instantes en ms). */
export const outboxEmailDataSchema = z
  .object({
    kind: z.enum(EMAIL_KINDS),
    to: text,
    skip: text,
    reservation: z.object({
      id: z.string(),
      status: z.enum(RESERVATION_STATUSES),
      starts_at: instant,
      ends_at: instant,
      party_size: z.number().int(),
      notes: text,
      locale: z.enum(LOCALES),
      source: z.enum(RESERVATION_SOURCES),
      updated_at: instant,
      manage_token_hash: text,
    }),
    customer: z
      .object({
        name: z.string(),
        email: text,
        phone: text,
        tags: z.array(z.string()),
        visits_count: z.number().int(),
        no_show_count: z.number().int(),
        cancel_count: z.number().int(),
      })
      .nullable(),
    restaurant: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      timezone: z.string(),
      accent_color: z.string(),
      logo_path: text,
      address_line: text,
      postal_code: text,
      city: text,
      phone: text,
      contact_email: text,
      notification_email: text,
    }),
    zone_name: text,
    cancel_limit_hours: z.number().int(),
  })
  .transform((d) => ({
    kind: d.kind,
    to: d.to,
    skip: d.skip,
    reservation: {
      id: d.reservation.id,
      status: d.reservation.status,
      startMs: d.reservation.starts_at,
      endMs: d.reservation.ends_at,
      partySize: d.reservation.party_size,
      notes: d.reservation.notes,
      locale: d.reservation.locale,
      source: d.reservation.source,
      updatedMs: d.reservation.updated_at,
      manageTokenHash: d.reservation.manage_token_hash,
    },
    customer: d.customer && {
      name: d.customer.name,
      email: d.customer.email,
      phone: d.customer.phone,
      tags: CUSTOMER_TAGS.filter((t) => d.customer?.tags.includes(t)),
      visitsCount: d.customer.visits_count,
      noShowCount: d.customer.no_show_count,
      cancelCount: d.customer.cancel_count,
    },
    restaurant: {
      id: d.restaurant.id,
      slug: d.restaurant.slug,
      name: d.restaurant.name,
      timezone: d.restaurant.timezone,
      accentColor: d.restaurant.accent_color,
      logoPath: d.restaurant.logo_path,
      addressLine: d.restaurant.address_line,
      postalCode: d.restaurant.postal_code,
      city: d.restaurant.city,
      phone: d.restaurant.phone,
      contactEmail: d.restaurant.contact_email,
      notificationEmail: d.restaurant.notification_email,
    },
    zoneName: d.zone_name,
  }));

export type OutboxEmailData = z.output<typeof outboxEmailDataSchema>;
````

Crea `src/lib/email/outbox-email.tsx`:

````tsx
import type { ReactElement } from 'react';
import { getBookingMessages } from '@/lib/i18n/booking';
import { directionsUrl, fullAddress } from '@/lib/public/format';
import { buildIcs, icsSequence } from './ics';
import type { OutboxEmailData } from './outbox-data';
import { isCustomerKind, type CustomerEmailKind, type RestaurantEmailKind } from './outbox-rules';
import type { EmailAttachment } from './send';
import { CustomerBookingEmail, customerEmailSubject } from './templates/CustomerBookingEmail';
import { RestaurantBookingEmail, restaurantEmailSubject } from './templates/RestaurantBookingEmail';

/** Tipos que llevan reserva.ics. */
const WITH_CALENDAR: readonly CustomerEmailKind[] = ['customer_confirmed', 'customer_modified', 'customer_reminder'];

export type BuiltEmail = { to: string; subject: string; react: ReactElement; replyTo?: string; attachments?: EmailAttachment[] };

/**
 * Email listo para enviar a partir de los datos actuales de la cola. Al comensal: en su idioma, con el enlace (si se
 * pudo generar) y el .ics; reply-to, el restaurante. Al restaurante: en castellano, con el botón al panel; reply-to,
 * el cliente (para contestarle directamente).
 */
export function buildOutboxEmail(
  data: OutboxEmailData & { to: string },
  ctx: { site: string; manageUrl: string | null; mediaUrl: (path: string) => string; nowMs: number },
): BuiltEmail {
  const { reservation: v, restaurant: r } = data;
  const address = fullAddress(r);
  if (!isCustomerKind(data.kind)) {
    const kind = data.kind as RestaurantEmailKind;
    const props = {
      kind,
      restaurantName: r.name,
      panelUrl: `${ctx.site}/panel/${r.id}/reservas/${v.id}`,
      reservation: { status: v.status, startMs: v.startMs, partySize: v.partySize, zoneName: data.zoneName, notes: v.notes, locale: v.locale, timeZone: r.timezone },
      customer: data.customer && { id: '', ...data.customer },
    };
    return {
      to: data.to,
      subject: restaurantEmailSubject(props),
      react: <RestaurantBookingEmail {...props} />,
      replyTo: data.customer?.email ?? undefined,
    };
  }
  const kind = data.kind;
  const withCalendar = WITH_CALENDAR.includes(kind);
  const m = getBookingMessages(v.locale);
  const attachments = withCalendar
    ? [
        {
          filename: 'reserva.ics',
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
          content: buildIcs({
            uid: v.id,
            startMs: v.startMs,
            endMs: v.endMs,
            nowMs: ctx.nowMs,
            sequence: icsSequence(v.updatedMs),
            summary: m.emails.icsTitle(r.name),
            location: address,
            description: ctx.manageUrl ? `${m.emails.manage}: ${ctx.manageUrl}` : null,
            url: ctx.manageUrl,
          }),
        },
      ]
    : undefined;
  return {
    to: data.to,
    subject: customerEmailSubject(kind, v.locale, r.name),
    react: (
      <CustomerBookingEmail
        kind={kind}
        locale={v.locale}
        restaurant={{
          name: r.name,
          accentColor: r.accentColor,
          logoUrl: r.logoPath ? ctx.mediaUrl(r.logoPath) : null,
          address,
          phone: r.phone,
          directionsUrl: address ? directionsUrl(address) : null,
        }}
        reservation={{
          customerName: data.customer?.name ?? null,
          status: v.status,
          startMs: v.startMs,
          partySize: v.partySize,
          zoneName: data.zoneName,
          notes: v.notes,
          timeZone: r.timezone,
        }}
        manageUrl={ctx.manageUrl}
        withCalendar={withCalendar}
      />
    ),
    replyTo: r.contactEmail ?? r.notificationEmail ?? undefined,
    attachments,
  };
}
````

Crea `src/lib/email/fixtures.ts`:

````ts
/** Lo que devuelve public.outbox_email_data() para un email de confirmación (pruebas unitarias). */
export const SAMPLE_OUTBOX_DATA = {
  kind: 'customer_confirmed',
  to: 'ana@example.com',
  skip: null,
  reservation: {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'confirmed',
    starts_at: '2030-06-14T19:00:00Z',
    ends_at: '2030-06-14T20:30:00Z',
    party_size: 2,
    notes: 'Trona',
    locale: 'en',
    source: 'online',
    updated_at: '2030-06-01T08:00:00Z',
    manage_token_hash: 'a'.repeat(64),
  },
  customer: { name: 'Ana García', email: 'ana@example.com', phone: '+34612345678', tags: ['vip'], visits_count: 1, no_show_count: 0, cancel_count: 0 },
  restaurant: {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'la-taberna',
    name: 'La Taberna',
    timezone: 'Europe/Madrid',
    accent_color: '#17317F',
    logo_path: '22222222-2222-4222-8222-222222222222/logo-a.webp',
    address_line: 'Calle Mayor 1',
    postal_code: '28013',
    city: 'Madrid',
    phone: '910000000',
    contact_email: 'hola@lataberna.es',
    notification_email: null,
  },
  zone_name: 'Terraza',
  cancel_limit_hours: 2,
};
````

Crea `src/lib/email/deliver.ts`:

````ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { manageToken, manageUrl, tokenHash } from '@/lib/booking/token';
import { reservationsFromAddress, siteUrl } from '@/lib/env';
import { mediaUrl } from '@/lib/public/data';
import { createAdminClient } from '@/lib/supabase/admin';
import { outboxEmailDataSchema } from './outbox-data';
import { buildOutboxEmail } from './outbox-email';
import { sendEmail } from './send';
import { fromHeader, senderName } from './sender';

export type DeliveryStats = { claimed: number; sent: number; failed: number; skipped: number };

type Deps = { admin?: SupabaseClient; send?: typeof sendEmail; now?: () => number };

/** El enlace del comensal, si la huella guardada es la de nuestro secreto (si cambió MANAGE_TOKEN_SECRET, sin enlace). */
function linkFor(reservationId: string, storedHash: string | null, slug: string, locale: string, site: string): string | null {
  if (!storedHash) return null;
  const token = manageToken(reservationId);
  if (tokenHash(token) !== storedHash) {
    console.warn('[email] el enlace de la reserva no coincide con MANAGE_TOKEN_SECRET: se envía sin enlace');
    return null;
  }
  return manageUrl(site, slug, token, locale);
}

/**
 * Vacía un lote de la cola: reclama filas, carga los datos actuales de cada una, pinta el email y lo envía con Resend
 * (clave de idempotencia = la fila). Lo que ya no toca se marca «skipped». Nunca lanza: un fallo de una fila se anota
 * en esa fila. Logs sin datos personales (solo ids de la cola, tipo y códigos).
 */
export async function deliverOutbox(opts: { limit?: number } & Deps = {}): Promise<DeliveryStats> {
  const stats: DeliveryStats = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const admin = opts.admin ?? createAdminClient();
  const send = opts.send ?? sendEmail;
  const now = opts.now ?? Date.now;
  const claimed = await admin.rpc('claim_outbox', { p_limit: opts.limit ?? 20 });
  if (claimed.error) {
    console.error('[email] no se pudo reclamar la cola', claimed.error.message);
    return stats;
  }
  const rows = (claimed.data ?? []) as { id: string; kind: string }[];
  stats.claimed = rows.length;
  for (const row of rows) {
    try {
      const { data, error } = await admin.rpc('outbox_email_data', { p_id: row.id });
      if (error) throw new Error(`outbox_email_data: ${error.message}`);
      const parsed = data === null ? null : outboxEmailDataSchema.parse(data);
      if (!parsed || parsed.skip || !parsed.to) {
        await admin.rpc('skip_outbox', { p_id: row.id, p_reason: parsed?.skip ?? 'MISSING' });
        stats.skipped += 1;
        continue;
      }
      const site = siteUrl();
      const r = parsed.restaurant;
      const email = buildOutboxEmail(
        { ...parsed, to: parsed.to },
        {
          site,
          manageUrl: linkFor(parsed.reservation.id, parsed.reservation.manageTokenHash, r.slug, parsed.reservation.locale, site),
          mediaUrl,
          nowMs: now(),
        },
      );
      const result = await send({ ...email, from: fromHeader(senderName(r.name), reservationsFromAddress()), idempotencyKey: `outbox/${row.id}` });
      await admin.rpc('finish_outbox', {
        p_id: row.id,
        p_ok: result.ok,
        p_provider_id: result.ok ? (result.id ?? null) : null,
        p_error: result.ok ? null : result.error,
      });
      if (result.ok) stats.sent += 1;
      else {
        stats.failed += 1;
        console.error('[email] no se pudo enviar', { outbox: row.id, kind: row.kind, error: result.error });
      }
    } catch (e) {
      stats.failed += 1;
      console.error('[email] fallo preparando el envío', { outbox: row.id, kind: row.kind, error: e instanceof Error ? e.name : 'error' });
      await admin.rpc('finish_outbox', { p_id: row.id, p_ok: false, p_provider_id: null, p_error: 'INTERNAL' });
    }
  }
  return stats;
}

/** Para la tarea horaria: lotes hasta vaciar la cola (o hasta maxBatches). */
export async function drainOutbox(opts: { batchSize?: number; maxBatches?: number } & Deps = {}): Promise<DeliveryStats> {
  const total: DeliveryStats = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const batchSize = opts.batchSize ?? 20;
  for (let i = 0; i < (opts.maxBatches ?? 5); i++) {
    const s = await deliverOutbox({ ...opts, limit: batchSize });
    total.claimed += s.claimed;
    total.sent += s.sent;
    total.failed += s.failed;
    total.skipped += s.skipped;
    if (s.claimed < batchSize) break;
  }
  return total;
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/email`
Expected: PASS: todas las de `src/lib/email` (9 pruebas nuevas: 1 en `send`, 3 en `outbox-email` y 5 en `deliver`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/send.ts src/lib/email/send.test.ts src/lib/email/outbox-data.ts src/lib/email/outbox-email.tsx src/lib/email/fixtures.ts src/lib/email/outbox-email.test.tsx src/lib/email/deliver.ts src/lib/email/deliver.test.ts
git commit -m "Emails: envío de la cola con Resend (remitente, .ics e idempotencia)"
```

---

### Task 13: Ruta /api/cron/hourly (la llama pg_cron)

**Files:**
- Create: `src/lib/email/cron-auth.ts`
- Create: `src/app/api/cron/hourly/route.ts`
- Create (prueba): `src/app/api/cron/hourly/route.test.ts`

**Interfaces:**
- Consumes: `cronSecret()` (tarea 6) y `drainOutbox()` (tarea 12).
- Produces:
  - `src/lib/email/cron-auth.ts`: `bearerMatches(header, secret) → boolean` (sha256 + `timingSafeEqual`).
  - `src/app/api/cron/hourly/route.ts`: `POST` (503 sin `CRON_SECRET`, 401 con otra clave, 200 con el resumen de `drainOutbox`), `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`.

Lee antes `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` y `…/02-route-segment-config/{runtime,maxDuration}.md` (con `cacheComponents` desactivado siguen valiendo `runtime`, `dynamic` y `maxDuration`). Un archivo `route.ts` solo puede exportar los métodos HTTP y la configuración: la comparación de la clave va en un módulo aparte.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/app/api/cron/hourly/route.test.ts`:

````ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const drainOutbox = vi.fn(async () => ({ claimed: 2, sent: 2, failed: 0, skipped: 0 }));
vi.mock('@/lib/email/deliver', () => ({ drainOutbox }));

const { POST } = await import('./route');
const { bearerMatches } = await import('@/lib/email/cron-auth');

const SECRET = 'c'.repeat(40);
const post = (authorization?: string) =>
  POST(new Request('https://mesa.test/api/cron/hourly', { method: 'POST', headers: authorization ? { authorization } : {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  drainOutbox.mockClear();
});

describe('/api/cron/hourly', () => {
  it('con la clave correcta vacía la cola y devuelve el resumen', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await post(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 2, sent: 2, failed: 0, skipped: 0 });
    expect(drainOutbox).toHaveBeenCalledOnce();
  });

  it('sin clave o con otra: 401 y no hace nada', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    expect((await post()).status).toBe(401);
    expect((await post(`Bearer ${'x'.repeat(40)}`)).status).toBe(401);
    expect((await post(SECRET)).status).toBe(401);
    expect(drainOutbox).not.toHaveBeenCalled();
  });

  it('sin CRON_SECRET en el servidor: 503', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
    expect(drainOutbox).not.toHaveBeenCalled();
  });

  it('la comparación no depende de la longitud', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches('Bearer corto', SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/app/api`
Expected: FAIL: `Failed to resolve import "./route"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/email/cron-auth.ts`:

````ts
import { createHash, timingSafeEqual } from 'node:crypto';

/** ¿La cabecera es «Bearer <secreto>»? Compara en tiempo constante (las huellas tienen siempre la misma longitud). */
export function bearerMatches(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match) return false;
  const a = createHash('sha256').update(match[1]).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
````

Crea `src/app/api/cron/hourly/route.ts`:

````ts
import { drainOutbox } from '@/lib/email/deliver';
import { bearerMatches } from '@/lib/email/cron-auth';
import { cronSecret } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * La llama pg_cron cada hora (con pg_net y la clave de Vault): vacía la cola de emails. Recordatorios, cierre
 * automático y limpieza ya los ha hecho la BD en public.run_hourly_jobs().
 */
export async function POST(request: Request) {
  const secret = cronSecret();
  if (!secret) {
    console.error('[cron] falta CRON_SECRET: no se vacía la cola');
    return Response.json({ error: 'CRON_NOT_CONFIGURED' }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const stats = await drainOutbox();
  console.info('[cron] cola de emails', stats);
  return Response.json(stats);
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/app/api`
Expected: PASS: 4 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/cron-auth.ts src/app/api/cron/hourly/route.ts src/app/api/cron/hourly/route.test.ts
git commit -m "Tarea horaria: ruta /api/cron/hourly que vacía la cola de emails"
```

---

### Task 14: Esquemas Zod del formulario público (los mismos en el navegador y en el servidor)

**Files:**
- Create: `src/lib/booking/schemas.ts`
- Create (prueba): `src/lib/booking/schemas.test.ts`

**Interfaces:**
- Consumes: `BookingFieldError` (tarea 10), `LOCALES`, `normalizePhoneE164`, `isValidSlug`, `isRealDate`.
- Produces:
  - `src/lib/booking/schemas.ts`: `bookingDetailsSchema` (`name`, `email`, `phone` → E.164, `notes` → null, `privacy: true`, `marketing`), `type BookingDetailsInput`, `bookingRequestSchema` (+ `slug`, `date`, `partySize`, `startsAt` ISO, `zoneId`, `locale`, `turnstileToken`), `type BookingRequest`, `slotsRequestSchema` (`slug`, `date`, `partySize`, `zoneId`, `token`), `type SlotsRequest`, `modifyRequestSchema` (`slug`, `token`, `date`, `partySize`, `startsAt`, `zoneId`), `type ModifyRequest`, `cancelRequestSchema`, `type CancelRequest` y `fieldCodes(error) → Partial<Record<string, BookingFieldError>>`. Los mensajes son **códigos** que cada lado traduce.

Lee antes `src/lib/reservations/validation.ts` (esquema del teléfono) y `src/lib/forms.ts`.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/booking/schemas.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { getBookingMessages } from '@/lib/i18n/booking';
import { bookingDetailsSchema, bookingRequestSchema, fieldCodes, modifyRequestSchema, slotsRequestSchema } from './schemas';

const details = { name: ' Ana García ', email: ' Ana@Example.com ', phone: '612 34 56 78', notes: '  ', privacy: true, marketing: false };

describe('esquemas del formulario público', () => {
  it('normaliza nombre, email (minúsculas), teléfono (E.164) y notas vacías', () => {
    expect(bookingDetailsSchema.parse(details)).toEqual({
      name: 'Ana García',
      email: 'ana@example.com',
      phone: '+34612345678',
      notes: null,
      privacy: true,
      marketing: false,
    });
    expect(bookingDetailsSchema.parse({ ...details, phone: '+44 20 7946 0958' }).phone).toBe('+442079460958');
  });

  it('errores por campo como códigos, que se traducen en cada idioma', () => {
    const r = bookingDetailsSchema.safeParse({ name: '', email: 'sin-arroba', phone: '123', notes: 'x'.repeat(501), privacy: false, marketing: false });
    expect(r.success).toBe(false);
    const codes = r.success ? {} : fieldCodes(r.error);
    expect(codes).toEqual({ name: 'nameRequired', email: 'emailInvalid', phone: 'phoneInvalid', notes: 'notesTooLong', privacy: 'privacyRequired' });
    expect(getBookingMessages('en').fields[codes.privacy!]).toBe('To book you need to accept the privacy information.');
    const empty = bookingDetailsSchema.safeParse({ ...details, phone: '' });
    expect(empty.success ? {} : fieldCodes(empty.error)).toEqual({ phone: 'phoneRequired' });
  });

  it('alta: personas 1–50, instante ISO, zona uuid o nada, idioma de la web y dirección válida', () => {
    const ok = {
      ...details,
      slug: 'la-taberna',
      date: '2030-06-14',
      partySize: 2,
      startsAt: '2030-06-14T19:00:00.000Z',
      zoneId: null,
      locale: 'ca',
      turnstileToken: 'tok',
    };
    expect(bookingRequestSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ partySize: 0 }, { partySize: 51 }, { partySize: 2.5 }, { startsAt: 'mañana' }, { zoneId: 'x' }, { locale: 'pt' }, { slug: 'A B' }]) {
      expect(bookingRequestSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('horas de un día y cambios con el token', () => {
    expect(slotsRequestSchema.safeParse({ slug: 'la-taberna', date: '2030-06-14', partySize: 4, zoneId: null, token: null }).success).toBe(true);
    const bad = slotsRequestSchema.safeParse({ slug: 'la-taberna', date: '2030-02-31', partySize: 4, zoneId: null, token: null });
    expect(bad.success ? {} : fieldCodes(bad.error)).toEqual({ date: 'pickDate' });
    expect(modifyRequestSchema.safeParse({ slug: 'la-taberna', token: 't'.repeat(43), date: '2030-06-14', partySize: 3, startsAt: '2030-06-14T19:00:00Z', zoneId: null }).success).toBe(true);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/booking/schemas.test.ts`
Expected: FAIL: `Failed to resolve import "./schemas"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/booking/schemas.ts`:

````ts
import { z } from 'zod';
import type { BookingFieldError } from '@/lib/i18n/booking';
import { LOCALES } from '@/lib/i18n/locales';
import { normalizePhoneE164 } from '@/lib/reservations/phone';
import { isValidSlug } from '@/lib/slug';
import { isRealDate } from '@/lib/validation/schedule';

/**
 * Esquemas del formulario público, iguales en el navegador y en el servidor. Los mensajes son códigos
 * (BookingFieldError): cada lado los traduce al idioma del comensal con getBookingMessages(locale).fields.
 */
const code = (c: BookingFieldError) => ({ message: c });

const partySchema = z.number(code('partyInvalid')).int(code('partyInvalid')).min(1, code('partyInvalid')).max(50, code('partyInvalid'));
const isoDate = z.string(code('pickDate')).regex(/^\d{4}-\d{2}-\d{2}$/, code('pickDate')).refine(isRealDate, code('pickDate'));
const instant = z.iso.datetime({ offset: true, ...code('pickTime') });
const zoneId = z.uuid().nullable();
const slug = z.string().refine(isValidSlug);

export const bookingDetailsSchema = z.object({
  name: z.string(code('nameRequired')).trim().min(1, code('nameRequired')).max(120, code('nameTooLong')),
  email: z
    .string(code('emailInvalid'))
    .trim()
    .toLowerCase()
    .max(254, code('emailInvalid'))
    .pipe(z.email(code('emailInvalid'))),
  phone: z
    .string(code('phoneRequired'))
    .trim()
    .min(1, code('phoneRequired'))
    .transform((v, ctx) => {
      const phone = normalizePhoneE164(v);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'phoneInvalid' satisfies BookingFieldError });
        return z.NEVER;
      }
      return phone;
    }),
  notes: z
    .string()
    .trim()
    .max(500, code('notesTooLong'))
    .transform((v) => (v === '' ? null : v)),
  privacy: z.literal(true, code('privacyRequired')),
  marketing: z.boolean(),
});

/** Lo que escribe el comensal (la casilla de privacidad puede llegar sin marcar: el esquema lo rechaza). */
export type BookingDetailsInput = Omit<z.input<typeof bookingDetailsSchema>, 'privacy'> & { privacy: boolean };

/** Alta online (lo que manda el navegador a la acción). */
export const bookingRequestSchema = bookingDetailsSchema.extend({
  slug,
  /** Día de servicio elegido (para las horas alternativas si la elegida se ocupa). */
  date: isoDate,
  partySize: partySchema,
  startsAt: instant,
  zoneId,
  locale: z.enum(LOCALES),
  turnstileToken: z.string().max(2048),
});
export type BookingRequest = Omit<z.input<typeof bookingRequestSchema>, 'privacy'> & { privacy: boolean };

/** Horas libres de un día (al reservar o al modificar con el token). */
export const slotsRequestSchema = z.object({
  slug,
  date: isoDate,
  partySize: partySchema,
  zoneId,
  token: z.string().max(64).nullable(),
});
export type SlotsRequest = z.input<typeof slotsRequestSchema>;

/** Cambiar día, hora, personas o zona con el token. */
export const modifyRequestSchema = z.object({ slug, token: z.string().max(64), date: isoDate, partySize: partySchema, startsAt: instant, zoneId });
export type ModifyRequest = z.input<typeof modifyRequestSchema>;

export const cancelRequestSchema = z.object({ slug, token: z.string().max(64) });
export type CancelRequest = z.input<typeof cancelRequestSchema>;

/** Primer código de error de cada campo (los que no son de un campo conocido no salen). */
export function fieldCodes(error: z.ZodError): Partial<Record<string, BookingFieldError>> {
  const out: Partial<Record<string, BookingFieldError>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in out)) out[key] = issue.message as BookingFieldError;
  }
  return out;
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/booking/schemas.test.ts`
Expected: PASS: 4 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/schemas.ts src/lib/booking/schemas.test.ts
git commit -m "Reserva online: esquemas del formulario público"
```

---

### Task 15: Lectura de los datos públicos (cliente admin), filas y errores para el comensal

**Files:**
- Create: `src/lib/booking/rows.ts`
- Create: `src/lib/booking/errors.ts`
- Create (prueba): `src/lib/booking/rows.test.ts`
- Create: `src/lib/booking/data.ts`

**Interfaces:**
- Consumes: Tareas 2–3 (`get_public_booking_day`, `get_public_reservation`, `public_booking_enabled`), 8 (`PublicBookingDay`), 10 (`BookingError`); `toServiceConfigs`, `toExceptionConfigs`, `publicRestaurantTag`, `PUBLIC_ALL_TAG`, `isValidSlug`, `createAdminClient`.
- Produces:
  - `src/lib/booking/rows.ts`: `parsePublicBookingDay(json) → PublicBookingDay | null`, `type PublicReservation = { status, startMs, endMs, partySize, customerName, notes, locale, zoneId, zoneName, changeUntilMs, canChange, onlineEnabled }` y `parsePublicReservation(json)`.
  - `src/lib/booking/errors.ts`: `bookingError(context, error) → BookingError` (registra los desconocidos).
  - `src/lib/booking/data.ts` (`server-only`): `getPublicBookingDay(slug, date, tokenHash = null)`, `getPublicReservation(slug, tokenHash)` y `isBookingEnabled(slug)` (cacheado con la etiqueta de la mini-web).

Lee antes `src/lib/public/data.ts` (patrón `cache` + `unstable_cache` con etiquetas) y `src/lib/reservations/rows.ts`.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/booking/rows.test.ts`:

````ts
import { describe, expect, it, vi } from 'vitest';
import { bookingError } from './errors';
import { parsePublicBookingDay, parsePublicReservation } from './rows';

const DAY = {
  timezone: 'Europe/Madrid',
  settings: { default_duration_min: 90, duration_rules: [], min_advance_min: 60, max_advance_days: 60, max_online_party: 8, cancel_limit_hours: 2, auto_confirm: true },
  services: [{ id: 's1', name: 'Cena', weekday: 5, start_minute: 1200, end_minute: 1410, last_booking_minute: null, slot_interval_min: 15 }],
  exceptions: [{ date_from: '2030-12-24', date_to: '2030-12-24', kind: 'closed', custom_services: [] }],
  zones: [{ id: 'z1', name: 'Terraza', position: 0 }],
  tables: [
    { id: 't1', zone_id: 'z1', name: 'T1', min_capacity: 1, max_capacity: 2, position: 0 },
    { id: 't2', zone_id: 'otra', name: 'T2', min_capacity: 1, max_capacity: 2, position: 1 },
  ],
  occupancy: [{ table_id: 't1', starts_at: '2030-06-14T19:00:00+00:00', ends_at: '2030-06-14T20:30:00+00:00' }],
  blocks: [{ table_id: null, starts_at: '2030-06-14T22:00:00+00:00', ends_at: '2030-06-15T01:00:00+00:00' }],
};

describe('día público', () => {
  it('pasa a objetos de la app; las mesas son online y activas; sin ids de reserva', () => {
    const d = parsePublicBookingDay(DAY);
    expect(d?.rules).toMatchObject({ minAdvanceMin: 60, maxOnlineParty: 8, autoConfirm: true });
    expect(d?.services[0]).toMatchObject({ weekday: 5, startMinute: 1200, lastBookingMinute: null, slotIntervalMin: 15 });
    expect(d?.tables).toEqual([
      { id: 't1', zoneId: 'z1', zoneName: 'Terraza', zonePosition: 0, name: 'T1', minCapacity: 1, maxCapacity: 2, onlineBookable: true, active: true, position: 0 },
    ]);
    expect(d?.occupancy).toEqual([{ reservationId: '', tableId: 't1', startMs: Date.parse('2030-06-14T19:00:00Z'), endMs: Date.parse('2030-06-14T20:30:00Z') }]);
    expect(d?.blocks[0]).toMatchObject({ tableId: null, reason: null });
  });

  it('null = sin reserva online; forma rara = error', () => {
    expect(parsePublicBookingDay(null)).toBeNull();
    expect(() => parsePublicBookingDay({ timezone: 'Europe/Madrid' })).toThrow();
  });
});

describe('reserva del enlace', () => {
  it('pasa a objetos de la app', () => {
    expect(
      parsePublicReservation({
        status: 'confirmed',
        starts_at: '2030-06-14T19:00:00+00:00',
        ends_at: '2030-06-14T20:30:00+00:00',
        party_size: 2,
        customer_name: 'Ana',
        notes: null,
        locale: 'en',
        zone_id: null,
        zone_name: null,
        change_until: '2030-06-14T17:00:00+00:00',
        can_change: true,
        online_enabled: true,
      }),
    ).toEqual({
      status: 'confirmed',
      startMs: Date.parse('2030-06-14T19:00:00Z'),
      endMs: Date.parse('2030-06-14T20:30:00Z'),
      partySize: 2,
      customerName: 'Ana',
      notes: null,
      locale: 'en',
      zoneId: null,
      zoneName: null,
      changeUntilMs: Date.parse('2030-06-14T17:00:00Z'),
      canChange: true,
      onlineEnabled: true,
    });
    expect(parsePublicReservation(null)).toBeNull();
  });
});

describe('errores de las funciones públicas', () => {
  it('códigos conocidos; lo demás, genérico y al log', () => {
    expect(bookingError('x', { message: 'SLOT_TAKEN' })).toBe('slotTaken');
    expect(bookingError('x', { message: 'SLOT_UNAVAILABLE' })).toBe('unavailable');
    expect(bookingError('x', { message: 'CHANGE_CLOSED' })).toBe('changeClosed');
    expect(bookingError('x', { message: 'BOOKING_CLOSED' })).toBe('bookingClosed');
    expect(bookingError('x', { message: 'NOT_FOUND' })).toBe('notFound');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(bookingError('booking.create', { message: 'INVALID_INPUT' })).toBe('generic');
    expect(log).toHaveBeenCalledWith('[booking.create]', 'INVALID_INPUT');
    log.mockRestore();
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/booking/rows.test.ts`
Expected: FAIL: `Failed to resolve import "./rows"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/booking/rows.ts`:

````ts
import { z } from 'zod';
import { LOCALES } from '@/lib/i18n/locales';
import { RESERVATION_STATUSES, type ReservationStatus } from '@/lib/reservations/codes';
import { toExceptionConfigs, toServiceConfigs, type ExceptionRow, type ServiceRow } from '@/lib/reservations/rows';
import type { Locale } from '@/lib/i18n/locales';
import type { PublicBookingDay } from './online';

const int = z.number().int();
const instant = z.string().transform((v, ctx) => {
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: 'custom', message: 'fecha no válida' });
    return z.NEVER;
  }
  return ms;
});

const daySchema = z.object({
  timezone: z.string(),
  settings: z.object({
    default_duration_min: int,
    duration_rules: z.array(z.object({ min_party: int, max_party: int, duration_min: int })),
    min_advance_min: int,
    max_advance_days: int,
    max_online_party: int,
    cancel_limit_hours: int,
    auto_confirm: z.boolean(),
  }),
  services: z.array(
    z.object({ id: z.string(), name: z.string(), weekday: int, start_minute: int, end_minute: int, last_booking_minute: int.nullable(), slot_interval_min: int }),
  ),
  exceptions: z.array(
    z.object({
      date_from: z.string(),
      date_to: z.string(),
      kind: z.enum(['closed', 'custom']),
      custom_services: z.array(z.object({ name: z.string(), start_minute: int, end_minute: int })),
    }),
  ),
  zones: z.array(z.object({ id: z.string(), name: z.string(), position: int })),
  tables: z.array(z.object({ id: z.string(), zone_id: z.string(), name: z.string(), min_capacity: int, max_capacity: int, position: int })),
  occupancy: z.array(z.object({ table_id: z.string(), starts_at: instant, ends_at: instant })),
  blocks: z.array(z.object({ table_id: z.string().nullable(), starts_at: instant, ends_at: instant })),
});

/** JSON de get_public_booking_day → día público (null si el restaurante no acepta reservas online). Lanza si la forma no cuadra. */
export function parsePublicBookingDay(json: unknown): PublicBookingDay | null {
  if (json === null || json === undefined) return null;
  const d = daySchema.parse(json);
  const zones = new Map(d.zones.map((z) => [z.id, z]));
  const s = d.settings;
  return {
    timezone: d.timezone,
    rules: {
      defaultDurationMin: s.default_duration_min,
      durationRules: s.duration_rules.map((r) => ({ minParty: r.min_party, maxParty: r.max_party, durationMin: r.duration_min })),
      minAdvanceMin: s.min_advance_min,
      maxAdvanceDays: s.max_advance_days,
      maxOnlineParty: s.max_online_party,
      cancelLimitHours: s.cancel_limit_hours,
      autoConfirm: s.auto_confirm,
    },
    services: toServiceConfigs(d.services as ServiceRow[]),
    exceptions: toExceptionConfigs(d.exceptions as ExceptionRow[]),
    zones: d.zones,
    tables: d.tables.flatMap((t) => {
      const zone = zones.get(t.zone_id);
      if (!zone) return [];
      return [
        {
          id: t.id,
          zoneId: zone.id,
          zoneName: zone.name,
          zonePosition: zone.position,
          name: t.name,
          minCapacity: t.min_capacity,
          maxCapacity: t.max_capacity,
          onlineBookable: true,
          active: true,
          position: t.position,
        },
      ];
    }),
    // Sin ids de reserva: el día público no los trae (la propia, al modificar, ya viene quitada).
    occupancy: d.occupancy.map((o) => ({ reservationId: '', tableId: o.table_id, startMs: o.starts_at, endMs: o.ends_at })),
    blocks: d.blocks.map((b, i) => ({ id: String(i), tableId: b.table_id, startMs: b.starts_at, endMs: b.ends_at, reason: null })),
  };
}

export type PublicReservation = {
  status: ReservationStatus;
  startMs: number;
  endMs: number;
  partySize: number;
  customerName: string | null;
  notes: string | null;
  locale: Locale;
  zoneId: string | null;
  zoneName: string | null;
  changeUntilMs: number;
  canChange: boolean;
  onlineEnabled: boolean;
};

const reservationSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
  starts_at: instant,
  ends_at: instant,
  party_size: int,
  customer_name: z.string().nullable(),
  notes: z.string().nullable(),
  locale: z.enum(LOCALES),
  zone_id: z.string().nullable(),
  zone_name: z.string().nullable(),
  change_until: instant,
  can_change: z.boolean(),
  online_enabled: z.boolean(),
});

/** JSON de get_public_reservation → reserva del enlace (null si no existe). */
export function parsePublicReservation(json: unknown): PublicReservation | null {
  if (json === null || json === undefined) return null;
  const r = reservationSchema.parse(json);
  return {
    status: r.status,
    startMs: r.starts_at,
    endMs: r.ends_at,
    partySize: r.party_size,
    customerName: r.customer_name,
    notes: r.notes,
    locale: r.locale,
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    changeUntilMs: r.change_until,
    canChange: r.can_change,
    onlineEnabled: r.online_enabled,
  };
}
````

Crea `src/lib/booking/errors.ts`:

````ts
import type { BookingError } from '@/lib/i18n/booking';

const RULES: [RegExp, BookingError][] = [
  [/SLOT_TAKEN|reservation_tables_no_overlap/, 'slotTaken'],
  [/SLOT_UNAVAILABLE/, 'unavailable'],
  [/CHANGE_CLOSED/, 'changeClosed'],
  [/BOOKING_CLOSED/, 'bookingClosed'],
  [/\bNOT_FOUND\b/, 'notFound'],
];

/**
 * Error de una función pública de la BD → código para el comensal (se traduce en su idioma). Lo desconocido es
 * «generic» y se registra con el contexto y el mensaje de PostgREST (sin datos del comensal).
 */
export function bookingError(context: string, error: { message?: string | null } | null | undefined): BookingError {
  const message = error?.message ?? '';
  for (const [pattern, code] of RULES) if (pattern.test(message)) return code;
  console.error(`[${context}]`, message || '(sin mensaje)');
  return 'generic';
}
````

Crea `src/lib/booking/data.ts`:

````ts
import 'server-only';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from '@/lib/public/tags';
import { isValidSlug } from '@/lib/slug';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PublicBookingDay } from './online';
import { parsePublicBookingDay, parsePublicReservation, type PublicReservation } from './rows';

/**
 * Las funciones públicas de reserva solo las ejecuta service_role: se llaman desde el servidor con el cliente admin.
 * El día no se cachea (cambia con cada reserva).
 */
export async function getPublicBookingDay(slug: string, date: string, tokenHash: string | null = null): Promise<PublicBookingDay | null> {
  if (!isValidSlug(slug)) return null;
  const { data, error } = await createAdminClient().rpc('get_public_booking_day', { p_slug: slug, p_date: date, p_token_hash: tokenHash });
  if (error) throw new Error(`get_public_booking_day: ${error.message}`);
  return parsePublicBookingDay(data);
}

/** Reserva del enlace (null si no existe o es de otro restaurante). */
export async function getPublicReservation(slug: string, tokenHash: string): Promise<PublicReservation | null> {
  if (!isValidSlug(slug)) return null;
  const { data, error } = await createAdminClient().rpc('get_public_reservation', { p_slug: slug, p_token_hash: tokenHash });
  if (error) throw new Error(`get_public_reservation: ${error.message}`);
  return parsePublicReservation(data);
}

/**
 * ¿Sale el botón «Reservar»? (restaurante activo, reserva online activada y alguna mesa online). Cacheado con la
 * mini-web: los ajustes y las mesas invalidan su etiqueta al guardarse.
 */
export const isBookingEnabled = cache(async (rawSlug: string): Promise<boolean> => {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidSlug(slug)) return false;
  return unstable_cache(
    async () => {
      const { data, error } = await createAdminClient().rpc('public_booking_enabled', { p_slug: slug });
      if (error) throw new Error(`public_booking_enabled: ${error.message}`);
      return data === true;
    },
    ['public-booking-enabled', 'v1', slug],
    { tags: [publicRestaurantTag(slug), PUBLIC_ALL_TAG], revalidate: 3600 },
  )();
});
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/booking/rows.test.ts`
Expected: PASS: 4 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/rows.ts src/lib/booking/errors.ts src/lib/booking/rows.test.ts src/lib/booking/data.ts
git commit -m "Reserva online: lectura de los datos públicos y errores para el comensal"
```

---

### Task 16: Acciones públicas: horas libres, alta online, modificar y cancelar con el token

**Files:**
- Create: `src/lib/actions/booking.ts`
- Create (prueba): `src/lib/actions/booking.test.ts`

**Interfaces:**
- Consumes: Tareas 6 (`turnstileKeys`), 7 (`newBookingIdentity`, `tokenHash`, `isTokenShape`, `verifyTurnstile`, `withinRateLimit`, `clientIpFrom`), 8 (`onlineSlots`, `nearestAlternatives`, `isGroupRequest`), 12 (`deliverOutbox`), 14 (esquemas), 15 (`getPublicBookingDay`, `bookingError`).
- Produces:
  `src/lib/actions/booking.ts` (`'use server'`): `type SlotsResult`, `type BookingResult`, `type ChangeResult`, `loadSlots(input: SlotsRequest) → SlotsResult`, `createOnlineBooking(input: BookingRequest) → BookingResult` (`{ ok: true, status, email }` o `{ ok: false, error, fieldErrors?, alternatives? }`), `modifyOnlineBooking(input: ModifyRequest) → ChangeResult` y `cancelOnlineBooking(input: CancelRequest) → ChangeResult`. Nunca lanzan ni devuelven el texto de la BD; los emails salen con `after(() => deliverOutbox())`.

Lee antes `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` (en server actions se puede llamar a `after` y a `headers()`), y `src/lib/actions/reservations.ts` (estilo de acciones).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/actions/booking.test.ts`:

````ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicBookingDay } from '@/lib/booking/online';
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/reservations/settings';

vi.mock('server-only', () => ({}));
const after = vi.fn();
vi.mock('next/server', () => ({ after: (fn: () => unknown) => after(fn) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }) }));
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
const verifyTurnstile = vi.fn(async () => 'ok' as const);
vi.mock('@/lib/booking/turnstile', () => ({ verifyTurnstile: (...a: unknown[]) => verifyTurnstile(...(a as [])) }));
const getPublicBookingDay = vi.fn<() => Promise<PublicBookingDay | null>>();
vi.mock('@/lib/booking/data', () => ({ getPublicBookingDay: (...a: unknown[]) => getPublicBookingDay(...(a as [])) }));
const deliverOutbox = vi.fn();
vi.mock('@/lib/email/deliver', () => ({ deliverOutbox: () => deliverOutbox() }));

const { cancelOnlineBooking, createOnlineBooking, loadSlots, modifyOnlineBooking } = await import('./booking');
const { manageTokenWith, tokenHash } = await import('@/lib/booking/token');

const SECRET = 's'.repeat(32);
const TOKEN = manageTokenWith(SECRET, '11111111-1111-4111-8111-111111111111');
const START = '2030-06-14T19:00:00.000Z';
const request = {
  slug: 'la-taberna',
  date: '2030-06-14',
  partySize: 2,
  startsAt: START,
  zoneId: null,
  name: 'Ana',
  email: 'Ana@Example.com',
  phone: '612345678',
  notes: '',
  privacy: true,
  marketing: true,
  locale: 'en' as const,
  turnstileToken: 'tok',
};
const day: PublicBookingDay = {
  timezone: 'Europe/Madrid',
  rules: { ...DEFAULT_BOOKING_SETTINGS, defaultDurationMin: 60, minAdvanceMin: 0, maxAdvanceDays: 365 * 10 },
  services: [{ name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1380, lastBookingMinute: 1320, slotIntervalMin: 30 }],
  exceptions: [],
  zones: [],
  tables: [{ id: 't', zoneId: 'z', zoneName: 'Sala', zonePosition: 0, name: 'T1', minCapacity: 1, maxCapacity: 4, onlineBookable: true, active: true, position: 0 }],
  occupancy: [{ reservationId: '', tableId: 't', startMs: Date.parse(START), endMs: Date.parse(START) + 30 * 60_000 }],
  blocks: [],
};

/** rpc: hit_rate_limit dice que sí; el resto, lo que diga `result`. */
function db(result: { data: unknown; error: { message: string } | null }, limitOk = true) {
  rpc.mockImplementation(async (fn) => (fn === 'hit_rate_limit' ? { data: limitOk, error: null } : result));
}

beforeEach(() => {
  vi.stubEnv('MANAGE_TOKEN_SECRET', SECRET);
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  rpc.mockReset();
  after.mockReset();
  verifyTurnstile.mockClear();
  getPublicBookingDay.mockReset();
});

describe('alta online', () => {
  it('con Turnstile y dentro del límite: crea la reserva con id y huella de la app y envía los emails después', async () => {
    db({ data: { id: 'x', status: 'confirmed', table_ids: ['t'] }, error: null });
    expect(await createOnlineBooking(request)).toEqual({ ok: true, status: 'confirmed', email: 'ana@example.com' });
    const call = rpc.mock.calls.find(([fn]) => fn === 'create_public_reservation');
    const args = call?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_slug: 'la-taberna', p_party: 2, p_starts_at: START, p_email: 'ana@example.com', p_phone: '+34612345678', p_notes: null, p_locale: 'en', p_marketing_opt_in: true });
    expect(args.p_token_hash).toBe(tokenHash(manageTokenWith(SECRET, args.p_id as string)));
    // Las claves de prueba de Cloudflare en desarrollo; la IP real va a Turnstile, pero nunca a la BD.
    expect(verifyTurnstile).toHaveBeenCalledWith('tok', '203.0.113.7', { secret: '1x0000000000000000000000000000000AA' });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.7');
    expect(after).toHaveBeenCalledOnce();
  });

  it('errores de los campos como códigos, sin tocar la BD', async () => {
    const r = await createOnlineBooking({ ...request, email: 'mal', privacy: false });
    expect(r).toEqual({ ok: false, error: 'generic', fieldErrors: { email: 'emailInvalid', privacy: 'privacyRequired' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('demasiados intentos, Turnstile fallido o sin claves en producción: no se crea nada', async () => {
    db({ data: null, error: null }, false);
    expect(await createOnlineBooking(request)).toEqual({ ok: false, error: 'tooMany' });
    db({ data: null, error: null });
    verifyTurnstile.mockResolvedValueOnce('failed' as never);
    expect(await createOnlineBooking(request)).toEqual({ ok: false, error: 'turnstile' });
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await createOnlineBooking(request)).toEqual({ ok: false, error: 'turnstileMissing' });
    expect(rpc.mock.calls.some(([fn]) => fn === 'create_public_reservation')).toBe(false);
    expect(after).not.toHaveBeenCalled();
  });

  it('hora recién ocupada: SLOT_TAKEN con las horas libres más cercanas', async () => {
    db({ data: null, error: { message: 'SLOT_TAKEN' } });
    getPublicBookingDay.mockResolvedValue(day);
    const r = await createOnlineBooking(request);
    expect(r).toMatchObject({ ok: false, error: 'slotTaken' });
    expect(r.ok ? [] : r.alternatives?.map((s) => s.label)).toEqual(['20:00', '21:30', '22:00']);
  });

  it('otros errores de la BD: su código o el genérico (sin enseñar el mensaje)', async () => {
    db({ data: null, error: { message: 'BOOKING_CLOSED' } });
    expect(await createOnlineBooking(request)).toEqual({ ok: false, error: 'bookingClosed' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db({ data: null, error: { message: 'connection refused' } });
    expect(await createOnlineBooking(request)).toEqual({ ok: false, error: 'generic' });
  });
});

describe('horas libres', () => {
  it('del día pedido, con el límite de intentos; sin reserva online, bookingClosed', async () => {
    db({ data: null, error: null });
    getPublicBookingDay.mockResolvedValueOnce(day);
    const r = await loadSlots({ slug: 'la-taberna', date: '2030-06-14', partySize: 2, zoneId: null, token: TOKEN });
    expect(r.ok && r.groups[0].slots.map((s) => `${s.label}${s.available ? '' : '×'}`)).toEqual(['20:00', '20:30×', '21:00×', '21:30', '22:00']);
    expect(getPublicBookingDay).toHaveBeenCalledWith('la-taberna', '2030-06-14', tokenHash(TOKEN));
    getPublicBookingDay.mockResolvedValueOnce(null);
    expect(await loadSlots({ slug: 'la-taberna', date: '2030-06-14', partySize: 2, zoneId: null, token: null })).toEqual({ ok: false, error: 'bookingClosed' });
    db({ data: null, error: null }, false);
    expect(await loadSlots({ slug: 'la-taberna', date: '2030-06-14', partySize: 2, zoneId: null, token: null })).toEqual({ ok: false, error: 'tooMany' });
  });
});

describe('modificar y cancelar con el token', () => {
  const change = { slug: 'la-taberna', token: TOKEN, date: '2030-06-14', partySize: 3, startsAt: START, zoneId: null };

  it('modificar manda la huella (nunca el token) y envía los emails', async () => {
    db({ data: { status: 'pending', table_ids: [] }, error: null });
    expect(await modifyOnlineBooking(change)).toEqual({ ok: true, status: 'pending' });
    const args = rpc.mock.calls.find(([fn]) => fn === 'modify_public_reservation')?.[1];
    expect(args).toEqual({ p_slug: 'la-taberna', p_token_hash: tokenHash(TOKEN), p_party: 3, p_starts_at: START, p_zone_id: null });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    expect(after).toHaveBeenCalledOnce();
  });

  it('fuera de plazo, token que no existe o mal formado', async () => {
    db({ data: null, error: { message: 'CHANGE_CLOSED' } });
    expect(await modifyOnlineBooking(change)).toEqual({ ok: false, error: 'changeClosed' });
    expect(await cancelOnlineBooking({ slug: 'la-taberna', token: TOKEN })).toEqual({ ok: false, error: 'changeClosed' });
    db({ data: null, error: { message: 'NOT_FOUND' } });
    expect(await cancelOnlineBooking({ slug: 'la-taberna', token: TOKEN })).toEqual({ ok: false, error: 'notFound' });
    expect(await cancelOnlineBooking({ slug: 'la-taberna', token: 'corto' })).toEqual({ ok: false, error: 'generic' });
  });

  it('cancelar dentro de plazo', async () => {
    db({ data: null, error: null });
    expect(await cancelOnlineBooking({ slug: 'la-taberna', token: TOKEN })).toEqual({ ok: true });
    expect(after).toHaveBeenCalledOnce();
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/actions/booking.test.ts`
Expected: FAIL: `Failed to resolve import "./booking"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/actions/booking.ts`:

````ts
'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { getPublicBookingDay } from '@/lib/booking/data';
import { bookingError } from '@/lib/booking/errors';
import { isGroupRequest, nearestAlternatives, onlineSlots, type OnlineSlot, type SlotGroup } from '@/lib/booking/online';
import { clientIpFrom, withinRateLimit, type RateLimitAction } from '@/lib/booking/rate-limit';
import {
  bookingRequestSchema,
  cancelRequestSchema,
  fieldCodes,
  modifyRequestSchema,
  slotsRequestSchema,
  type BookingRequest,
  type CancelRequest,
  type ModifyRequest,
  type SlotsRequest,
} from '@/lib/booking/schemas';
import { isTokenShape, newBookingIdentity, tokenHash } from '@/lib/booking/token';
import { verifyTurnstile } from '@/lib/booking/turnstile';
import { deliverOutbox } from '@/lib/email/deliver';
import { turnstileKeys } from '@/lib/env';
import type { BookingError, BookingFieldError } from '@/lib/i18n/booking';
import { createAdminClient } from '@/lib/supabase/admin';

// Acciones públicas (sin sesión): validan con los mismos esquemas que el navegador, pasan por el límite de intentos
// (y Turnstile en el alta) y llaman a las funciones de la BD con la clave de servicio. Nunca lanzan ni enseñan el
// mensaje de la BD: devuelven códigos que el navegador traduce al idioma del comensal.

export type SlotsResult = { ok: true; groups: SlotGroup[]; groupRequest: boolean } | { ok: false; error: BookingError };
export type BookingResult =
  | { ok: true; status: 'confirmed' | 'pending'; email: string }
  | { ok: false; error: BookingError; fieldErrors?: Partial<Record<string, BookingFieldError>>; alternatives?: OnlineSlot[] };
export type ChangeResult =
  | { ok: true; status?: 'confirmed' | 'pending' }
  | { ok: false; error: BookingError; alternatives?: OnlineSlot[] };

async function ip(): Promise<string> {
  return clientIpFrom(await headers());
}

async function limited(action: RateLimitAction, slug: string): Promise<boolean> {
  return !(await withinRateLimit(createAdminClient(), action, slug, await ip()));
}

/** Envía los emails anotados justo después de responder. */
function sendQueuedEmails(): void {
  after(async () => {
    await deliverOutbox();
  });
}

/** Si la hora se acaba de ocupar: las libres más cercanas de ese día (sin contar la propia reserva al modificar). */
async function alternativesFor(slug: string, date: string, partySize: number, zoneId: string | null, startMs: number, hash: string | null): Promise<OnlineSlot[]> {
  try {
    const day = await getPublicBookingDay(slug, date, hash);
    return day ? nearestAlternatives(onlineSlots(day, date, partySize, zoneId, Date.now()), startMs) : [];
  } catch (e) {
    console.error('[booking.alternatives]', e instanceof Error ? e.message : 'error');
    return [];
  }
}

/** Horas de un día para el paso «Hora» (al reservar y al modificar). */
export async function loadSlots(input: SlotsRequest): Promise<SlotsResult> {
  const parsed = slotsRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'generic' };
  const d = parsed.data;
  try {
    if (await limited('slots', d.slug)) return { ok: false, error: 'tooMany' };
    const hash = d.token && isTokenShape(d.token) ? tokenHash(d.token) : null;
    const day = await getPublicBookingDay(d.slug, d.date, hash);
    if (!day) return { ok: false, error: 'bookingClosed' };
    return { ok: true, groups: onlineSlots(day, d.date, d.partySize, d.zoneId, Date.now()), groupRequest: isGroupRequest(d.partySize, day.rules) };
  } catch (e) {
    console.error('[booking.loadSlots]', e instanceof Error ? e.message : 'error');
    return { ok: false, error: 'generic' };
  }
}

/** Alta online: Turnstile y límite de intentos antes de tocar la BD; el id y el token los pone la app. */
export async function createOnlineBooking(input: BookingRequest): Promise<BookingResult> {
  const parsed = bookingRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'generic', fieldErrors: fieldCodes(parsed.error) };
  const d = parsed.data;
  try {
    const keys = turnstileKeys();
    if (!keys) {
      console.error('[booking.create] faltan las claves de Turnstile en producción: no se aceptan reservas online');
      return { ok: false, error: 'turnstileMissing' };
    }
    if (await limited('book', d.slug)) return { ok: false, error: 'tooMany' };
    const check = await verifyTurnstile(d.turnstileToken, await ip(), { secret: keys.secretKey });
    if (check !== 'ok') return { ok: false, error: check === 'not_configured' ? 'turnstileMissing' : 'turnstile' };
    const identity = newBookingIdentity();
    const { data, error } = await createAdminClient().rpc('create_public_reservation', {
      p_slug: d.slug,
      p_id: identity.id,
      p_token_hash: identity.tokenHash,
      p_party: d.partySize,
      p_starts_at: d.startsAt,
      p_zone_id: d.zoneId,
      p_name: d.name,
      p_email: d.email,
      p_phone: d.phone,
      p_notes: d.notes,
      p_locale: d.locale,
      p_marketing_opt_in: d.marketing,
    });
    if (error) {
      const code = bookingError('booking.create', error);
      if (code !== 'slotTaken') return { ok: false, error: code };
      return { ok: false, error: code, alternatives: await alternativesFor(d.slug, d.date, d.partySize, d.zoneId, Date.parse(d.startsAt), null) };
    }
    sendQueuedEmails();
    return { ok: true, status: (data as { status?: string } | null)?.status === 'pending' ? 'pending' : 'confirmed', email: d.email };
  } catch (e) {
    console.error('[booking.create]', e instanceof Error ? e.message : 'error');
    return { ok: false, error: 'generic' };
  }
}

/** El comensal cambia día, hora, personas o zona con su enlace (antes del límite de cancelación). */
export async function modifyOnlineBooking(input: ModifyRequest): Promise<ChangeResult> {
  const parsed = modifyRequestSchema.safeParse(input);
  if (!parsed.success || !isTokenShape(parsed.data.token)) return { ok: false, error: 'generic' };
  const d = parsed.data;
  try {
    if (await limited('token', d.slug)) return { ok: false, error: 'tooMany' };
    const hash = tokenHash(d.token);
    const { data, error } = await createAdminClient().rpc('modify_public_reservation', {
      p_slug: d.slug,
      p_token_hash: hash,
      p_party: d.partySize,
      p_starts_at: d.startsAt,
      p_zone_id: d.zoneId,
    });
    if (error) {
      const code = bookingError('booking.modify', error);
      if (code !== 'slotTaken') return { ok: false, error: code };
      return { ok: false, error: code, alternatives: await alternativesFor(d.slug, d.date, d.partySize, d.zoneId, Date.parse(d.startsAt), hash) };
    }
    sendQueuedEmails();
    return { ok: true, status: (data as { status?: string } | null)?.status === 'pending' ? 'pending' : 'confirmed' };
  } catch (e) {
    console.error('[booking.modify]', e instanceof Error ? e.message : 'error');
    return { ok: false, error: 'generic' };
  }
}

/** El comensal cancela con su enlace (antes del límite de cancelación). */
export async function cancelOnlineBooking(input: CancelRequest): Promise<ChangeResult> {
  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success || !isTokenShape(parsed.data.token)) return { ok: false, error: 'generic' };
  const d = parsed.data;
  try {
    if (await limited('token', d.slug)) return { ok: false, error: 'tooMany' };
    const { error } = await createAdminClient().rpc('cancel_public_reservation', { p_slug: d.slug, p_token_hash: tokenHash(d.token) });
    if (error) return { ok: false, error: bookingError('booking.cancel', error) };
    sendQueuedEmails();
    return { ok: true };
  } catch (e) {
    console.error('[booking.cancel]', e instanceof Error ? e.message : 'error');
    return { ok: false, error: 'generic' };
  }
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/actions/booking.test.ts`
Expected: PASS: 9 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/booking.ts src/lib/actions/booking.test.ts
git commit -m "Reserva online: acciones públicas (horas, alta, modificar y cancelar)"
```

---

### Task 17: Componentes del flujo público: Turnstile, calendario, horas, campos, flujo y cancelar

**Files:**
- Create: `src/components/booking/styles.ts`
- Create: `src/components/booking/TurnstileWidget.tsx`
- Create: `src/components/booking/BookingCalendar.tsx`
- Create: `src/components/booking/SlotPicker.tsx`
- Create: `src/components/booking/PublicFields.tsx`
- Create: `src/components/booking/BookingFlow.tsx`
- Create: `src/components/booking/CancelBooking.tsx`
- Create (prueba): `src/components/booking/BookingCalendar.test.tsx`

**Interfaces:**
- Consumes: Tareas 8 (`monthGrid`, `moveDate`, `CALENDAR_KEYS`, `formatIsoDate`, `formatMonth`, `weekdayNames`, `capitalize`, `OnlineSlot`, `SlotGroup`, `PublicZone`), 10 (`getBookingMessages`), 14 (`bookingDetailsSchema`, `fieldCodes`), 16 (`loadSlots`, `createOnlineBooking`, `modifyOnlineBooking`, `cancelOnlineBooking`).
- Produces:
  - `src/components/booking/styles.ts`: `focusRing`, `accentButton`, `outlineButton`, `inputClass`.
  - `TurnstileWidget({ siteKey, locale, label, resetKey, onToken })` (cliente; script con `render=explicit`).
  - `BookingCalendar({ locale, m, openDates, min, max, selected, onSelect })` (cliente; un punto de tabulación, flechas, Inicio/Fin, Re Pág/Av Pág; días cerrados `aria-disabled`).
  - `SlotPicker({ groups, selected, takenLabel, onSelect })`.
  - `PublicInput`, `PublicTextArea`, `PublicCheckbox` (error junto al campo, `aria-describedby`).
  - `BookingFlow(props: CreateFlowProps | ModifyFlowProps)` (cliente): `CreateFlowProps = { mode: 'create', slug, locale, openDates, minDate, maxDate, zones, maxOnlineParty, siteKey, privacy: { holder, href }, restaurantName }`, `ModifyFlowProps = { mode: 'modify', …, token, initial: { partySize, date, startMs, zoneId, groups } }`.
  - `CancelBooking({ slug, token, locale })` (cliente).

Lee antes `node_modules/next/dist/docs/01-app/03-api-reference/02-components/script.md` (`onReady`, `strategy="afterInteractive"`, solo en componentes cliente) y `src/components/reservations/ReservationActions.tsx` (patrón aria-disabled + regiones siempre montadas).

Ningún control con foco usa `disabled` (siempre `aria-disabled`, y el clic no hace nada); los avisos van a dos regiones (`aria-live="polite"` y `role="alert"`) que están siempre montadas; un `ref` impide los envíos dobles; cada llamada a una acción va en `try/catch` con el texto genérico en el idioma del comensal. Las horas se piden desde los manejadores de eventos (no desde `useEffect`) y solo vale la última respuesta. Tras cada intento de alta se reinicia Turnstile (un token vale para un intento).

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/components/booking/BookingCalendar.test.tsx`:

````tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getBookingMessages } from '@/lib/i18n/booking';
import { BookingCalendar } from './BookingCalendar';
import { SlotPicker } from './SlotPicker';

const m = getBookingMessages('es');

describe('calendario de la reserva online', () => {
  const html = renderToStaticMarkup(
    <BookingCalendar locale="es" m={m} openDates={['2030-06-14', '2030-06-15']} min="2030-06-13" max="2030-07-13" selected="2030-06-15" onSelect={() => {}} />,
  );

  it('un único punto de tabulación: el día elegido', () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/data-date="2030-06-15" tabindex="0" aria-pressed="true"/);
  });

  it('los días cerrados siguen siendo botones con foco, pero aria-disabled y con «no disponible»', () => {
    expect(html).toMatch(/data-date="2030-06-16" tabindex="-1" aria-pressed="false" aria-disabled="true"/);
    expect(html).toContain('domingo, 16 de junio de 2030, no disponible');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });

  it('el nombre accesible empieza por el número que se ve; mes y días de la semana en el idioma', () => {
    expect(html).toContain('14<span class="sr-only">, viernes, 14 de junio de 2030</span>');
    expect(html).toContain('junio de 2030');
    expect(html).toContain('title="lunes"');
    expect(html).toContain('<span class="sr-only">Mes anterior</span>');
  });
});

describe('horas', () => {
  it('agrupadas por servicio; las completas aria-disabled con «completa»', () => {
    const html = renderToStaticMarkup(
      <SlotPicker
        groups={[
          {
            serviceKey: '1200',
            serviceName: 'Cena',
            slots: [
              { minute: 1200, startMs: 1, label: '20:00', available: true },
              { minute: 1230, startMs: 2, label: '20:30', available: false },
            ],
          },
        ]}
        selected={1}
        takenLabel={m.timeTaken}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('<legend class="mb-1 font-semibold">Cena</legend>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>20:00</);
    expect(html).toMatch(/aria-pressed="false" aria-disabled="true"[^>]*>20:30<span class="sr-only">, completa<\/span>/);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/components/booking && pnpm typecheck && pnpm lint`
Expected: FAIL: `Failed to resolve import "./BookingCalendar"`.

- [ ] **Step 3: Implementa**

Crea `src/components/booking/styles.ts`:

````ts
/** Clases de las páginas públicas de reserva (diseño neutro con el acento del restaurante). */
export const focusRing = 'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-neutral-900';
export const accentButton =
  `inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-3 font-bold text-[var(--on-accent)] hover:opacity-90 ` +
  `aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`;
export const outlineButton =
  `inline-flex items-center justify-center rounded-lg border-2 border-neutral-300 bg-white px-5 py-3 font-bold hover:border-neutral-500 ` +
  `aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`;
export const inputClass =
  'w-full rounded-lg border-2 border-neutral-300 bg-white px-3 py-2.5 text-neutral-900 focus:border-neutral-900 focus:outline-none aria-[invalid=true]:border-red-700';
````

Crea `src/components/booking/TurnstileWidget.tsx`:

````tsx
'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Widget de Cloudflare Turnstile con render explícito (sin dependencias). Avisa del token con onToken (null cuando
 * caduca o falla). Cada vez que cambia resetKey se reinicia: un token solo vale para un intento.
 */
export function TurnstileWidget({
  siteKey,
  locale,
  label,
  resetKey,
  onToken,
}: {
  siteKey: string;
  locale: string;
  label: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const api = window.turnstile;
    if (!ready || !api || !box.current || widget.current) return;
    widget.current = api.render(box.current, {
      sitekey: siteKey,
      language: locale,
      callback: (token: string) => callback.current(token),
      'expired-callback': () => callback.current(null),
      'error-callback': () => callback.current(null),
    });
    return () => {
      if (widget.current) api.remove(widget.current);
      widget.current = null;
    };
  }, [ready, siteKey, locale]);

  useEffect(() => {
    if (resetKey === 0 || !widget.current) return;
    window.turnstile?.reset(widget.current);
    callback.current(null);
  }, [resetKey]);

  return (
    <div role="group" aria-label={label}>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setReady(true)} />
      <div ref={box} />
    </div>
  );
}
````

Crea `src/components/booking/BookingCalendar.tsx`:

````tsx
'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addMonths, CALENDAR_KEYS, monthGrid, monthOf, moveDate, type CalendarKey } from '@/lib/booking/calendar';
import { formatIsoDate, formatMonth, weekdayNames } from '@/lib/booking/format';
import type { BookingMessages } from '@/lib/i18n/booking';
import type { Locale } from '@/lib/i18n/locales';
import { focusRing } from './styles';

type Props = {
  locale: Locale;
  m: Pick<BookingMessages, 'dateLabel' | 'prevMonth' | 'nextMonth' | 'dayUnavailable'>;
  /** Días que se pueden elegir (abiertos y dentro de la antelación). */
  openDates: readonly string[];
  min: string;
  max: string;
  selected: string | null;
  onSelect: (date: string) => void;
};

/**
 * Calendario de un mes: los días cerrados o fuera de la antelación salen deshabilitados (aria-disabled, siguen
 * recibiendo el foco). Teclado: un único punto de tabulación; flechas, Inicio/Fin y Re Pág/Av Pág.
 */
export function BookingCalendar({ locale, m, openDates, min, max, selected, onSelect }: Props) {
  const open = useMemo(() => new Set(openDates), [openDates]);
  const [focus, setFocus] = useState(selected ?? openDates[0] ?? min);
  const month = monthOf(focus);
  const grid = useRef<HTMLTableElement>(null);
  const moveFocus = useRef(false);
  const headingId = 'booking-calendar-month';
  const short = useMemo(() => weekdayNames(locale, 'short'), [locale]);
  const long = useMemo(() => weekdayNames(locale, 'long'), [locale]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus]);

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    if (!CALENDAR_KEYS.includes(e.key)) return;
    e.preventDefault();
    moveFocus.current = true;
    setFocus(moveDate(focus, e.key as CalendarKey, { min, max }));
  }

  function goMonth(n: number) {
    const target = `${addMonths(month, n)}-01`;
    setFocus(target < min ? min : target > max ? max : target);
  }

  const canPrev = addMonths(month, -1) >= monthOf(min);
  const canNext = addMonths(month, 1) <= monthOf(max);
  const navButton = `rounded-lg border-2 border-neutral-300 px-3 py-1.5 font-bold aria-disabled:opacity-40 ${focusRing}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={navButton} aria-disabled={!canPrev || undefined} onClick={() => canPrev && goMonth(-1)}>
          <span aria-hidden="true">‹</span> <span className="sr-only">{m.prevMonth}</span>
        </button>
        <p id={headingId} aria-live="polite" className="font-bold first-letter:uppercase">
          {formatMonth(month, locale)}
        </p>
        <button type="button" className={navButton} aria-disabled={!canNext || undefined} onClick={() => canNext && goMonth(1)}>
          <span className="sr-only">{m.nextMonth}</span> <span aria-hidden="true">›</span>
        </button>
      </div>
      <table ref={grid} aria-labelledby={headingId} onKeyDown={onKeyDown} className="w-full table-fixed border-separate border-spacing-1 text-center">
        <thead>
          <tr>
            {short.map((d, i) => (
              <th key={d} scope="col" className="text-xs font-semibold text-neutral-600">
                <abbr title={long[i]} className="no-underline">
                  {d}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week) => (
            <tr key={week.find(Boolean)}>
              {week.map((date, i) => {
                if (!date) return <td key={`empty-${i}`} />;
                const enabled = open.has(date);
                const isSelected = date === selected;
                return (
                  <td key={date}>
                    <button
                      type="button"
                      data-date={date}
                      tabIndex={date === focus ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-disabled={!enabled || undefined}
                      onClick={() => {
                        setFocus(date);
                        if (enabled) onSelect(date);
                      }}
                      className={
                        `h-11 w-full rounded-lg font-bold tabular-nums ${focusRing} ` +
                        (isSelected
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : enabled
                            ? 'border-2 border-neutral-300 bg-white hover:border-neutral-600'
                            : 'cursor-not-allowed text-neutral-400 line-through')
                      }
                    >
                      {Number(date.slice(8))}
                      <span className="sr-only">
                        {`, ${formatIsoDate(date, locale)}`}
                        {!enabled && `, ${m.dayUnavailable}`}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
````

Crea `src/components/booking/SlotPicker.tsx`:

````tsx
import type { OnlineSlot, SlotGroup } from '@/lib/booking/online';
import { focusRing } from './styles';

/** Horas agrupadas por servicio. Las completas salen deshabilitadas (aria-disabled) con «completa» para lectores. */
export function SlotPicker({
  groups,
  selected,
  takenLabel,
  onSelect,
}: {
  groups: readonly SlotGroup[];
  selected: number | null;
  takenLabel: string;
  onSelect: (slot: OnlineSlot) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <fieldset key={g.serviceKey} className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{g.serviceName}</legend>
          <div className="flex flex-wrap gap-2">
            {g.slots.map((s) => {
              const isSelected = s.startMs === selected;
              return (
                <button
                  key={s.startMs}
                  type="button"
                  aria-pressed={isSelected}
                  aria-disabled={!s.available || undefined}
                  onClick={() => s.available && onSelect(s)}
                  className={
                    `min-w-20 rounded-lg px-3 py-2 font-bold tabular-nums ${focusRing} ` +
                    (isSelected
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : s.available
                        ? 'border-2 border-neutral-300 bg-white hover:border-neutral-600'
                        : 'cursor-not-allowed border-2 border-neutral-200 bg-neutral-100 text-neutral-400 line-through')
                  }
                >
                  {s.label}
                  {!s.available && <span className="sr-only">{`, ${takenLabel}`}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
````

Crea `src/components/booking/PublicFields.tsx`:

````tsx
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { inputClass } from './styles';

type Common = { id: string; label: string; error?: string; hint?: string };

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  return error ? `${id}-err` : hint ? `${id}-hint` : undefined;
}

function Help({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) {
    return (
      <p id={`${id}-err`} className="text-sm font-medium text-red-700">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-hint`} className="text-sm text-neutral-600">
      {hint}
    </p>
  ) : null;
}

/** Campo de texto de las páginas públicas, con su error junto al campo. */
export function PublicInput({ id, label, error, hint, ...input }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <input id={id} aria-invalid={!!error} aria-describedby={describedBy(id, error, hint)} className={inputClass} {...input} />
      <Help id={id} error={error} hint={hint} />
    </div>
  );
}

export function PublicTextArea({ id, label, error, hint, ...textarea }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <textarea id={id} aria-invalid={!!error} aria-describedby={describedBy(id, error, hint)} className={inputClass} {...textarea} />
      <Help id={id} error={error} hint={hint} />
    </div>
  );
}

export function PublicCheckbox({
  id,
  label,
  error,
  checked,
  onChange,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          className="mt-1 size-4 accent-neutral-900"
        />
        <span>{label}</span>
      </label>
      <Help id={id} error={error} />
    </div>
  );
}
````

Crea `src/components/booking/BookingFlow.tsx`:

````tsx
'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createOnlineBooking, loadSlots, modifyOnlineBooking, type SlotsResult } from '@/lib/actions/booking';
import { capitalize, formatIsoDate } from '@/lib/booking/format';
import type { OnlineSlot, PublicZone, SlotGroup } from '@/lib/booking/online';
import { bookingDetailsSchema, fieldCodes } from '@/lib/booking/schemas';
import { getBookingMessages, type BookingFieldError } from '@/lib/i18n/booking';
import type { Locale } from '@/lib/i18n/locales';
import { BookingCalendar } from './BookingCalendar';
import { PublicCheckbox, PublicInput, PublicTextArea } from './PublicFields';
import { SlotPicker } from './SlotPicker';
import { accentButton, inputClass } from './styles';
import { TurnstileWidget } from './TurnstileWidget';

type Common = {
  slug: string;
  locale: Locale;
  openDates: string[];
  minDate: string;
  maxDate: string;
  /** Zonas con mesas online (el selector sale si hay más de una). */
  zones: PublicZone[];
  maxOnlineParty: number;
};

export type CreateFlowProps = Common & {
  mode: 'create';
  /** null: producción sin claves de Turnstile (no se puede reservar online). */
  siteKey: string | null;
  privacy: { holder: string; href: string };
  restaurantName: string;
};

export type ModifyFlowProps = Common & {
  mode: 'modify';
  token: string;
  initial: { partySize: number; date: string; startMs: number; zoneId: string | null; groups: SlotGroup[] };
};

type SlotsState = { status: 'idle' | 'loading' | 'ready' | 'error'; groups: SlotGroup[]; groupRequest: boolean };
type Message = { text: string; error: boolean };

const PARTY_OPTIONS = Array.from({ length: 50 }, (_, i) => i + 1);

/**
 * Reserva online y cambio con el enlace: personas → día → hora → zona → datos → resultado, en el idioma de la web.
 * Las horas las calcula el servidor (loadSlots); la BD lo vuelve a comprobar al guardar. Nunca lanza: los fallos se
 * enseñan en el idioma del comensal en una región aria-live siempre montada, y no se envía dos veces.
 */
export function BookingFlow(props: CreateFlowProps | ModifyFlowProps) {
  const { slug, locale, zones, maxOnlineParty } = props;
  const m = getBookingMessages(locale);
  const router = useRouter();
  const initial = props.mode === 'modify' ? props.initial : null;
  const [party, setParty] = useState(initial?.partySize ?? 2);
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [zoneId, setZoneId] = useState<string | null>(initial?.zoneId ?? null);
  // Al modificar, la hora actual queda elegida (si sigue ofreciéndose).
  const [slot, setSlot] = useState<OnlineSlot | null>(
    () => initial?.groups.flatMap((g) => g.slots).find((s) => s.startMs === initial.startMs && s.available) ?? null,
  );
  const [slots, setSlots] = useState<SlotsState>({ status: initial ? 'ready' : 'idle', groups: initial?.groups ?? [], groupRequest: (initial?.partySize ?? 2) > maxOnlineParty });
  const [details, setDetails] = useState({ name: '', email: '', phone: '', notes: '', privacy: false, marketing: false });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, BookingFieldError>>>({});
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>({ text: '', error: false });
  const [alternatives, setAlternatives] = useState<OnlineSlot[]>([]);
  const [result, setResult] = useState<{ status: 'confirmed' | 'pending'; email: string } | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const timeHeading = useRef<HTMLHeadingElement>(null);

  const group = party > maxOnlineParty;
  const fieldError = (key: string) => (fieldErrors[key] ? m.fields[fieldErrors[key] as BookingFieldError] : undefined);

  /** Pide las horas libres (solo vale la última respuesta) y deja la hora elegida si sigue libre. */
  async function refresh(next: { party: number; date: string | null; zoneId: string | null }) {
    const id = ++seq.current;
    setAlternatives([]);
    if (!next.date) {
      setSlots({ status: 'idle', groups: [], groupRequest: next.party > maxOnlineParty });
      return;
    }
    setSlots((s) => ({ ...s, status: 'loading' }));
    let res: SlotsResult;
    try {
      res = await loadSlots({ slug, date: next.date, partySize: next.party, zoneId: next.zoneId, token: props.mode === 'modify' ? props.token : null });
    } catch {
      res = { ok: false, error: 'generic' };
    }
    if (id !== seq.current) return;
    if (!res.ok) {
      setSlots({ status: 'error', groups: [], groupRequest: false });
      setMessage({ text: m.errors[res.error], error: true });
      return;
    }
    setSlots({ status: 'ready', groups: res.groups, groupRequest: res.groupRequest });
    setSlot((current) => (current && res.groups.some((g) => g.slots.some((s) => s.startMs === current.startMs && s.available)) ? current : null));
  }

  function change(patch: Partial<{ party: number; date: string; zoneId: string | null }>) {
    const next = { party: patch.party ?? party, date: patch.date ?? date, zoneId: patch.zoneId !== undefined ? patch.zoneId : zoneId };
    if (patch.party !== undefined) setParty(patch.party);
    if (patch.date !== undefined) setDate(patch.date);
    if (patch.zoneId !== undefined) setZoneId(patch.zoneId);
    setMessage({ text: '', error: false });
    void refresh(next);
  }

  function pickSlot(s: OnlineSlot) {
    setSlot(s);
    setAlternatives([]);
    setFieldErrors((e) => ({ ...e, startsAt: undefined }));
  }

  async function submit() {
    if (busy.current) return;
    const missing: Partial<Record<string, BookingFieldError>> = {};
    if (!date) missing.date = 'pickDate';
    if (!slot) missing.startsAt = 'pickTime';
    let checked: ReturnType<typeof bookingDetailsSchema.safeParse> | null = null;
    if (props.mode === 'create') {
      checked = bookingDetailsSchema.safeParse(details);
      if (!checked.success) Object.assign(missing, fieldCodes(checked.error));
    }
    setFieldErrors(missing);
    if (Object.keys(missing).length > 0 || !date || !slot) {
      setMessage({ text: m.fields[Object.values(missing)[0] as BookingFieldError] ?? m.errors.generic, error: true });
      return;
    }
    if (props.mode === 'create' && !token) {
      setMessage({ text: props.siteKey ? m.errors.turnstile : m.errors.turnstileMissing, error: true });
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage({ text: m.sending, error: false });
    try {
      const startsAt = new Date(slot.startMs).toISOString();
      if (props.mode === 'create') {
        const res = await createOnlineBooking({
          ...details,
          slug,
          date,
          partySize: party,
          startsAt,
          zoneId,
          locale,
          turnstileToken: token ?? '',
        });
        setResetKey((k) => k + 1);
        if (res.ok) {
          setResult({ status: res.status, email: res.email });
          setMessage({ text: '', error: false });
          requestAnimationFrame(() => resultHeading.current?.focus());
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          setMessage({ text: m.errors[res.error], error: true });
          if (res.error === 'slotTaken') {
            setSlot(null);
            setAlternatives(res.alternatives ?? []);
            void refreshKeepAlternatives(res.alternatives ?? []);
          }
        }
      } else {
        const res = await modifyOnlineBooking({ slug, token: props.token, date, partySize: party, startsAt, zoneId });
        if (res.ok) {
          setMessage({ text: m.modifiedNotice, error: false });
          router.refresh();
        } else {
          setMessage({ text: m.errors[res.error], error: true });
          if (res.error === 'slotTaken') {
            setSlot(null);
            void refreshKeepAlternatives(res.alternatives ?? []);
          }
        }
      }
    } catch {
      setMessage({ text: m.errors.generic, error: true });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /** Tras «se acaba de ocupar»: vuelve a pedir el día y enseña las alternativas. */
  async function refreshKeepAlternatives(alts: OnlineSlot[]) {
    await refresh({ party, date, zoneId });
    setAlternatives(alts);
    timeHeading.current?.focus();
  }

  if (result) {
    return (
      <section aria-labelledby="booking-result" className="flex flex-col gap-3 rounded-xl border-2 border-[var(--accent)] p-5">
        <h2 id="booking-result" ref={resultHeading} tabIndex={-1} className="text-2xl font-extrabold outline-none">
          {result.status === 'confirmed' ? m.confirmedTitle : m.pendingTitle}
        </h2>
        <p className="font-semibold">
          {m.summary(capitalize(formatIsoDate(date ?? '', locale)), slot?.label ?? '', m.partyOption(party))}
        </p>
        <p>{result.status === 'confirmed' ? m.confirmedText : m.pendingText}</p>
        <p>{m.emailSent(result.email)}</p>
      </section>
    );
  }

  const busyProps = pending ? { 'aria-disabled': true as const } : {};

  return (
    <form
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section className="flex flex-col gap-2">
        <label htmlFor="booking-party" className="text-lg font-bold">
          {m.partyLabel}
        </label>
        <select id="booking-party" value={party} onChange={(e) => change({ party: Number(e.target.value) })} className={`${inputClass} max-w-xs`}>
          {PARTY_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {m.partyOption(n)}
            </option>
          ))}
        </select>
        <p className="text-sm text-neutral-700 empty:hidden" aria-live="polite">
          {group ? m.groupNotice(maxOnlineParty) : ''}
        </p>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="booking-date-label" aria-describedby={fieldError('date') ? 'booking-date-err' : undefined}>
        <h2 id="booking-date-label" className="text-lg font-bold">
          {m.dateLabel}
        </h2>
        <BookingCalendar locale={locale} m={m} openDates={props.openDates} min={props.minDate} max={props.maxDate} selected={date} onSelect={(d) => change({ date: d })} />
        {fieldError('date') && (
          <p id="booking-date-err" className="text-sm font-medium text-red-700">
            {fieldError('date')}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="booking-time-label">
        <h2 id="booking-time-label" ref={timeHeading} tabIndex={-1} className="text-lg font-bold outline-none">
          {m.timeLabel}
        </h2>
        <p role="status" className="text-sm text-neutral-700 empty:hidden">
          {slots.status === 'idle'
            ? m.pickDayFirst
            : slots.status === 'loading'
              ? m.loadingTimes
              : slots.status === 'ready' && !slots.groups.some((g) => g.slots.some((s) => s.available))
                ? m.noTimes
                : ''}
        </p>
        {alternatives.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border-2 border-[var(--accent)] p-3">
            <p className="font-semibold">{m.alternatives}</p>
            <SlotPicker groups={[{ serviceKey: 'alt', serviceName: '', slots: alternatives }]} selected={slot?.startMs ?? null} takenLabel={m.timeTaken} onSelect={pickSlot} />
          </div>
        )}
        {slots.status === 'ready' && <SlotPicker groups={slots.groups} selected={slot?.startMs ?? null} takenLabel={m.timeTaken} onSelect={pickSlot} />}
        {fieldError('startsAt') && <p className="text-sm font-medium text-red-700">{fieldError('startsAt')}</p>}
      </section>

      {zones.length > 1 && !group && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-lg font-bold">{m.zoneLabel}</legend>
          {[{ id: null, name: m.anyZone }, ...zones].map((z) => (
            <label key={z.id ?? 'any'} className="flex items-center gap-2">
              <input type="radio" name="zone" checked={zoneId === z.id} onChange={() => change({ zoneId: z.id })} className="size-4 accent-neutral-900" />
              <span>{z.name}</span>
            </label>
          ))}
        </fieldset>
      )}

      {props.mode === 'create' && (
        <section className="flex flex-col gap-4" aria-labelledby="booking-details-label">
          <h2 id="booking-details-label" className="text-lg font-bold">
            {m.detailsTitle}
          </h2>
          <PublicInput id="booking-name" label={m.name} autoComplete="name" maxLength={120} value={details.name} error={fieldError('name')} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
          <PublicInput id="booking-email" label={m.email} type="email" autoComplete="email" inputMode="email" value={details.email} hint={m.emailHint} error={fieldError('email')} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
          <PublicInput id="booking-phone" label={m.phone} type="tel" autoComplete="tel" inputMode="tel" value={details.phone} hint={m.phoneHint} error={fieldError('phone')} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
          <PublicTextArea id="booking-notes" label={m.notes} rows={3} maxLength={500} value={details.notes} hint={m.notesHint} error={fieldError('notes')} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
          <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-3 text-sm">
            <p>
              {m.privacyInfo(props.privacy.holder)}{' '}
              <a href={props.privacy.href} target="_blank" rel="noopener" className="font-semibold underline">
                {m.privacyLink}
              </a>
            </p>
            <PublicCheckbox id="booking-privacy" label={m.privacyAccept} checked={details.privacy} error={fieldError('privacy')} onChange={(v) => setDetails({ ...details, privacy: v })} />
          </div>
          <PublicCheckbox id="booking-marketing" label={m.marketing(props.restaurantName)} checked={details.marketing} onChange={(v) => setDetails({ ...details, marketing: v })} />
          {props.siteKey ? (
            <TurnstileWidget siteKey={props.siteKey} locale={locale} label={m.securityCheck} resetKey={resetKey} onToken={setToken} />
          ) : (
            <p className="font-semibold text-red-700">{m.errors.turnstileMissing}</p>
          )}
        </section>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <button type="submit" className={accentButton} aria-busy={pending} {...busyProps}>
            {pending ? m.sending : props.mode === 'modify' ? m.saveChanges : group ? m.submitRequest : m.submit}
          </button>
        </div>
        {/* Siempre montadas: los avisos se anuncian al cambiar. */}
        <p aria-live="polite" className={message.text && !message.error ? 'font-semibold' : 'sr-only'}>
          {message.error ? '' : message.text}
        </p>
        <p role="alert" className={message.text && message.error ? 'font-semibold text-red-700' : 'sr-only'}>
          {message.error ? message.text : ''}
        </p>
      </div>
    </form>
  );
}
````

Crea `src/components/booking/CancelBooking.tsx`:

````tsx
'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { cancelOnlineBooking } from '@/lib/actions/booking';
import { getBookingMessages } from '@/lib/i18n/booking';
import type { Locale } from '@/lib/i18n/locales';
import { outlineButton } from './styles';

/** «Cancelar reserva» con confirmación en la propia página (sin diálogos del navegador). */
export function CancelBooking({ slug, token, locale }: { slug: string; token: string; locale: Locale }) {
  const m = getBookingMessages(locale);
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const busy = useRef(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  async function cancel() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const res = await cancelOnlineBooking({ slug, token });
      if (res.ok) {
        setMessage({ text: m.cancelledNotice, error: false });
        setAsking(false);
        router.refresh();
      } else {
        setMessage({ text: m.errors[res.error], error: true });
      }
    } catch {
      setMessage({ text: m.errors.generic, error: true });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const busyProps = pending ? { 'aria-disabled': true as const } : {};
  return (
    <div className="flex flex-col gap-3">
      {asking ? (
        <div role="group" aria-labelledby="cancel-question" className="flex flex-col gap-3 rounded-lg border-2 border-red-700 p-4">
          <p id="cancel-question" className="font-bold">
            {m.cancelQuestion}
          </p>
          <div className="flex flex-wrap gap-3">
            <button ref={yesRef} type="button" onClick={() => void cancel()} aria-busy={pending} {...busyProps} className={`${outlineButton} border-red-700 text-red-800`}>
              {m.cancelYes}
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                requestAnimationFrame(() => openRef.current?.focus());
              }}
              {...busyProps}
              className={outlineButton}
            >
              {m.cancelNo}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            ref={openRef}
            type="button"
            onClick={() => {
              setAsking(true);
              setMessage({ text: '', error: false });
              requestAnimationFrame(() => yesRef.current?.focus());
            }}
            className={`${outlineButton} border-red-700 text-red-800`}
          >
            {m.cancelBooking}
          </button>
        </div>
      )}
      <p aria-live="polite" className={message.text && !message.error ? 'font-semibold' : 'sr-only'}>
        {message.error ? '' : message.text}
      </p>
      <p role="alert" className={message.text && message.error ? 'font-semibold text-red-700' : 'sr-only'}>
        {message.error ? message.text : ''}
      </p>
    </div>
  );
}
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/components/booking && pnpm typecheck && pnpm lint`
Expected: PASS: 4 pruebas de marcado (un solo `tabindex="0"`, días cerrados `aria-disabled` y no `disabled`, nombre accesible que empieza por el número que se ve, horas agrupadas por servicio); typecheck y lint sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/components/booking/styles.ts src/components/booking/TurnstileWidget.tsx src/components/booking/BookingCalendar.tsx src/components/booking/SlotPicker.tsx src/components/booking/PublicFields.tsx src/components/booking/BookingFlow.tsx src/components/booking/CancelBooking.tsx src/components/booking/BookingCalendar.test.tsx
git commit -m "Reserva online: componentes del flujo (calendario, horas, datos, Turnstile y cancelar)"
```

---

### Task 18: Página /[slug]/reservar (y la informativa sin reserva online)

**Files:**
- Create: `src/components/booking/BookingHeader.tsx`
- Create: `src/app/[slug]/reservar/page.tsx`

**Interfaces:**
- Consumes: Tareas 6 (`turnstileKeys`), 8 (`openDates`), 10, 15 (`isBookingEnabled`, `getPublicBookingDay`), 17 (`BookingFlow`); `getPublicRestaurant`, `requestLocale`, `localeHref`, `languageAlternates`, `publicUrl`, `todayInTimeZone`, `addDays`, `formatPhone`, `PublicShell`.
- Produces:
  - `src/components/booking/BookingHeader.tsx`: `BookingHeader({ restaurant, locale })`.
  - `src/app/[slug]/reservar/page.tsx`: la reserva online en el idioma de la mini-web o, si no hay reserva online o mesas online, «Reserva por teléfono» con el teléfono.

Lee antes `src/app/[slug]/aviso-legal/page.tsx` (redirecciones de slug antiguo y forma canónica con `?lang=`) y `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` (`alternates`).

- [ ] **Step 1: Implementa**

Crea `src/components/booking/BookingHeader.tsx`:

````tsx
import Image from 'next/image';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { mediaUrl } from '@/lib/public/data';
import { localeHref } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';

/** Cabecera de las páginas de reserva: logo y nombre, que vuelven a la mini-web. */
export function BookingHeader({ restaurant: r, locale }: { restaurant: PublicRestaurant; locale: Locale }) {
  const m = getMessages(locale);
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
        <Link href={localeHref(`/${r.slug}`, locale)} className="flex items-center gap-3 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">
          {r.logoPath && (
            <span className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <Image src={mediaUrl(r.logoPath)} alt={m.logoAlt(r.name)} fill unoptimized sizes="48px" className="object-contain" />
            </span>
          )}
          <span className="text-lg font-extrabold">{r.name}</span>
        </Link>
      </div>
    </header>
  );
}
````

Crea `src/app/[slug]/reservar/page.tsx`:

````tsx
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { PublicShell } from '@/components/public/PublicShell';
import { getPublicBookingDay, isBookingEnabled } from '@/lib/booking/data';
import { openDates } from '@/lib/booking/online';
import { siteUrl, turnstileKeys } from '@/lib/env';
import { getBookingMessages } from '@/lib/i18n/booking';
import { isLocale, langParam } from '@/lib/i18n/locales';
import { getPublicRestaurant } from '@/lib/public/data';
import { localeHref } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';
import { languageAlternates, publicUrl } from '@/lib/public/seo';
import { addDays } from '@/lib/reservations/time';
import { todayInTimeZone } from '@/lib/schedule';
import { formatPhone } from '@/lib/spain';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const path = (slug: string) => `/${slug}/reservar`;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const result = await getPublicRestaurant(slug);
  if (result?.kind !== 'restaurant') return {};
  const r = result.restaurant;
  const locale = await requestLocale(langParam(sp.lang), r.enabledLocales);
  const site = siteUrl();
  return {
    title: { absolute: getBookingMessages(locale).bookTitle(r.name) },
    alternates: { canonical: publicUrl(site, path(r.slug), locale), languages: languageAlternates(site, path(r.slug), r.enabledLocales) },
  };
}

/** Reserva online (o, si el restaurante no la tiene, cómo reservar por teléfono). */
export default async function BookingPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const lang = langParam(sp.lang);
  const result = await getPublicRestaurant(slug);
  if (!result) notFound();
  const target = (s: string) => (isLocale(lang) ? localeHref(path(s), lang) : path(s));
  if (result.kind === 'redirect') permanentRedirect(target(result.slug));
  const r = result.restaurant;
  if (slug !== r.slug) permanentRedirect(target(r.slug));
  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getBookingMessages(locale);

  const today = todayInTimeZone(r.timezone);
  const day = (await isBookingEnabled(r.slug)) ? await getPublicBookingDay(r.slug, today) : null;

  return (
    <PublicShell restaurant={r} locale={locale} path={path(r.slug)}>
      <BookingHeader restaurant={r} locale={locale} />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-6">
        {day ? (
          <>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">{m.bookTitle(r.name)}</h1>
              <p className="mt-1 text-neutral-600">{m.bookIntro}</p>
            </div>
            <BookingFlow
              mode="create"
              slug={r.slug}
              locale={locale}
              openDates={openDates(day)}
              minDate={addDays(today, -1)}
              maxDate={addDays(today, day.rules.maxAdvanceDays)}
              zones={day.zones}
              maxOnlineParty={day.rules.maxOnlineParty}
              siteKey={turnstileKeys()?.siteKey ?? null}
              privacy={{ holder: r.legalName ?? r.name, href: localeHref(`/${r.slug}/privacidad`, locale) }}
              restaurantName={r.name}
            />
          </>
        ) : (
          <section className="flex flex-col gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{m.phoneOnlyTitle}</h1>
            {r.phone ? (
              <p className="text-lg">
                {m.phoneOnlyText}{' '}
                <a href={`tel:${r.phone}`} className="font-bold underline">
                  {formatPhone(r.phone)}
                </a>
              </p>
            ) : (
              <p className="text-lg">{m.phoneOnlyNoPhone}</p>
            )}
          </section>
        )}
      </main>
    </PublicShell>
  );
}
````

- [ ] **Step 2: Comprueba**

Run: `pnpm typecheck && pnpm lint`
Expected: Sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/BookingHeader.tsx 'src/app/[slug]/reservar/page.tsx'
git commit -m "Página pública de reservar"
```

---

### Task 19: Página del enlace /[slug]/reserva/[token]

**Files:**
- Create: `src/lib/booking/status-style.ts`
- Create: `src/app/[slug]/reserva/[token]/page.tsx`

**Interfaces:**
- Consumes: Tareas 7 (`isTokenShape`, `tokenHash`, `withinRateLimit`, `clientIpFrom`), 8 (`onlineSlots`, `openDates`, `formatLongDate`, `capitalize`), 15 (`getPublicReservation`, `getPublicBookingDay`), 17 (`BookingFlow`, `CancelBooking`, `accentButton`), 18 (`BookingHeader`); `serviceDateOf`, `directionsUrl`, `fullAddress`, `createAdminClient`.
- Produces:
  - `src/lib/booking/status-style.ts`: `PUBLIC_STATUS_STYLES`.
  - `src/app/[slug]/reserva/[token]/page.tsx`: `noindex`, `nofollow`, `referrer: 'no-referrer'`; estado (color y texto), datos, «Cómo llegar», «Cambiar la reserva» (mismo selector, sin contar la propia reserva), «Cancelar reserva» con confirmación; fuera de plazo, «Para cambiar algo, llama al restaurante: …»; token desconocido o de otro restaurante, «No encontramos esta reserva»; demasiados intentos, su aviso.

Lee antes la decisión 14 y el apartado `robots` y `referrer` de `generate-metadata.md`.

- [ ] **Step 1: Implementa**

Crea `src/lib/booking/status-style.ts`:

````ts
import type { ReservationStatus } from '@/lib/reservations/codes';

/** Color del estado en la página del enlace (siempre con su texto al lado). */
export const PUBLIC_STATUS_STYLES: Record<ReservationStatus, string> = {
  pending: 'border-amber-700 bg-amber-50 text-amber-900',
  confirmed: 'border-green-700 bg-green-50 text-green-900',
  seated: 'border-green-700 bg-green-50 text-green-900',
  completed: 'border-neutral-400 bg-neutral-50 text-neutral-700',
  cancelled_customer: 'border-red-700 bg-red-50 text-red-900',
  cancelled_restaurant: 'border-red-700 bg-red-50 text-red-900',
  rejected: 'border-red-700 bg-red-50 text-red-900',
  no_show: 'border-neutral-400 bg-neutral-50 text-neutral-700',
};
````

Crea `src/app/[slug]/reserva/[token]/page.tsx`:

````tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { CancelBooking } from '@/components/booking/CancelBooking';
import { accentButton } from '@/components/booking/styles';
import { PublicShell } from '@/components/public/PublicShell';
import { getPublicBookingDay, getPublicReservation } from '@/lib/booking/data';
import { capitalize, formatLongDate } from '@/lib/booking/format';
import { onlineSlots, openDates } from '@/lib/booking/online';
import { clientIpFrom, withinRateLimit } from '@/lib/booking/rate-limit';
import { PUBLIC_STATUS_STYLES } from '@/lib/booking/status-style';
import { isTokenShape, tokenHash } from '@/lib/booking/token';
import { getBookingMessages } from '@/lib/i18n/booking';
import { isLocale, langParam } from '@/lib/i18n/locales';
import { getPublicRestaurant } from '@/lib/public/data';
import { directionsUrl, fullAddress, localeHref } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';
import { serviceDateOf } from '@/lib/reservations/day';
import { addDays, formatTime } from '@/lib/reservations/time';
import { todayInTimeZone } from '@/lib/schedule';
import { formatPhone } from '@/lib/spain';
import { createAdminClient } from '@/lib/supabase/admin';

type Props = {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// El enlace es secreto: ni buscadores ni Referer hacia otras webs.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const result = await getPublicRestaurant(slug);
  const locale = result?.kind === 'restaurant' ? await requestLocale(langParam(sp.lang), result.restaurant.enabledLocales) : 'es';
  return { title: { absolute: getBookingMessages(locale).manageTitle }, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Página del enlace del comensal: estado, datos, «Cómo llegar», «Modificar» y «Cancelar reserva». */
export default async function ManageBookingPage({ params, searchParams }: Props) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const lang = langParam(sp.lang);
  const result = await getPublicRestaurant(slug);
  if (!result) notFound();
  const target = (s: string) => (isLocale(lang) ? localeHref(`/${s}/reserva/${token}`, lang) : `/${s}/reserva/${token}`);
  if (result.kind === 'redirect') permanentRedirect(target(result.slug));
  const r = result.restaurant;
  if (slug !== r.slug) permanentRedirect(target(r.slug));
  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getBookingMessages(locale);
  const path = `/${r.slug}/reserva/${token}`;

  const allowed = await withinRateLimit(createAdminClient(), 'token', r.slug, clientIpFrom(await headers()));
  const hash = isTokenShape(token) ? tokenHash(token) : null;
  const reservation = allowed && hash ? await getPublicReservation(r.slug, hash) : null;

  if (!reservation) {
    return (
      <PublicShell restaurant={r} locale={locale} path={path}>
        <BookingHeader restaurant={r} locale={locale} />
        <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-10">
          <h1 className="text-3xl font-extrabold tracking-tight">{allowed ? m.notFoundTitle : m.errors.tooMany}</h1>
          {allowed && <p className="text-neutral-700">{m.notFoundText}</p>}
        </main>
      </PublicShell>
    );
  }

  const tz = r.timezone;
  const address = fullAddress(r);
  const date = capitalize(formatLongDate(reservation.startMs, locale, tz));
  const time = formatTime(reservation.startMs, tz);
  const canModify = reservation.canChange && reservation.onlineEnabled;
  // Para el selector de «Modificar»: el día de servicio de la reserva, sin contar la propia reserva.
  const today = todayInTimeZone(tz);
  const day = canModify ? await getPublicBookingDay(r.slug, today, hash) : null;
  const serviceDate = day ? serviceDateOf(reservation.startMs, tz, day.services, day.exceptions) : null;
  const ownDay = day && serviceDate ? await getPublicBookingDay(r.slug, serviceDate, hash) : null;
  const rows: [string, string][] = [
    ...(reservation.customerName ? [[m.detailName, reservation.customerName] as [string, string]] : []),
    [m.detailDate, date],
    [m.detailTime, time],
    [m.detailParty, m.partyOption(reservation.partySize)],
    ...(reservation.zoneName ? [[m.detailZone, reservation.zoneName] as [string, string]] : []),
    ...(reservation.notes ? [[m.detailNotes, reservation.notes] as [string, string]] : []),
  ];

  return (
    <PublicShell restaurant={r} locale={locale} path={path}>
      <BookingHeader restaurant={r} locale={locale} />
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 pt-6">
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">{m.manageTitle}</h1>
          <p>
            <span className={`inline-flex rounded-full border-2 px-3 py-1 text-sm font-bold ${PUBLIC_STATUS_STYLES[reservation.status]}`}>
              {m.status[reservation.status]}
            </span>
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm text-neutral-600">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-3">
            {address && (
              <a href={directionsUrl(address)} target="_blank" rel="noopener noreferrer" className={accentButton}>
                {m.emails.directions}
              </a>
            )}
          </div>
          {reservation.canChange ? (
            <p className="text-neutral-700">
              {m.changeUntil(formatLongDate(reservation.changeUntilMs, locale, tz, false), formatTime(reservation.changeUntilMs, tz))}
            </p>
          ) : (
            (reservation.status === 'pending' || reservation.status === 'confirmed') && (
              <p className="font-semibold">{r.phone ? m.callToChange(formatPhone(r.phone)) : m.contactToChange}</p>
            )
          )}
        </section>

        {canModify && day && ownDay && serviceDate && (
          <section className="flex flex-col gap-4" aria-labelledby="modify-title">
            <h2 id="modify-title" className="text-2xl font-extrabold">
              {m.modifyTitle}
            </h2>
            <BookingFlow
              mode="modify"
              slug={r.slug}
              locale={locale}
              token={token}
              openDates={openDates(day)}
              minDate={addDays(today, -1)}
              maxDate={addDays(today, day.rules.maxAdvanceDays)}
              zones={day.zones}
              maxOnlineParty={day.rules.maxOnlineParty}
              initial={{
                partySize: reservation.partySize,
                date: serviceDate,
                startMs: reservation.startMs,
                zoneId: reservation.zoneId,
                groups: onlineSlots(ownDay, serviceDate, reservation.partySize, reservation.zoneId),
              }}
            />
          </section>
        )}

        {reservation.canChange && (
          <section className="flex flex-col gap-3">
            <CancelBooking slug={r.slug} token={token} locale={locale} />
          </section>
        )}
      </main>
    </PublicShell>
  );
}
````

- [ ] **Step 2: Comprueba**

Run: `pnpm typecheck && pnpm lint`
Expected: Sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/booking/status-style.ts 'src/app/[slug]/reserva/[token]/page.tsx'
git commit -m "Página del enlace del comensal: ver, modificar y cancelar"
```

---

### Task 20: Política de privacidad de las reservas en 6 idiomas y enlace en el pie

**Files:**
- Create: `src/lib/legal/privacy.ts`
- Create (prueba): `src/lib/legal/privacy.test.ts`
- Create: `src/app/[slug]/privacidad/page.tsx`
- Modify: `src/components/public/PublicShell.tsx`

**Interfaces:**
- Consumes: `BRAND`, `fullAddress`, `PublicRestaurant`, `LEGAL_REVIEW_PENDING`, `getBookingMessages(locale).privacyTitle` (tarea 10).
- Produces:
  - `src/lib/legal/privacy.ts`: `type LegalSection = { heading, body }` y `privacySections(restaurant, locale) → LegalSection[]` (siete secciones).
  - `src/app/[slug]/privacidad/page.tsx` (`noindex`).
  - `PublicShell`: enlace «Política de privacidad» junto al aviso legal.

Lee antes `src/lib/legal/legal-notice.ts` y `src/app/[slug]/aviso-legal/page.tsx`.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/legal/privacy.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/locales';
import { SAMPLE_RESTAURANT } from '@/lib/public/fixtures';
import { privacySections } from './privacy';

describe('política de privacidad de las reservas', () => {
  it('en los seis idiomas, con las mismas siete secciones y los datos del responsable', () => {
    for (const locale of LOCALES) {
      const sections = privacySections(SAMPLE_RESTAURANT, locale);
      expect(sections, locale).toHaveLength(7);
      const text = sections.map((s) => `${s.heading} ${s.body}`).join(' ');
      for (const fact of ['Taberna Pepe SL', 'B12345674', 'Calle Mayor 1, 28013 Madrid', 'hola@lataberna.es', 'FByte Solutions', 'Supabase', 'Vercel', 'Resend', 'Cloudflare Turnstile', 'aepd.es', '3']) {
        expect(text, `${locale}: ${fact}`).toContain(fact);
      }
      for (const s of sections) expect(s.heading.trim() && s.body.trim(), locale).toBeTruthy();
    }
  });

  it('sin razón social usa el nombre del restaurante', () => {
    expect(privacySections({ ...SAMPLE_RESTAURANT, legalName: null }, 'es')[0].body).toContain('La Taberna de Pepe');
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/legal && pnpm typecheck`
Expected: FAIL: `Failed to resolve import "./privacy"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/legal/privacy.ts`:

````ts
import { BRAND } from '@/config/brand';
import type { Locale } from '@/lib/i18n/locales';
import { fullAddress } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';

type Holder = Pick<PublicRestaurant, 'name' | 'legalName' | 'taxId' | 'addressLine' | 'postalCode' | 'city' | 'contactEmail'>;
type Facts = { holder: string; taxId: string; address: string; email: string; company: string };
export type LegalSection = { heading: string; body: string };

const SUBPROCESSORS = 'Supabase (UE), Vercel, Resend, Cloudflare Turnstile';

/** Política de privacidad de las reservas (plantilla PENDIENTE DE REVISIÓN LEGAL), en los seis idiomas. */
const TEXTS: Record<Locale, (f: Facts) => LegalSection[]> = {
  es: (f) => [
    { heading: 'Responsable', body: `${f.holder}, con CIF/NIF ${f.taxId}, domicilio en ${f.address} y email ${f.email}.` },
    { heading: 'Encargado del tratamiento', body: `${f.company}, que presta el servicio técnico de reservas al restaurante y solo trata tus datos siguiendo sus instrucciones.` },
    { heading: 'Para qué usamos tus datos', body: 'Para gestionar tu reserva (confirmarla, recordártela y avisarte de cambios) y, solo si lo aceptas, para enviarte comunicaciones comerciales del restaurante.' },
    { heading: 'Base legal', body: 'La aplicación de medidas precontractuales a petición tuya (la reserva) y tu consentimiento (las comunicaciones comerciales, que puedes retirar cuando quieras).' },
    { heading: 'Cuánto tiempo', body: 'Mientras sea necesario para tu reserva. Si pasan 3 años sin actividad, tus datos se anonimizan.' },
    { heading: 'Destinatarios', body: `No cedemos tus datos a terceros. Los tratan, como subencargados, ${SUBPROCESSORS}. Las transferencias fuera de la UE se amparan en cláusulas contractuales tipo o en el Marco de Privacidad de Datos UE-EE. UU.` },
    { heading: 'Tus derechos', body: `Puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${f.email}. Si crees que no hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).` },
  ],
  en: (f) => [
    { heading: 'Controller', body: `${f.holder}, tax ID ${f.taxId}, address ${f.address}, email ${f.email}.` },
    { heading: 'Processor', body: `${f.company}, which provides the booking service to the restaurant and only processes your data on its instructions.` },
    { heading: 'What we use your data for', body: 'To manage your booking (confirming it, reminding you and telling you about changes) and, only if you agree, to send you marketing from the restaurant.' },
    { heading: 'Legal basis', body: 'Taking steps at your request before a contract (the booking) and your consent (marketing, which you can withdraw at any time).' },
    { heading: 'How long', body: 'As long as needed for your booking. After 3 years without activity, your data is anonymised.' },
    { heading: 'Recipients', body: `We do not share your data with third parties. It is processed, as sub-processors, by ${SUBPROCESSORS}. Transfers outside the EU rely on standard contractual clauses or the EU-US Data Privacy Framework.` },
    { heading: 'Your rights', body: `You can request access, rectification, erasure, objection, restriction and portability by writing to ${f.email}. You can also complain to the Spanish Data Protection Agency (aepd.es).` },
  ],
  ca: (f) => [
    { heading: 'Responsable', body: `${f.holder}, amb CIF/NIF ${f.taxId}, domicili a ${f.address} i correu ${f.email}.` },
    { heading: 'Encarregat del tractament', body: `${f.company}, que presta el servei tècnic de reserves al restaurant i només tracta les teves dades seguint-ne les instruccions.` },
    { heading: 'Per a què fem servir les teves dades', body: 'Per gestionar la teva reserva (confirmar-la, recordar-te-la i avisar-te de canvis) i, només si ho acceptes, per enviar-te comunicacions comercials del restaurant.' },
    { heading: 'Base legal', body: 'L’aplicació de mesures precontractuals a petició teva (la reserva) i el teu consentiment (les comunicacions comercials, que pots retirar quan vulguis).' },
    { heading: 'Quant de temps', body: 'Mentre calgui per a la teva reserva. Si passen 3 anys sense activitat, les teves dades s’anonimitzen.' },
    { heading: 'Destinataris', body: `No cedim les teves dades a tercers. Les tracten, com a subencarregats, ${SUBPROCESSORS}. Les transferències fora de la UE s’emparen en clàusules contractuals tipus o en el Marc de Privadesa de Dades UE-EUA.` },
    { heading: 'Els teus drets', body: `Pots demanar accés, rectificació, supressió, oposició, limitació i portabilitat escrivint a ${f.email}. També pots reclamar davant l’Agència Espanyola de Protecció de Dades (aepd.es).` },
  ],
  fr: (f) => [
    { heading: 'Responsable du traitement', body: `${f.holder}, NIF ${f.taxId}, adresse ${f.address}, e-mail ${f.email}.` },
    { heading: 'Sous-traitant', body: `${f.company}, qui fournit le service de réservation au restaurant et ne traite vos données que sur ses instructions.` },
    { heading: 'Finalités', body: 'Gérer votre réservation (la confirmer, vous la rappeler et vous prévenir des changements) et, seulement si vous l’acceptez, vous envoyer des communications commerciales du restaurant.' },
    { heading: 'Base légale', body: 'L’exécution de mesures précontractuelles à votre demande (la réservation) et votre consentement (les communications commerciales, que vous pouvez retirer à tout moment).' },
    { heading: 'Durée de conservation', body: 'Le temps nécessaire à votre réservation. Après 3 ans sans activité, vos données sont anonymisées.' },
    { heading: 'Destinataires', body: `Nous ne cédons pas vos données à des tiers. Elles sont traitées, en tant que sous-traitants ultérieurs, par ${SUBPROCESSORS}. Les transferts hors de l’UE reposent sur des clauses contractuelles types ou sur le cadre de protection des données UE-États-Unis.` },
    { heading: 'Vos droits', body: `Vous pouvez demander l’accès, la rectification, l’effacement, l’opposition, la limitation et la portabilité en écrivant à ${f.email}. Vous pouvez aussi saisir l’Agence espagnole de protection des données (aepd.es).` },
  ],
  de: (f) => [
    { heading: 'Verantwortlicher', body: `${f.holder}, Steuernummer ${f.taxId}, Anschrift ${f.address}, E-Mail ${f.email}.` },
    { heading: 'Auftragsverarbeiter', body: `${f.company}, das dem Restaurant den Reservierungsdienst bereitstellt und Ihre Daten nur nach dessen Weisung verarbeitet.` },
    { heading: 'Zwecke', body: 'Verwaltung Ihrer Reservierung (Bestätigung, Erinnerung und Hinweise auf Änderungen) und, nur mit Ihrer Einwilligung, Werbung des Restaurants.' },
    { heading: 'Rechtsgrundlage', body: 'Vorvertragliche Maßnahmen auf Ihre Anfrage (die Reservierung) und Ihre Einwilligung (Werbung, jederzeit widerrufbar).' },
    { heading: 'Speicherdauer', body: 'So lange, wie es für Ihre Reservierung nötig ist. Nach 3 Jahren ohne Aktivität werden Ihre Daten anonymisiert.' },
    { heading: 'Empfänger', body: `Wir geben Ihre Daten nicht an Dritte weiter. Als Unterauftragsverarbeiter verarbeiten sie ${SUBPROCESSORS}. Übermittlungen außerhalb der EU stützen sich auf Standardvertragsklauseln oder das EU-US Data Privacy Framework.` },
    { heading: 'Ihre Rechte', body: `Sie können Auskunft, Berichtigung, Löschung, Widerspruch, Einschränkung und Datenübertragbarkeit unter ${f.email} verlangen. Sie können sich auch bei der spanischen Datenschutzbehörde (aepd.es) beschweren.` },
  ],
  it: (f) => [
    { heading: 'Titolare del trattamento', body: `${f.holder}, codice fiscale ${f.taxId}, sede in ${f.address}, email ${f.email}.` },
    { heading: 'Responsabile del trattamento', body: `${f.company}, che fornisce al ristorante il servizio di prenotazione e tratta i tuoi dati solo secondo le sue istruzioni.` },
    { heading: 'Finalità', body: 'Gestire la tua prenotazione (confermarla, ricordartela e avvisarti delle modifiche) e, solo se lo accetti, inviarti comunicazioni commerciali del ristorante.' },
    { heading: 'Base giuridica', body: 'L’esecuzione di misure precontrattuali su tua richiesta (la prenotazione) e il tuo consenso (le comunicazioni commerciali, revocabile in qualsiasi momento).' },
    { heading: 'Conservazione', body: 'Per il tempo necessario alla tua prenotazione. Dopo 3 anni senza attività, i tuoi dati vengono anonimizzati.' },
    { heading: 'Destinatari', body: `Non cediamo i tuoi dati a terzi. Li trattano, come sub-responsabili, ${SUBPROCESSORS}. I trasferimenti fuori dall’UE si basano su clausole contrattuali tipo o sul Data Privacy Framework UE-USA.` },
    { heading: 'I tuoi diritti', body: `Puoi chiedere accesso, rettifica, cancellazione, opposizione, limitazione e portabilità scrivendo a ${f.email}. Puoi anche presentare reclamo all’Agenzia spagnola per la protezione dei dati (aepd.es).` },
  ],
};

export function privacySections(r: Holder, locale: Locale): LegalSection[] {
  return TEXTS[locale]({
    holder: r.legalName ?? r.name,
    taxId: r.taxId ?? '—',
    address: fullAddress(r) ?? '—',
    email: r.contactEmail ?? '—',
    company: BRAND.company,
  });
}
````

Crea `src/app/[slug]/privacidad/page.tsx`:

````tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { PublicShell } from '@/components/public/PublicShell';
import { getBookingMessages } from '@/lib/i18n/booking';
import { isLocale, langParam } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { LEGAL_REVIEW_PENDING } from '@/lib/legal/dpa';
import { privacySections } from '@/lib/legal/privacy';
import { getPublicRestaurant } from '@/lib/public/data';
import { localeHref } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const result = await getPublicRestaurant(slug);
  if (result?.kind !== 'restaurant') return {};
  const locale = await requestLocale(langParam(sp.lang), result.restaurant.enabledLocales);
  return { title: { absolute: `${getBookingMessages(locale).privacyTitle} · ${result.restaurant.name}` }, robots: { index: false } };
}

/** Política de privacidad de las reservas del restaurante (plantilla pendiente de revisión legal), en su idioma. */
export default async function PrivacyPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const lang = langParam(sp.lang);
  const result = await getPublicRestaurant(slug);
  if (!result) notFound();
  const target = (s: string) => (isLocale(lang) ? localeHref(`/${s}/privacidad`, lang) : `/${s}/privacidad`);
  if (result.kind === 'redirect') permanentRedirect(target(result.slug));
  const r = result.restaurant;
  if (slug !== r.slug) permanentRedirect(target(r.slug));
  const locale = await requestLocale(lang, r.enabledLocales);
  return (
    <PublicShell restaurant={r} locale={locale} path={`/${r.slug}/privacidad`}>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-10">
        <Link href={localeHref(`/${r.slug}`, locale)} className="text-sm font-semibold text-[var(--accent-text)] hover:underline">
          ← {getMessages(locale).backToRestaurant}
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">{getBookingMessages(locale).privacyTitle}</h1>
        <p lang="es" className="font-bold text-red-700">
          {LEGAL_REVIEW_PENDING}
        </p>
        <div className="flex flex-col gap-5">
          {privacySections(r, locale).map((s) => (
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
````

En `src/components/public/PublicShell.tsx`, sustituye:

````tsx
import { publicAccentTheme } from '@/lib/color';
import type { Locale } from '@/lib/i18n/locales';
````

por:

````tsx
import { publicAccentTheme } from '@/lib/color';
import { getBookingMessages } from '@/lib/i18n/booking';
import type { Locale } from '@/lib/i18n/locales';
````

En `src/components/public/PublicShell.tsx`, sustituye:

````tsx
        )}
        <p>
          <Link href={localeHref(`/${restaurant.slug}/aviso-legal`, locale)} className="hover:underline">
            {m.legalNotice}
          </Link>
````

por:

````tsx
        )}
        <p className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link href={localeHref(`/${restaurant.slug}/aviso-legal`, locale)} className="hover:underline">
            {m.legalNotice}
          </Link>
          <Link href={localeHref(`/${restaurant.slug}/privacidad`, locale)} className="hover:underline">
            {getBookingMessages(locale).privacyTitle}
          </Link>
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/legal && pnpm typecheck`
Expected: PASS: 2 pruebas nuevas; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/legal/privacy.ts src/lib/legal/privacy.test.ts 'src/app/[slug]/privacidad/page.tsx' src/components/public/PublicShell.tsx
git commit -m "Política de privacidad de las reservas (plantilla en seis idiomas) y enlace en el pie"
```

---

### Task 21: Botón «Reservar» en la mini-web y en la carta, acceptsReservations y sitemap

**Files:**
- Modify: `src/lib/public/format.ts`
- Modify: `src/lib/public/jsonld.ts`
- Modify: `src/lib/public/seo.test.ts`
- Modify: `src/app/[slug]/page.tsx`
- Modify: `src/app/[slug]/menu/page.tsx`
- Modify: `src/app/sitemap.ts`
- Modify: `src/app/sitemap.test.ts`

**Interfaces:**
- Consumes: `isBookingEnabled` (tarea 15), `getBookingMessages` (tarea 10).
- Produces:
  - `bookingPath(slug) → '/<slug>/reservar'` en `src/lib/public/format.ts`.
  - `restaurantJsonLd(r, { …, reservationUrl? })` añade `acceptsReservations`.
  - Botón «Reservar» destacado (primero, junto a «Ver carta») en la mini-web y en la cabecera de la carta, si `isBookingEnabled`; un fallo al consultarlo no tumba la página.
  - El sitemap lleva `/<slug>/reservar` de cada restaurante en cada idioma.

Lee antes `src/app/[slug]/page.tsx`, `src/app/[slug]/menu/page.tsx`, `src/lib/public/jsonld.ts` y `src/app/sitemap.ts`.

- [ ] **Step 1: Escribe las pruebas que fallan**

En `src/lib/public/seo.test.ts`, sustituye:

````ts
    expect(withMenu.hasMenu).toBe(`${site}/la-taberna/menu`);
  });
});
````

por:

````ts
    expect(withMenu.hasMenu).toBe(`${site}/la-taberna/menu`);
  });

  it('con la reserva online, acceptsReservations lleva la página de reservar', () => {
    expect(ld.acceptsReservations).toBeUndefined();
    const bookable = restaurantJsonLd(SAMPLE_RESTAURANT, {
      url: `${site}/la-taberna`,
      mediaUrl: (p) => `https://cdn.test/${p}`,
      reservationUrl: `${site}/la-taberna/reservar`,
    });
    expect(bookable.acceptsReservations).toBe(`${site}/la-taberna/reservar`);
  });
});
````

En `src/app/sitemap.test.ts`, sustituye:

````ts
  it('lleva las mini-webs y sus cartas', async () => {
    expect((await sitemap()).map((e) => e.url)).toEqual(['https://mesa.test/la-taberna', 'https://mesa.test/la-taberna/menu']);
  });
````

por:

````ts
  it('lleva las mini-webs y sus cartas', async () => {
    expect((await sitemap()).map((e) => e.url)).toEqual([
      'https://mesa.test/la-taberna',
      'https://mesa.test/la-taberna/reservar',
      'https://mesa.test/la-taberna/menu',
    ]);
  });
````

En `src/app/sitemap.test.ts`, sustituye:

````ts
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await sitemap()).map((e) => e.url)).toEqual(['https://mesa.test/la-taberna']);
    expect(log).toHaveBeenCalledOnce();
````

por:

````ts
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await sitemap()).map((e) => e.url)).toEqual(['https://mesa.test/la-taberna', 'https://mesa.test/la-taberna/reservar']);
    expect(log).toHaveBeenCalledOnce();
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/public src/app/sitemap.test.ts && pnpm typecheck`
Expected: FAIL: en `seo.test.ts`, `expected undefined to be "…/la-taberna/reservar"`; en `sitemap.test.ts`, falta `…/la-taberna/reservar`.

- [ ] **Step 3: Implementa**

En `src/lib/public/format.ts`, sustituye:

````ts

/** Pestaña de una carta, conservando el idioma: /la-taberna/menu?lang=en&carta=<id>. */
````

por:

````ts

/** Página de reservar (Hito 4B). */
export function bookingPath(slug: string): string {
  return `/${slug}/reservar`;
}

/** Pestaña de una carta, conservando el idioma: /la-taberna/menu?lang=en&carta=<id>. */
````

En `src/lib/public/jsonld.ts`, sustituye:

````ts
  r: PublicRestaurant,
  opts: { url: string; mediaUrl: (path: string) => string; menuUrl?: string },
): Record<string, unknown> {
````

por:

````ts
  r: PublicRestaurant,
  opts: { url: string; mediaUrl: (path: string) => string; menuUrl?: string; reservationUrl?: string },
): Record<string, unknown> {
````

En `src/lib/public/jsonld.ts`, sustituye:

````ts
  if (opts.menuUrl) ld.hasMenu = opts.menuUrl;
  if (r.cuisine) ld.servesCuisine = r.cuisine;
````

por:

````ts
  if (opts.menuUrl) ld.hasMenu = opts.menuUrl;
  // Hito 4B: con la reserva online activada, la página de reservar.
  if (opts.reservationUrl) ld.acceptsReservations = opts.reservationUrl;
  if (r.cuisine) ld.servesCuisine = r.cuisine;
````

En `src/app/[slug]/page.tsx`, sustituye:

````tsx
import { PublicShell } from '@/components/public/PublicShell';
import { siteUrl } from '@/lib/env';
import { isLocale, langParam } from '@/lib/i18n/locales';
````

por:

````tsx
import { PublicShell } from '@/components/public/PublicShell';
import { isBookingEnabled } from '@/lib/booking/data';
import { siteUrl } from '@/lib/env';
import { getBookingMessages } from '@/lib/i18n/booking';
import { isLocale, langParam } from '@/lib/i18n/locales';
````

En `src/app/[slug]/page.tsx`, sustituye:

````tsx
import { getPublicMenu, getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { directionsUrl, fullAddress, mapEmbedUrl, localeHref, menuPath, menuTabHref, priceLabel } from '@/lib/public/format';
import { jsonLdScript, restaurantJsonLd } from '@/lib/public/jsonld';
````

por:

````tsx
import { getPublicMenu, getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { bookingPath, directionsUrl, fullAddress, mapEmbedUrl, localeHref, menuPath, menuTabHref, priceLabel } from '@/lib/public/format';
import { jsonLdScript, restaurantJsonLd } from '@/lib/public/jsonld';
````

En `src/app/[slug]/page.tsx`, sustituye:

````tsx
  const menuUrl = menus.length > 0 ? publicUrl(siteUrl(), menuPath(r.slug), locale) : undefined;
  const jsonLd = restaurantJsonLd(r, { url: publicUrl(siteUrl(), path, locale), mediaUrl, menuUrl });
  const accentButton = 'inline-flex items-center rounded-lg bg-[var(--accent)] px-5 py-3 font-bold text-[var(--on-accent)] hover:opacity-90';
````

por:

````tsx
  const menuUrl = menus.length > 0 ? publicUrl(siteUrl(), menuPath(r.slug), locale) : undefined;
  // Un fallo al mirar la reserva online no tumba la mini-web: sale sin el botón «Reservar».
  let bookable = false;
  try {
    bookable = await isBookingEnabled(r.slug);
  } catch (e) {
    console.error('[mini-web] no se pudo saber si hay reserva online', e instanceof Error ? e.message : e);
  }
  const reservationUrl = bookable ? publicUrl(siteUrl(), bookingPath(r.slug), locale) : undefined;
  const jsonLd = restaurantJsonLd(r, { url: publicUrl(siteUrl(), path, locale), mediaUrl, menuUrl, reservationUrl });
  const accentButton = 'inline-flex items-center rounded-lg bg-[var(--accent)] px-5 py-3 font-bold text-[var(--on-accent)] hover:opacity-90';
````

En `src/app/[slug]/page.tsx`, sustituye:

````tsx
        <div className="flex flex-wrap gap-3">
          {menus.length > 0 && (
````

por:

````tsx
        <div className="flex flex-wrap gap-3">
          {bookable && (
            <Link href={localeHref(bookingPath(r.slug), locale)} className={`${accentButton} text-lg`}>
              {getBookingMessages(locale).book}
            </Link>
          )}
          {menus.length > 0 && (
````

En `src/app/[slug]/menu/page.tsx`, sustituye:

````tsx
import { PublicShell } from '@/components/public/PublicShell';
import { siteUrl } from '@/lib/env';
import { isLocale, langParam } from '@/lib/i18n/locales';
````

por:

````tsx
import { PublicShell } from '@/components/public/PublicShell';
import { isBookingEnabled } from '@/lib/booking/data';
import { siteUrl } from '@/lib/env';
import { getBookingMessages } from '@/lib/i18n/booking';
import { isLocale, langParam } from '@/lib/i18n/locales';
````

En `src/app/[slug]/menu/page.tsx`, sustituye:

````tsx
import { getPublicMenu, getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { localeHref, menuPath, menuTabHref } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';
````

por:

````tsx
import { getPublicMenu, getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { bookingPath, localeHref, menuPath, menuTabHref } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';
````

En `src/app/[slug]/menu/page.tsx`, sustituye:

````tsx
  const path = menuPath(r.slug);

````

por:

````tsx
  const path = menuPath(r.slug);
  const bookable = await isBookingEnabled(r.slug).catch((e: unknown) => {
    console.error('[carta] no se pudo saber si hay reserva online', e instanceof Error ? e.message : e);
    return false;
  });

````

En `src/app/[slug]/menu/page.tsx`, sustituye:

````tsx
          </Link>
          <LanguageSwitcher
            enabled={r.enabledLocales}
            locale={locale}
            path={path}
            label={m.language}
            query={selected && selected.id === carta ? { carta: selected.id } : undefined}
            className="text-sm"
          />
        </div>
````

por:

````tsx
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            <LanguageSwitcher
              enabled={r.enabledLocales}
              locale={locale}
              path={path}
              label={m.language}
              query={selected && selected.id === carta ? { carta: selected.id } : undefined}
              className="text-sm"
            />
            {bookable && (
              <Link
                href={localeHref(bookingPath(r.slug), locale)}
                className="inline-flex items-center rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-[var(--on-accent)] hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                {getBookingMessages(locale).book}
              </Link>
            )}
          </div>
        </div>
````

En `src/app/sitemap.ts`, sustituye:

````ts
import { getPublicMenuSlugs, getPublicSlugs } from '@/lib/public/data';
import { menuPath } from '@/lib/public/format';
import { languageAlternates } from '@/lib/public/seo';
````

por:

````ts
import { getPublicMenuSlugs, getPublicSlugs } from '@/lib/public/data';
import { bookingPath, menuPath } from '@/lib/public/format';
import { languageAlternates } from '@/lib/public/seo';
````

En `src/app/sitemap.ts`, sustituye:

````ts
    })),
    ...menus.map((r) => ({
````

por:

````ts
    })),
    // La página de reservar sale para todos: si no hay reserva online, explica cómo reservar por teléfono.
    ...restaurants.map((r) => ({
      url: `${site}${bookingPath(r.slug)}`,
      lastModified: r.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
      alternates: { languages: languageAlternates(site, bookingPath(r.slug), r.enabledLocales) },
    })),
    ...menus.map((r) => ({
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/public src/app/sitemap.test.ts && pnpm typecheck`
Expected: PASS: todas, con 1 prueba nueva en `seo.test.ts`; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/format.ts src/lib/public/jsonld.ts src/lib/public/seo.test.ts 'src/app/[slug]/page.tsx' 'src/app/[slug]/menu/page.tsx' src/app/sitemap.ts src/app/sitemap.test.ts
git commit -m "Mini-web y carta: botón «Reservar», acceptsReservations y la página de reservar en el sitemap"
```

---

### Task 22: Panel → Reservas → Ajustes: reserva online, avisos al restaurante y su email

**Files:**
- Modify: `src/lib/reservations/validation.ts`
- Modify: `src/lib/reservations/validation.test.ts`
- Modify: `src/lib/actions/booking-settings.ts`
- Modify: `src/components/reservations/BookingSettingsForm.tsx`
- Modify: `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`

**Interfaces:**
- Consumes: Tarea 6 (`BookingSettings` con los campos nuevos).
- Produces:
  - `bookingSettingsSchema` y `readSettingsForm` leen `onlineEnabled`, `notifyRestaurant` y `notificationEmail` (vacío = null; si se escribe, email válido en minúsculas).
  - `saveBookingSettings` guarda las tres columnas; `saveBookingSettings`, `createTable`, `updateTable` y `deleteTable` dejan de ser `PANEL_ONLY`: invalidan también la mini-web (el botón «Reservar» depende de ellas).
  - `BookingSettingsForm({ restaurantId, settings, contactEmail, readOnly })` y la página de ajustes, que lee `restaurants.contact_email` para el texto de ayuda.

Lee antes `src/components/reservations/BookingSettingsForm.tsx`, `src/lib/actions/booking-settings.ts` y `src/lib/actions/run.ts` (`publicData`).

- [ ] **Step 1: Escribe las pruebas que fallan**

En `src/lib/reservations/validation.test.ts`, sustituye:

````ts
    autoConfirm: 'on',
  };
````

por:

````ts
    autoConfirm: 'on',
    onlineEnabled: 'on',
    notifyRestaurant: '',
    notificationEmail: '',
  };
````

En `src/lib/reservations/validation.test.ts`, sustituye:

````ts
      autoConfirm: true,
    });
  });
````

por:

````ts
      autoConfirm: true,
      onlineEnabled: true,
      notifyRestaurant: false,
      notificationEmail: null,
    });
  });

  it('email para avisos: vacío = el del local; si se escribe, en minúsculas y válido', () => {
    expect(bookingSettingsSchema.parse({ ...base, notificationEmail: ' Avisos@LaTaberna.es ' })).toMatchObject({ notificationEmail: 'avisos@lataberna.es' });
    expect(errors(bookingSettingsSchema, { ...base, notificationEmail: 'sin-arroba' })).toEqual({ notificationEmail: 'Ese email no parece correcto.' });
  });
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/reservations/validation.test.ts && pnpm typecheck`
Expected: FAIL: en `validation.test.ts`, `expected {…} to deeply equal {…}` (faltan `onlineEnabled`, `notifyRestaurant`, `notificationEmail`).

- [ ] **Step 3: Implementa**

En `src/lib/reservations/validation.ts`, sustituye:

````ts
    'autoConfirm',
    ...RULE_ROWS.flatMap((n) => [`rule${n}_min`, `rule${n}_max`, `rule${n}_duration`]),
````

por:

````ts
    'autoConfirm',
    'onlineEnabled',
    'notifyRestaurant',
    'notificationEmail',
    ...RULE_ROWS.flatMap((n) => [`rule${n}_min`, `rule${n}_max`, `rule${n}_duration`]),
````

En `src/lib/reservations/validation.ts`, sustituye:

````ts
    if (clash) issue(`rule${rules[clash[1]].row}_min`, `Se solapa con el tramo ${rules[clash[0]].row}.`);
    if (defaultDuration === null || minAdvanceMin === null || maxAdvanceDays === null || maxOnlineParty === null || cancelLimitHours === null || clash) {
      return z.NEVER;
````

por:

````ts
    if (clash) issue(`rule${rules[clash[1]].row}_min`, `Se solapa con el tramo ${rules[clash[0]].row}.`);
    // Vacío = el email del local.
    const notificationEmail = (v.notificationEmail ?? '').trim().toLowerCase();
    const badEmail = notificationEmail !== '' && (notificationEmail.length > 254 || !z.email().safeParse(notificationEmail).success);
    if (badEmail) issue('notificationEmail', 'Ese email no parece correcto.');
    if (defaultDuration === null || minAdvanceMin === null || maxAdvanceDays === null || maxOnlineParty === null || cancelLimitHours === null || clash || badEmail) {
      return z.NEVER;
````

En `src/lib/reservations/validation.ts`, sustituye:

````ts
      autoConfirm: v.autoConfirm === 'on',
    };
````

por:

````ts
      autoConfirm: v.autoConfirm === 'on',
      onlineEnabled: v.onlineEnabled === 'on',
      notifyRestaurant: v.notifyRestaurant === 'on',
      notificationEmail: notificationEmail === '' ? null : notificationEmail,
    };
````

En `src/lib/actions/booking-settings.ts`, sustituye:

````ts

// Nada de esto sale en la web pública: solo se refresca el panel.
const PANEL_ONLY = { publicData: false };
````

por:

````ts

// Zonas: solo se refresca el panel. Mesas y ajustes sí tocan la web (el botón «Reservar» depende de la reserva
// online y de que haya mesas online): esas acciones invalidan también la mini-web.
const PANEL_ONLY = { publicData: false };
````

En `src/lib/actions/booking-settings.ts`, sustituye:

````ts
      return error ? { error: dbError('createTable', error) } : { success: `Mesa ${t.name} creada.` };
    },
    PANEL_ONLY,
  );
}
````

por:

````ts
      return error ? { error: dbError('createTable', error) } : { success: `Mesa ${t.name} creada.` };
    },
  );
}
````

En `src/lib/actions/booking-settings.ts`, sustituye:

````ts
      ),
    PANEL_ONLY,
  );
````

por:

````ts
      ),
  );
````

En `src/lib/actions/booking-settings.ts`, sustituye:

````ts
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'deleteTable', 'tables', tableId, restaurantId, null, 'Mesa borrada.'), PANEL_ONLY);
}
````

por:

````ts
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'deleteTable', 'tables', tableId, restaurantId, null, 'Mesa borrada.'));
}
````

En `src/lib/actions/booking-settings.ts`, sustituye:

````ts
    auto_confirm: s.autoConfirm,
  };
````

por:

````ts
    auto_confirm: s.autoConfirm,
    online_enabled: s.onlineEnabled,
    notify_restaurant: s.notifyRestaurant,
    notification_email: s.notificationEmail,
  };
````

En `src/lib/actions/booking-settings.ts`, sustituye:

````ts
      return { success: 'Ajustes guardados.' };
    },
    PANEL_ONLY,
  );
}
````

por:

````ts
      return { success: 'Ajustes guardados.' };
    },
  );
}
````

En `src/components/reservations/BookingSettingsForm.tsx`, sustituye:

````tsx

/** Duración por defecto, tramos por tamaño de grupo y reglas de la reserva online (se aplican en el Hito 4B). */
export function BookingSettingsForm({ restaurantId, settings, readOnly }: { restaurantId: string; settings: BookingSettings; readOnly: boolean }) {
  return (
````

por:

````tsx

/**
 * Duración por defecto, tramos por tamaño de grupo, reserva online (interruptor y reglas) y avisos por email al
 * restaurante. contactEmail: el email del local (si el de avisos se deja vacío, se usa ese).
 */
export function BookingSettingsForm({
  restaurantId,
  settings,
  contactEmail,
  readOnly,
}: {
  restaurantId: string;
  settings: BookingSettings;
  contactEmail: string | null;
  readOnly: boolean;
}) {
  return (
````

En `src/components/reservations/BookingSettingsForm.tsx`, sustituye:

````tsx
        <legend className="mb-1 text-sm font-bold">Reserva online</legend>
        <p className="text-sm text-muted">Las guardamos ya; se aplicarán cuando actives la reserva desde tu web.</p>
        <div className="grid gap-4 sm:grid-cols-2">
````

por:

````tsx
        <legend className="mb-1 text-sm font-bold">Reserva online</legend>
        <FormCheckbox name="onlineEnabled" label="Aceptar reservas desde tu web (botón «Reservar»)" defaultChecked={settings.onlineEnabled} />
        <p className="text-sm text-muted">
          Solo se ofrecen las mesas marcadas como «se reserva online». Si apagas la reserva online, los clientes pueden seguir cancelando con el enlace de su email.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
````

En `src/components/reservations/BookingSettingsForm.tsx`, sustituye:

````tsx
          <FormField label="Hasta cuántos días antes" name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={String(settings.maxAdvanceDays)} />
          <FormField label="Máximo de personas online" name="maxOnlineParty" type="number" min={1} max={50} defaultValue={String(settings.maxOnlineParty)} />
          <FormField label="Cancelar hasta (horas antes)" name="cancelLimitHours" type="number" min={0} max={168} defaultValue={String(settings.cancelLimitHours)} />
        </div>
        <FormCheckbox name="autoConfirm" label="Confirmar las reservas online sin revisarlas" defaultChecked={settings.autoConfirm} />
      </fieldset>
````

por:

````tsx
          <FormField label="Hasta cuántos días antes" name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={String(settings.maxAdvanceDays)} />
          <FormField
            label="Máximo de personas online"
            name="maxOnlineParty"
            type="number"
            min={1}
            max={50}
            defaultValue={String(settings.maxOnlineParty)}
            hint="Por encima, la web envía una solicitud sin mesa que confirmas tú."
          />
          <FormField
            label="Cambiar o cancelar hasta (horas antes)"
            name="cancelLimitHours"
            type="number"
            min={0}
            max={168}
            defaultValue={String(settings.cancelLimitHours)}
          />
        </div>
        <FormCheckbox name="autoConfirm" label="Confirmar las reservas online sin revisarlas" defaultChecked={settings.autoConfirm} />
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold">Avisos por email al restaurante</legend>
        <FormCheckbox name="notifyRestaurant" label="Avisarnos por email de las reservas, cambios y cancelaciones que hagan los clientes" defaultChecked={settings.notifyRestaurant} />
        <FormField
          label="Email para avisos de reservas (opcional)"
          name="notificationEmail"
          type="email"
          defaultValue={settings.notificationEmail ?? ''}
          hint={contactEmail ? `Si lo dejas vacío, usamos el del local: ${contactEmail}.` : 'Si lo dejas vacío, usamos el email del local (ahora no tienes ninguno).'}
        />
      </fieldset>
````

En `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`, sustituye:

````tsx
import { getBookingConfig } from '@/lib/reservations/data';

````

por:

````tsx
import { getBookingConfig } from '@/lib/reservations/data';
import { createClient } from '@/lib/supabase/server';

````

En `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`, sustituye:

````tsx
  const config = await getBookingConfig(restaurantId);
  const readOnly = ctx.readOnly;
````

por:

````tsx
  const config = await getBookingConfig(restaurantId);
  const supabase = await createClient();
  const { data: restaurant } = await supabase.from('restaurants').select('contact_email').eq('id', restaurantId).maybeSingle();
  const contactEmail = (restaurant as { contact_email: string | null } | null)?.contact_email ?? null;
  const readOnly = ctx.readOnly;
````

En `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`, sustituye:

````tsx
        <h1 className="text-3xl font-extrabold tracking-tight">Ajustes de reservas</h1>
        <p className="mt-1 text-muted">Tus zonas y mesas, cuánto dura una reserva y las reglas de la reserva online. El horario está en «Horario».</p>
      </header>
````

por:

````tsx
        <h1 className="text-3xl font-extrabold tracking-tight">Ajustes de reservas</h1>
        <p className="mt-1 text-muted">Tus zonas y mesas, cuánto dura una reserva, la reserva online y los avisos por email. El horario está en «Horario».</p>
      </header>
````

En `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`, sustituye:

````tsx

      <SectionCard id="duracion" title="Duración y reglas">
        <BookingSettingsForm restaurantId={restaurantId} settings={config.settings} readOnly={readOnly} />
      </SectionCard>
````

por:

````tsx

      <SectionCard id="duracion" title="Duración, reserva online y avisos">
        <BookingSettingsForm restaurantId={restaurantId} settings={config.settings} contactEmail={contactEmail} readOnly={readOnly} />
      </SectionCard>
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/reservations/validation.test.ts && pnpm typecheck`
Expected: PASS: todas, con 1 prueba nueva; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/validation.ts src/lib/reservations/validation.test.ts src/lib/actions/booking-settings.ts src/components/reservations/BookingSettingsForm.tsx 'src/app/panel/[restaurantId]/reservas/ajustes/page.tsx'
git commit -m "Ajustes de reservas: reserva online, avisos al restaurante y email para avisos"
```

---

### Task 23: Panel: «Enviar confirmación por email» en la reserva telefónica, avisos al cambiar, envíos después de cada acción y «Reintentar»

**Files:**
- Modify: `src/lib/db-errors.ts`
- Modify: `src/lib/reservations/validation.ts`
- Modify: `src/lib/reservations/validation.test.ts`
- Modify: `src/lib/actions/reservations.ts`
- Modify: `src/lib/actions/reservations.test.ts`
- Modify: `src/components/reservations/ReservationForm.tsx`
- Modify: `src/app/panel/[restaurantId]/reservas/nueva/page.tsx`

**Interfaces:**
- Consumes: Tareas 3 (`create_panel_reservation`/`update_panel_reservation` con `p_id`, `p_notify_customer`, `p_token_hash`), 4 (`retry_outbox`), 7 (`newBookingIdentity`, `manageToken`, `tokenHash`), 12 (`deliverOutbox`).
- Produces:
  - `phoneReservationSchema` gana `notifyCustomer: boolean` (solo `true` si hay email); `readReservationForm` lee `notifyCustomer`.
  - `createPhoneReservation` manda `p_id`, `p_notify_customer` y `p_token_hash` (con la casilla, la app genera el id); `updateReservation` manda `p_notify_customer` (solo si el formulario trae `notifyShown`) y la huella del enlace de esa reserva; las acciones de estado y deshacer, `after(() => deliverOutbox())`.
  - `retryEmail(restaurantId, outboxId) → FormState`.
  - `mapDbError`: `NO_CUSTOMER_EMAIL`, `NOT_RETRYABLE`, `booking_settings_notification_email_check`.
  - `ReservationForm` gana `canNotify?: boolean` (crear) y `notify?: { email, checked } | null` (cambiar); la página «Nueva reserva» pasa `canNotify` (restaurante publicado).

Lee antes `src/lib/actions/reservations.ts`, su prueba y `src/components/reservations/ReservationForm.tsx`.

- [ ] **Step 1: Escribe las pruebas que fallan**

En `src/lib/reservations/validation.test.ts`, sustituye:

````ts
      internalNotes: 'Cliente de la casa',
    });
  });
````

por:

````ts
      internalNotes: 'Cliente de la casa',
      notifyCustomer: false,
    });
  });

  it('por teléfono: «Enviar confirmación por email» solo vale si hay email', () => {
    expect(phoneReservationSchema.parse({ ...phone, notifyCustomer: 'on' }).notifyCustomer).toBe(true);
    expect(phoneReservationSchema.parse({ ...phone, email: '', notifyCustomer: 'on' }).notifyCustomer).toBe(false);
  });
````

En `src/lib/actions/reservations.test.ts`, sustituye:

````ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapDbError } from '@/lib/db-errors';
````

por:

````ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const after = vi.fn();
vi.mock('next/server', () => ({ after: (fn: () => unknown) => after(fn) }));
vi.mock('@/lib/email/deliver', () => ({ deliverOutbox: vi.fn() }));
import { mapDbError } from '@/lib/db-errors';
````

En `src/lib/actions/reservations.test.ts`, sustituye:

````ts
beforeEach(() => {
  rpc.mockClear();
````

por:

````ts
beforeEach(() => {
  after.mockClear();
  rpc.mockClear();
````

En `src/lib/actions/reservations.test.ts`, sustituye:

````ts
      p_internal_notes: null,
    });
    expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas?fecha=2030-06-14&aviso=creada`);
  });
````

por:

````ts
      p_internal_notes: null,
      p_id: null,
      p_notify_customer: false,
      p_token_hash: null,
    });
    expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas?fecha=2030-06-14&aviso=creada`);
    expect(after).not.toHaveBeenCalled();
  });

  it('«Enviar confirmación por email»: la app pone el id y la huella de su enlace, y envía después', async () => {
    const { manageToken, tokenHash } = await import('@/lib/booking/token');
    await createPhoneReservation({}, form({ ...phoneForm, email: 'ana@example.com', notifyCustomer: 'on' }));
    const args = rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_customer_email: 'ana@example.com', p_notify_customer: true });
    expect(args.p_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.p_token_hash).toBe(tokenHash(manageToken(args.p_id as string)));
    expect(after).toHaveBeenCalledOnce();
    // Marcada pero sin email: no se avisa.
    await createPhoneReservation({}, form({ ...phoneForm, notifyCustomer: 'on' }));
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_id: null, p_notify_customer: false, p_token_hash: null });
  });
````

En `src/lib/actions/reservations.test.ts`, sustituye:

````ts
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1] }));
  expect(rpc).toHaveBeenCalledWith('update_panel_reservation', expect.objectContaining({ p_reservation_id: ID, p_duration_min: 60, p_table_ids: [T1], p_force: false }));
  expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas/${ID}?aviso=guardada`);
});
````

por:

````ts
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1] }));
  expect(rpc).toHaveBeenCalledWith(
    'update_panel_reservation',
    expect.objectContaining({ p_reservation_id: ID, p_duration_min: 60, p_table_ids: [T1], p_force: false, p_notify_customer: null, p_token_hash: null }),
  );
  expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas/${ID}?aviso=guardada`);
});

it('updateReservation: con la casilla de avisos en el formulario, la manda (y la huella del enlace de esa reserva)', async () => {
  const { manageToken, tokenHash } = await import('@/lib/booking/token');
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1], notifyShown: '1', notifyCustomer: 'on' }));
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_notify_customer: true, p_token_hash: tokenHash(manageToken(ID)) });
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1], notifyShown: '1' }));
  expect(rpc.mock.calls[1][1]).toMatchObject({ p_notify_customer: false, p_token_hash: null });
});
````

En `src/lib/actions/reservations.test.ts`, sustituye:

````ts
    expect(await undoReservationStatus(R, ID)).toEqual({ success: 'Deshecho: vuelve a «Confirmada».' });
  });
````

por:

````ts
    expect(await undoReservationStatus(R, ID)).toEqual({ success: 'Deshecho: vuelve a «Confirmada».' });
    // Los emails que anote la BD (confirmar, rechazar, cancelar…) salen justo después.
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('reintentar un email fallido: retry_outbox con el restaurante y envío después', async () => {
    const { retryEmail } = await import('./reservations');
    expect(await retryEmail(R, 'no-es-uuid')).toEqual({ error: mapDbError('INVALID_INPUT') });
    expect(await retryEmail(R, ID)).toEqual({ success: 'Lo intentamos de nuevo. Recarga en un momento para ver si ha salido.' });
    expect(rpc).toHaveBeenCalledWith('retry_outbox', { p_restaurant_id: R, p_id: ID });
    expect(after).toHaveBeenCalledOnce();
  });
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/actions src/lib/reservations src/lib/db-errors.test.ts && pnpm typecheck`
Expected: FAIL: en `reservations.test.ts`, `expected "vi.fn()" to be called with arguments: [ "create_panel_reservation", … p_id: null …]`; en `validation.test.ts`, falta `notifyCustomer`.

- [ ] **Step 3: Implementa**

En `src/lib/db-errors.ts`, sustituye:

````ts
  [/customers_email_check/, 'Ese email no parece correcto.'],
];
````

por:

````ts
  [/customers_email_check/, 'Ese email no parece correcto.'],
  // Hito 4B: reserva online y emails
  [/NO_CUSTOMER_EMAIL/, 'Este cliente no tiene email: no podemos enviarle avisos.'],
  [/NOT_RETRYABLE/, 'Ese email ya no se puede reintentar. Recarga la página.'],
  [/booking_settings_notification_email_check/, 'Ese email no parece correcto.'],
];
````

En `src/lib/reservations/validation.ts`, sustituye:

````ts
  return {
    ...formStrings(fd, ['date', 'time', 'partySize', 'duration', 'tableMode', 'name', 'phone', 'email', 'notes', 'internalNotes']),
    tableIds: fd.getAll('tableIds').filter((v): v is string => typeof v === 'string'),
````

por:

````ts
  return {
    ...formStrings(fd, ['date', 'time', 'partySize', 'duration', 'tableMode', 'name', 'phone', 'email', 'notes', 'internalNotes', 'notifyCustomer']),
    tableIds: fd.getAll('tableIds').filter((v): v is string => typeof v === 'string'),
````

En `src/lib/reservations/validation.ts`, sustituye:

````ts
      }),
  })
  .superRefine(checkTables)
  .refine((v) => v.tableMode !== 'keep', { path: ['tableMode'], message: 'Elige una mesa o guárdala sin mesa.' });

````

por:

````ts
      }),
    /** Hito 4B: «Enviar confirmación por email» (sin email no se envía nada aunque llegue marcada). */
    notifyCustomer: z
      .string()
      .optional()
      .transform((v) => v === 'on'),
  })
  .superRefine(checkTables)
  .refine((v) => v.tableMode !== 'keep', { path: ['tableMode'], message: 'Elige una mesa o guárdala sin mesa.' })
  .transform((v) => ({ ...v, notifyCustomer: v.notifyCustomer && v.email !== null }));

````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
import { redirect, unstable_rethrow } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import { dbError, mapDbError } from '@/lib/db-errors';
````

por:

````ts
import { redirect, unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import { requirePermission } from '@/lib/auth/guards';
import { manageToken, newBookingIdentity, tokenHash } from '@/lib/booking/token';
import { deliverOutbox } from '@/lib/email/deliver';
import { dbError, mapDbError } from '@/lib/db-errors';
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts

function createdId(data: unknown): string {
````

por:

````ts

/** Envía los emails que la BD haya anotado, justo después de responder. */
function sendQueuedEmails(): void {
  after(async () => {
    await deliverOutbox();
  });
}

function createdId(data: unknown): string {
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
  const created = { id: '' };
  const result = await runPanelAction(
````

por:

````ts
  const created = { id: '' };
  // Con «Enviar confirmación por email», la app pone el id para poder calcular el enlace del cliente.
  const identity = d.notifyCustomer ? newBookingIdentity() : null;
  const result = await runPanelAction(
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
        p_notes: d.notes,
        p_internal_notes: d.internalNotes,
      });
      if (error) return { error: dbError('reservas.createPhoneReservation', error) };
````

por:

````ts
        p_notes: d.notes,
        p_internal_notes: d.internalNotes,
        p_id: identity?.id ?? null,
        p_notify_customer: identity !== null,
        p_token_hash: identity?.tokenHash ?? null,
      });
      if (error) return { error: dbError('reservas.createPhoneReservation', error) };
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
      if (!created.id) console.error('[reservas.createPhoneReservation] la BD no ha devuelto un id válido');
      return created.id ? { success: 'Reserva guardada.' } : { error: mapDbError(undefined) };
````

por:

````ts
      if (!created.id) console.error('[reservas.createPhoneReservation] la BD no ha devuelto un id válido');
      if (created.id && identity) sendQueuedEmails();
      return created.id ? { success: 'Reserva guardada.' } : { error: mapDbError(undefined) };
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
      const startsAt = startForEdit(config, Number.isFinite(currentMs) ? currentMs : null, d.date, d.time);
      const { error } = await supabase.rpc('update_panel_reservation', {
````

por:

````ts
      const startsAt = startForEdit(config, Number.isFinite(currentMs) ? currentMs : null, d.date, d.time);
      // La casilla de avisos solo viaja si el formulario la enseña (cliente con email): si no, no se tocan.
      const notify = fd.has('notifyShown') ? field(fd, 'notifyCustomer') === 'on' : null;
      const { error } = await supabase.rpc('update_panel_reservation', {
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
        p_internal_notes: d.internalNotes,
      });
````

por:

````ts
        p_internal_notes: d.internalNotes,
        p_notify_customer: notify,
        p_token_hash: notify ? tokenHash(manageToken(reservationId)) : null,
      });
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
      saved.ok = true;
      return { success: 'Cambios guardados.' };
````

por:

````ts
      saved.ok = true;
      sendQueuedEmails();
      return { success: 'Cambios guardados.' };
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
      });
      return error ? { error: dbError('reservas.changeReservationStatus', error) } : { success: `Hecho: ${STATUS_LABELS_ES[parsed.data]}.` };
    },
````

por:

````ts
      });
      if (error) return { error: dbError('reservas.changeReservationStatus', error) };
      sendQueuedEmails();
      return { success: `Hecho: ${STATUS_LABELS_ES[parsed.data]}.` };
    },
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
      }
      const back = statusSchema.safeParse(data);
````

por:

````ts
      }
      sendQueuedEmails();
      const back = statusSchema.safeParse(data);
````

En `src/lib/actions/reservations.ts`, sustituye:

````ts
  }
}
````

por:

````ts
  }
}

/** «Reintentar» un email que no se pudo enviar (vuelve a la cola con sus 3 intentos y se envía al momento). */
export async function retryEmail(restaurantId: string, outboxId: string): Promise<FormState> {
  if (!isUuid(outboxId)) return { error: mapDbError('INVALID_INPUT') };
  return runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { error } = await supabase.rpc('retry_outbox', { p_restaurant_id: restaurantId, p_id: outboxId });
      if (error) return { error: dbError('reservas.retryEmail', error) };
      sendQueuedEmails();
      return { success: 'Lo intentamos de nuevo. Recarga en un momento para ver si ha salido.' };
    },
    PANEL_ONLY,
  );
}
````

En `src/components/reservations/ReservationForm.tsx`, sustituye:

````tsx
  initial: ReservationFormInitial;
};
````

por:

````tsx
  initial: ReservationFormInitial;
  /**
   * Hito 4B. Al crear: si se puede ofrecer «Enviar confirmación por email» (restaurante publicado). Al cambiar: el
   * email del cliente y si ya recibe avisos (null = sin casilla: walk-in, sin email o restaurante sin publicar).
   */
  canNotify?: boolean;
  notify?: { email: string; checked: boolean } | null;
};
````

En `src/components/reservations/ReservationForm.tsx`, sustituye:

````tsx
  const [name, setName] = useState('');
  const [lookup, setLookup] = useState<{ text: string; warnings: CustomerWarning[] }>({ text: '', warnings: [] });
````

por:

````tsx
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [lookup, setLookup] = useState<{ text: string; warnings: CustomerWarning[] }>({ text: '', warnings: [] });
````

En `src/components/reservations/ReservationForm.tsx`, sustituye:

````tsx
          <FormField label="Nombre" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
          <FormField label="Email (opcional)" name="email" type="email" autoComplete="off" />
        </div>
      )}
````

por:

````tsx
          <FormField label="Nombre" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
          <FormField label="Email (opcional)" name="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      {mode === 'create' && props.canNotify && email.trim() !== '' && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="notifyCustomer"
            checked={notifyCustomer}
            onChange={(e) => setNotifyCustomer(e.target.checked)}
            className="mt-1 size-4 accent-navy"
          />
          <span>
            Enviar confirmación por email
            <span className="block text-sm text-muted">Recibirá el enlace para cambiarla o cancelarla, el recordatorio y los avisos de cambios.</span>
          </span>
        </label>
      )}
      {mode === 'edit' && props.notify && (
        <label className="flex items-start gap-2">
          <input type="hidden" name="notifyShown" value="1" />
          <input type="checkbox" name="notifyCustomer" defaultChecked={props.notify.checked} className="mt-1 size-4 accent-navy" />
          <span>
            Enviar avisos por email a {props.notify.email}
            <span className="block text-sm text-muted">Si la activas ahora, le enviamos la confirmación con el enlace para gestionarla.</span>
          </span>
        </label>
      )}
````

En `src/app/panel/[restaurantId]/reservas/nueva/page.tsx`, sustituye:

````tsx
            settings={config.settings}
            initial={{
````

por:

````tsx
            settings={config.settings}
            canNotify={ctx.restaurant.status === 'active'}
            initial={{
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/actions src/lib/reservations src/lib/db-errors.test.ts && pnpm typecheck`
Expected: PASS: todas, con 4 pruebas nuevas; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db-errors.ts src/lib/reservations/validation.ts src/lib/reservations/validation.test.ts src/lib/actions/reservations.ts src/lib/actions/reservations.test.ts src/components/reservations/ReservationForm.tsx 'src/app/panel/[restaurantId]/reservas/nueva/page.tsx'
git commit -m "Panel: confirmación por email en reservas telefónicas, envío tras cada cambio y reintentar emails"
```

---

### Task 24: Vista del día: «Pendientes de confirmar» arriba y pendientes de otros días

**Files:**
- Create: `src/lib/reservations/pending.ts`
- Create (prueba): `src/lib/reservations/pending.test.ts`
- Modify: `src/lib/reservations/data.ts`
- Modify: `src/app/panel/[restaurantId]/reservas/page.tsx`

**Interfaces:**
- Consumes: `serviceDateOf`, `formatDayEs`, `ReservationItem` (botones Confirmar/Rechazar de `nextActions('pending')` y enlace a la ficha para asignar mesa).
- Produces:
  - `src/lib/reservations/pending.ts`: `pendingDays(starts, config, current) → [date, count][]`.
  - `getUpcomingPendingStarts(restaurantId) → number[]` en `src/lib/reservations/data.ts`.
  - La vista del día: sección «Pendientes de confirmar» arriba (no se repiten abajo) y aviso «También tienes pendientes de confirmar: …» con enlaces.

Lee antes `src/app/panel/[restaurantId]/reservas/page.tsx` y `serviceDateOf` en `src/lib/reservations/day.ts`.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/lib/reservations/pending.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { pendingDays } from './pending';

describe('pendientes de otros días', () => {
  const config = {
    timezone: 'Europe/Madrid',
    // Sábado, cena hasta la 01:30.
    services: [{ name: 'Cena', weekday: 6, startMinute: 1200, endMinute: 1530, lastBookingMinute: null, slotIntervalMin: 15 }],
    exceptions: [],
  };

  it('agrupa por día de servicio (la madrugada de la cena cuenta para la víspera) y quita el día que se ve', () => {
    const starts = [
      Date.parse('2030-06-15T19:00:00Z'), // sábado 21:00
      Date.parse('2030-06-15T22:30:00Z'), // domingo 00:30, de la cena del sábado
      Date.parse('2030-06-20T19:00:00Z'),
      Date.parse('2030-06-14T19:00:00Z'),
    ];
    expect(pendingDays(starts, config, '2030-06-14')).toEqual([
      ['2030-06-15', 2],
      ['2030-06-20', 1],
    ]);
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/lib/reservations/pending.test.ts && pnpm typecheck`
Expected: FAIL: `Failed to resolve import "./pending"`.

- [ ] **Step 3: Implementa**

Crea `src/lib/reservations/pending.ts`:

````ts
import { serviceDateOf, type ExceptionConfig, type ServiceConfig } from './day';

/** Días de servicio (distintos del que se está viendo) con reservas pendientes, y cuántas: [['2030-06-14', 2], …]. */
export function pendingDays(
  starts: readonly number[],
  config: { timezone: string; services: readonly ServiceConfig[]; exceptions: readonly ExceptionConfig[] },
  current: string,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const ms of starts) {
    const date = serviceDateOf(ms, config.timezone, config.services, config.exceptions);
    if (date !== current) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}
````

En `src/lib/reservations/data.ts`, sustituye:

````ts
  return count ?? 0;
}

````

por:

````ts
  return count ?? 0;
}


// Hito 4B -------------------------------------------------------------------------------------------------------

/** Inicios de las reservas pendientes de confirmar de ahora en adelante (para «También tienes pendientes…»). */
export async function getUpcomingPendingStarts(restaurantId: string): Promise<number[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reservations')
    .select('starts_at')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(200);
  if (error) throw new Error(`reservations: ${error.message}`);
  return ((data ?? []) as { starts_at: string }[]).map((r) => Date.parse(r.starts_at));
}
````

En `src/app/panel/[restaurantId]/reservas/page.tsx`, sustituye:

````tsx
import { can } from '@/lib/permissions';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { currentServiceDate, groupByService, servicesForDate, summarize, unassignedByTime } from '@/lib/reservations/day';
import type { PanelReservation } from '@/lib/reservations/rows';
import { addDays, dateParam, formatTime, serviceDayWindow } from '@/lib/reservations/time';
import { formatRange } from '@/lib/schedule';
````

por:

````tsx
import { can } from '@/lib/permissions';
import { getBookingConfig, getBookingDay, getUpcomingPendingStarts } from '@/lib/reservations/data';
import { currentServiceDate, groupByService, servicesForDate, summarize, unassignedByTime } from '@/lib/reservations/day';
import { pendingDays } from '@/lib/reservations/pending';
import type { PanelReservation } from '@/lib/reservations/rows';
import { addDays, dateParam, formatDayEs, formatTime, serviceDayWindow } from '@/lib/reservations/time';
import { formatRange } from '@/lib/schedule';
````

En `src/app/panel/[restaurantId]/reservas/page.tsx`, sustituye:

````tsx
  const date = dateParam(sp.fecha, today);
  const day = await getBookingDay(restaurantId, date, tz);
  const services = servicesForDate(date, config.services, config.exceptions);
````

por:

````tsx
  const date = dateParam(sp.fecha, today);
  const [day, pendingStarts] = await Promise.all([getBookingDay(restaurantId, date, tz), getUpcomingPendingStarts(restaurantId)]);
  const services = servicesForDate(date, config.services, config.exceptions);
````

En `src/app/panel/[restaurantId]/reservas/page.tsx`, sustituye:

````tsx
  const ofTheDay = [...groups.flatMap((g) => g.items), ...outside];
  const unassigned = unassignedByTime(ofTheDay);
  const withTable = (items: PanelReservation[]) => items.filter((r) => !unassigned.includes(r));
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
````

por:

````tsx
  const ofTheDay = [...groups.flatMap((g) => g.items), ...outside];
  // Arriba, las pendientes de confirmar (online y solicitudes de grupo); no se repiten más abajo.
  const pending = ofTheDay.filter((r) => r.status === 'pending').sort((a, b) => a.startMs - b.startMs);
  const unassigned = unassignedByTime(ofTheDay).filter((r) => r.status !== 'pending');
  const withTable = (items: PanelReservation[]) => items.filter((r) => r.status !== 'pending' && !unassigned.includes(r));
  const otherPending = pendingDays(pendingStarts, config, date);
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
````

En `src/app/panel/[restaurantId]/reservas/page.tsx`, sustituye:

````tsx
          para asignarlas a las reservas.
        </Notice>
````

por:

````tsx
          para asignarlas a las reservas.
        </Notice>
      )}

      {pending.length > 0 && (
        <SectionCard title="Pendientes de confirmar" intro="Reservas online por confirmar y solicitudes de grupo. Ábrelas para asignar mesa antes de confirmar.">
          <ul className="flex flex-col gap-3">{pending.map(item)}</ul>
        </SectionCard>
      )}

      {otherPending.length > 0 && (
        <Notice tone="info">
          También tienes pendientes de confirmar:{' '}
          {otherPending.map(([d, n], i) => (
            <span key={d}>
              {i > 0 && ', '}
              <Link href={`${base}?fecha=${d}`} className="font-bold text-navy underline">
                {formatDayEs(d)} ({n})
              </Link>
            </span>
          ))}
          .
        </Notice>
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/lib/reservations/pending.test.ts && pnpm typecheck`
Expected: PASS: 1 prueba; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/pending.ts src/lib/reservations/pending.test.ts src/lib/reservations/data.ts 'src/app/panel/[restaurantId]/reservas/page.tsx'
git commit -m "Vista del día: pendientes de confirmar arriba y pendientes de otros días"
```

---

### Task 25: Ficha de la reserva: historial de emails, aviso de fallo y «Reintentar»; casilla de avisos al cambiarla

**Files:**
- Modify: `src/lib/reservations/data.ts`
- Create: `src/components/reservations/ReservationEmails.tsx`
- Create: `src/components/reservations/EmailRetryButton.tsx`
- Create (prueba): `src/components/reservations/ReservationEmails.test.tsx`
- Modify: `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`

**Interfaces:**
- Consumes: Tareas 1 (`EMAIL_KIND_LABELS_ES`, `EMAIL_STATUS_LABELS_ES`, `failedEmailText`, `EmailKind`, `EmailStatus`), 23 (`retryEmail`, `ReservationForm` con `notify`).
- Produces:
  - `type ReservationEmail = { id, kind, status, createdMs, sentMs }` y `getReservationEmails(restaurantId, reservationId) → { notifyCustomer, emails }` en `src/lib/reservations/data.ts`.
  - `ReservationEmails({ restaurantId, emails, timeZone, readOnly })` y `EmailRetryButton({ restaurantId, outboxId, label })` (cliente).
  - La ficha enseña la sección «Emails» y pasa `notify` al formulario de cambios (cliente con email, no walk-in, restaurante publicado).

Lee antes `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`.

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `src/components/reservations/ReservationEmails.test.tsx`:

````tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/reservations', () => ({ retryEmail: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ReservationEmails } = await import('./ReservationEmails');

const at = Date.parse('2030-06-14T19:00:00Z');

describe('historial de emails de la reserva', () => {
  it('tipo, estado y fecha; si falló, el aviso y «Reintentar» (no en modo soporte)', () => {
    const emails = [
      { id: 'a', kind: 'customer_confirmed' as const, status: 'sent' as const, createdMs: at, sentMs: at },
      { id: 'b', kind: 'customer_reminder' as const, status: 'failed' as const, createdMs: at, sentMs: null },
    ];
    const html = renderToStaticMarkup(<ReservationEmails restaurantId="r" emails={emails} timeZone="Europe/Madrid" readOnly={false} />);
    expect(html).toContain('Confirmación (al cliente)');
    expect(html).toContain('Enviado el Viernes 14/06/2030, 21:00');
    expect(html).toContain('No pudimos enviar el email de recordatorio al cliente.');
    expect(html).toContain('aria-label="Reintentar: Recordatorio (al cliente)"');
    expect(html.match(/Reintentar<\/button>/g)).toHaveLength(1);
    const support = renderToStaticMarkup(<ReservationEmails restaurantId="r" emails={emails} timeZone="Europe/Madrid" readOnly />);
    expect(support).not.toContain('Reintentar');
  });

  it('sin emails, lo dice', () => {
    expect(renderToStaticMarkup(<ReservationEmails restaurantId="r" emails={[]} timeZone="Europe/Madrid" readOnly={false} />)).toContain(
      'Esta reserva no ha enviado ningún email.',
    );
  });
});
````

- [ ] **Step 2: Comprueba que fallan**

Run: `pnpm test:unit src/components/reservations && pnpm typecheck`
Expected: FAIL: `Failed to resolve import "./ReservationEmails"`.

- [ ] **Step 3: Implementa**

En `src/lib/reservations/data.ts`, sustituye:

````ts
import 'server-only';
import { createClient } from '@/lib/supabase/server';
````

por:

````ts
import 'server-only';
import type { EmailKind, EmailStatus } from '@/lib/email/outbox-rules';
import { createClient } from '@/lib/supabase/server';
````

En `src/lib/reservations/data.ts`, sustituye:

````ts


// Hito 4B -------------------------------------------------------------------------------------------------------

````

por:

````ts

// Hito 4B -------------------------------------------------------------------------------------------------------

export type ReservationEmail = { id: string; kind: EmailKind; status: EmailStatus; createdMs: number; sentMs: number | null };

/** Si el cliente recibe avisos y el historial de emails de una reserva (RLS: miembros con reservations.manage). */
export async function getReservationEmails(restaurantId: string, reservationId: string): Promise<{ notifyCustomer: boolean; emails: ReservationEmail[] }> {
  const supabase = await createClient();
  const [reservation, outbox] = await Promise.all([
    supabase.from('reservations').select('notify_customer').eq('id', reservationId).eq('restaurant_id', restaurantId).maybeSingle(),
    supabase
      .from('email_outbox')
      .select('id, kind, status, created_at, sent_at')
      .eq('reservation_id', reservationId)
      .eq('restaurant_id', restaurantId)
      .order('created_at')
      .order('kind'),
  ]);
  if (reservation.error) throw new Error(`reservations: ${reservation.error.message}`);
  if (outbox.error) throw new Error(`email_outbox: ${outbox.error.message}`);
  const rows = (outbox.data ?? []) as { id: string; kind: EmailKind; status: EmailStatus; created_at: string; sent_at: string | null }[];
  return {
    notifyCustomer: (reservation.data as { notify_customer: boolean } | null)?.notify_customer ?? false,
    emails: rows.map((e) => ({ id: e.id, kind: e.kind, status: e.status, createdMs: Date.parse(e.created_at), sentMs: e.sent_at ? Date.parse(e.sent_at) : null })),
  };
}

````

Crea `src/components/reservations/ReservationEmails.tsx`:

````tsx
import { EMAIL_KIND_LABELS_ES, EMAIL_STATUS_LABELS_ES, failedEmailText } from '@/lib/email/outbox-rules';
import type { ReservationEmail } from '@/lib/reservations/data';
import { formatDayEs, formatTime, localParts } from '@/lib/reservations/time';
import { EmailRetryButton } from './EmailRetryButton';

const STATUS_STYLES: Record<ReservationEmail['status'], string> = {
  pending: 'border-ink/30 text-muted',
  sending: 'border-ink/30 text-muted',
  sent: 'border-navy text-navy-dark',
  failed: 'border-red-700 text-red-800',
  skipped: 'border-ink/20 text-muted',
};

/** Historial de emails de una reserva: tipo, estado y fecha; si alguno falló, el aviso y «Reintentar». */
export function ReservationEmails({
  restaurantId,
  emails,
  timeZone,
  readOnly,
}: {
  restaurantId: string;
  emails: ReservationEmail[];
  timeZone: string;
  readOnly: boolean;
}) {
  if (emails.length === 0) return <p className="text-sm text-muted">Esta reserva no ha enviado ningún email.</p>;
  const when = (ms: number) => `${formatDayEs(localParts(ms, timeZone).date)}, ${formatTime(ms, timeZone)}`;
  return (
    <ul className="flex flex-col gap-3">
      {emails.map((e) => (
        <li key={e.id} className="flex flex-col gap-1.5 border-b border-ink/10 pb-3 last:border-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{EMAIL_KIND_LABELS_ES[e.kind]}</span>
            <span className={`inline-flex rounded-full border-2 px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[e.status]}`}>{EMAIL_STATUS_LABELS_ES[e.status]}</span>
          </p>
          <p className="text-sm text-muted">{e.sentMs ? `Enviado el ${when(e.sentMs)}` : `Anotado el ${when(e.createdMs)}`}</p>
          {e.status === 'failed' && (
            <>
              <p className="text-sm font-medium text-red-800">{failedEmailText(e.kind)}</p>
              {!readOnly && <EmailRetryButton restaurantId={restaurantId} outboxId={e.id} label={EMAIL_KIND_LABELS_ES[e.kind]} />}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
````

Crea `src/components/reservations/EmailRetryButton.tsx`:

````tsx
'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { retryEmail } from '@/lib/actions/reservations';
import { GENERIC_ERROR } from '@/lib/menu/sortable';

/** «Reintentar» un email que no salió. Sin envíos dobles; el resultado se anuncia en una región siempre montada. */
export function EmailRetryButton({ restaurantId, outboxId, label }: { restaurantId: string; outboxId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const busy = useRef(false);

  function retry() {
    if (busy.current || pending) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const res = await retryEmail(restaurantId, outboxId);
        setMessage(res.error ? { text: res.error, error: true } : { text: res.success ?? 'Hecho.', error: false });
        if (!res.error) router.refresh();
      } catch {
        setMessage({ text: GENERIC_ERROR, error: true });
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div>
        <button
          type="button"
          onClick={retry}
          aria-label={`Reintentar: ${label}`}
          aria-disabled={pending || undefined}
          className={buttonClass('secondary', 'px-3 py-1.5 text-sm aria-disabled:cursor-wait aria-disabled:opacity-60')}
        >
          Reintentar
        </button>
      </div>
      <p aria-live="polite" className={message.text && !message.error ? 'text-sm text-muted' : 'sr-only'}>
        {message.error ? '' : message.text}
      </p>
      <p role="alert" className={message.text && message.error ? 'text-sm font-medium text-red-700' : 'sr-only'}>
        {message.error ? message.text : ''}
      </p>
    </div>
  );
}
````

En `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`, sustituye:

````tsx
import { ReservationActions } from '@/components/reservations/ReservationActions';
import { ReservationForm } from '@/components/reservations/ReservationForm';
````

por:

````tsx
import { ReservationActions } from '@/components/reservations/ReservationActions';
import { ReservationEmails } from '@/components/reservations/ReservationEmails';
import { ReservationForm } from '@/components/reservations/ReservationForm';
````

En `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`, sustituye:

````tsx
import { customerWarnings } from '@/lib/reservations/customers';
import { getBookingConfig, getBookingDay, getReservationStart } from '@/lib/reservations/data';
import { serviceDateOf, servicesForDate } from '@/lib/reservations/day';
````

por:

````tsx
import { customerWarnings } from '@/lib/reservations/customers';
import { getBookingConfig, getBookingDay, getReservationEmails, getReservationStart } from '@/lib/reservations/data';
import { serviceDateOf, servicesForDate } from '@/lib/reservations/day';
````

En `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`, sustituye:

````tsx
  const date = dateParam(sp.fecha, ownDate);
  const [own, other] = await Promise.all([
    getBookingDay(restaurantId, ownDate, tz),
    date === ownDate ? null : getBookingDay(restaurantId, date, tz),
  ]);
````

por:

````tsx
  const date = dateParam(sp.fecha, ownDate);
  const [own, other, mail] = await Promise.all([
    getBookingDay(restaurantId, ownDate, tz),
    date === ownDate ? null : getBookingDay(restaurantId, date, tz),
    getReservationEmails(restaurantId, reservationId),
  ]);
````

En `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`, sustituye:

````tsx
  const editable = isActiveStatus(r.status) && !ctx.readOnly;

````

por:

````tsx
  const editable = isActiveStatus(r.status) && !ctx.readOnly;
  // Casilla de avisos al cambiarla: cliente con email, reserva que no es walk-in y restaurante publicado.
  const notify =
    r.customer?.email && r.source !== 'walk_in' && ctx.restaurant.status === 'active' ? { email: r.customer.email, checked: mail.notifyCustomer } : null;

````

En `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`, sustituye:

````tsx

      {editable ? (
````

por:

````tsx

      <SectionCard title="Emails" intro={mail.notifyCustomer ? 'El cliente recibe los avisos de esta reserva por email.' : 'El cliente no recibe avisos por email de esta reserva.'}>
        <ReservationEmails restaurantId={restaurantId} emails={mail.emails} timeZone={tz} readOnly={ctx.readOnly} />
      </SectionCard>

      {editable ? (
````

En `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`, sustituye:

````tsx
            settings={config.settings}
            initial={{
````

por:

````tsx
            settings={config.settings}
            notify={notify}
            initial={{
````

- [ ] **Step 4: Comprueba que pasan**

Run: `pnpm test:unit src/components/reservations && pnpm typecheck`
Expected: PASS: 2 pruebas nuevas; typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/data.ts src/components/reservations/ReservationEmails.tsx src/components/reservations/EmailRetryButton.tsx src/components/reservations/ReservationEmails.test.tsx 'src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx'
git commit -m "Ficha de la reserva: historial de emails y reintentar"
```

---

### Task 26: Guía de puesta en marcha y verificación completa

**Files:**
- Modify: `docs/setup.md`

**Interfaces:**
- Consumes: Todo lo anterior.
- Produces:
  `docs/setup.md`: migraciones del 4B en orden y antes del código, `pg_cron`/`pg_net` y el job `mesa-hourly`, secretos de Vault, avisos de seguridad esperados (ninguna función nueva para `anon`), remitente y reintentos de Resend, variables nuevas (aviso de rotación de `MANAGE_TOKEN_SECRET`), Turnstile y revisión legal.

Lee antes `docs/setup.md` entero.

- [ ] **Step 1: Implementa**

En `docs/setup.md`, sustituye:

````markdown
   - Hito 4A: `20261127000100_reservas.sql` y `20261127000200_reservas_funciones.sql`. No tocan datos existentes: añaden zonas, mesas, ajustes de reserva, clientes, reservas, mesas de cada reserva y bloqueos (con su RLS), dos columnas en `services` (`last_booking_minute`, vacía, y `slot_interval_min`, 15 por defecto) y las funciones del panel de reservas. **Aplícalas antes de desplegar el código del Hito 4A**: el código nuevo lee esas columnas y tablas; el del Hito 3 sigue funcionando con ellas.
   - **Tiempo real:** `20261127000100_reservas.sql` añade `reservations`, `reservation_tables` y `blocks` a la publicación `supabase_realtime` (si existe y no es `FOR ALL TABLES`, como en todo proyecto de Supabase). Compruébalo en Database → Publications → `supabase_realtime`: tienen que salir esas tres tablas. Si no, actívalas ahí a mano. Las altas y los cambios llegan filtrados por restaurante y por las RLS de cada usuario; los borrados, no: solo traen la clave primaria, así que el panel solo reacciona a los borrados de los bloqueos que está enseñando (y no escucha los de `reservation_tables`, porque todo cambio de mesas pasa también por `reservations`). Al reconectar o al volver a la pestaña, el panel se refresca solo.
````

por:

````markdown
   - Hito 4A: `20261127000100_reservas.sql` y `20261127000200_reservas_funciones.sql`. No tocan datos existentes: añaden zonas, mesas, ajustes de reserva, clientes, reservas, mesas de cada reserva y bloqueos (con su RLS), dos columnas en `services` (`last_booking_minute`, vacía, y `slot_interval_min`, 15 por defecto) y las funciones del panel de reservas. **Aplícalas antes de desplegar el código del Hito 4A**: el código nuevo lee esas columnas y tablas; el del Hito 3 sigue funcionando con ellas.
   - Hito 4B, **en este orden**: `20261128000100_reserva_online.sql` (ajustes de la reserva online, `reservations.notify_customer`, cola `email_outbox`, `rate_limits` y el trigger que anota los emails), `20261128000200_reserva_publica.sql` (horas que se ofrecen, día público, alta online, botón «Reservar» y límite de intentos), `20261128000300_reserva_enlace_panel.sql` (ver, modificar y cancelar con el enlace, y **nuevas versiones** de `create_panel_reservation` y `update_panel_reservation`: borra las del 4A y crea las nuevas con los parámetros nuevos al final y con valor por defecto, así el código del 4A sigue funcionando mientras tanto) y `20261128000400_emails_tareas.sql` (cola de emails, `run_hourly_jobs` y el job de `pg_cron`). No tocan datos existentes. **Aplícalas antes de desplegar el código del Hito 4B.**
   - **Tarea horaria (`pg_cron` + `pg_net`):** `20261128000400_emails_tareas.sql` activa las extensiones `pg_net` (esquema `extensions`) y `pg_cron` y programa el job `mesa-hourly` (`7 * * * *`, `select public.run_hourly_jobs()`) **solo si el servidor las tiene** (Supabase sí; la BD local de pruebas no). Compruébalo en Integrations → Cron (o `select jobname, schedule, command from cron.job;`): tiene que salir `mesa-hourly`. Si no sale, actívalas en Database → Extensions y vuelve a ejecutar el bloque final de esa migración desde el SQL Editor.
   - **Secretos de Vault** (los crea quien publica, sin mostrarlos; nunca en una migración): `mesa_site_url` (la URL de producción, sin barra final) y `mesa_cron_secret` (el mismo valor que `CRON_SECRET` de Vercel):

     ```sql
     select vault.create_secret('https://<dominio>', 'mesa_site_url');
     select vault.create_secret('<el mismo valor que CRON_SECRET>', 'mesa_cron_secret');
     ```

     Para cambiarlos: `select vault.update_secret((select id from vault.secrets where name = 'mesa_cron_secret'), '<nuevo>');`. Sin ellos, la tarea horaria hace su trabajo en la BD (recordatorios, cierre automático, limpieza) pero no avisa a la app; los emails pendientes salen igualmente con la siguiente acción que envíe emails. Para ver las llamadas: `select status_code, error_msg, created from net._http_response order by created desc limit 5;`.
   - **Tiempo real:** `20261127000100_reservas.sql` añade `reservations`, `reservation_tables` y `blocks` a la publicación `supabase_realtime` (si existe y no es `FOR ALL TABLES`, como en todo proyecto de Supabase). Compruébalo en Database → Publications → `supabase_realtime`: tienen que salir esas tres tablas. Si no, actívalas ahí a mano. Las altas y los cambios llegan filtrados por restaurante y por las RLS de cada usuario; los borrados, no: solo traen la clave primaria, así que el panel solo reacciona a los borrados de los bloqueos que está enseñando (y no escucha los de `reservation_tables`, porque todo cambio de mesas pasa también por `reservations`). Al reconectar o al volver a la pestaña, el panel se refresca solo.
````

En `docs/setup.md`, sustituye:

````markdown
   Después, revisa los avisos de seguridad y rendimiento con `get_advisors` (MCP de Supabase) o en Advisors del panel. Es normal que queden avisos 0028/0029 (funciones `SECURITY DEFINER` ejecutables):
   - para `anon`: `get_invitation`, `get_public_restaurant`, `list_public_slugs`, `get_public_menu` y `list_public_menus` (la mini-web y la carta pública solo leen por ellas);
   - para `authenticated`: las de permisos (`is_member`, `has_role`, `my_role`, `belongs_to`, `is_platform_admin`, `my_restaurants`) y las de negocio (`create_restaurant`, `create_invitation`, `accept_invitation`, `set_restaurant_status`, `log_admin_view`, `restaurant_team`, `change_slug`, `restaurant_missing_fields`, `publish_restaurant`, `set_dish_unavailable`, `set_menu_unavailable_mode`, `get_public_menu`, `list_public_menus`, `create_panel_reservation`, `create_walk_in`, `update_panel_reservation`, `set_reservation_status`, `undo_reservation_status`).

````

por:

````markdown
   Después, revisa los avisos de seguridad y rendimiento con `get_advisors` (MCP de Supabase) o en Advisors del panel. Es normal que queden avisos 0028/0029 (funciones `SECURITY DEFINER` ejecutables):
   - para `anon`: `get_invitation`, `get_public_restaurant`, `list_public_slugs`, `get_public_menu` y `list_public_menus` (la mini-web y la carta pública solo leen por ellas). **El Hito 4B no añade ninguna para `anon`**: las funciones públicas de la reserva online (`get_public_booking_day`, `create_public_reservation`, `get_public_reservation`, `modify_public_reservation`, `cancel_public_reservation`, `public_booking_enabled`, `hit_rate_limit`) y las de la cola (`claim_outbox`, `finish_outbox`, `skip_outbox`, `outbox_email_data`) solo las ejecuta `service_role`;
   - para `authenticated`: las de permisos (`is_member`, `has_role`, `my_role`, `belongs_to`, `is_platform_admin`, `my_restaurants`) y las de negocio (`create_restaurant`, `create_invitation`, `accept_invitation`, `set_restaurant_status`, `log_admin_view`, `restaurant_team`, `change_slug`, `restaurant_missing_fields`, `publish_restaurant`, `set_dish_unavailable`, `set_menu_unavailable_mode`, `get_public_menu`, `list_public_menus`, `create_panel_reservation`, `create_walk_in`, `update_panel_reservation`, `set_reservation_status`, `undo_reservation_status`, `retry_outbox`).

````

En `docs/setup.md`, sustituye:

````markdown
- `EMAIL_FROM` tiene que usar un **dominio verificado** en la cuenta de FByte.
- En desarrollo, sin `RESEND_API_KEY` la app no envía nada: escribe el asunto en la consola y muestra el enlace de invitación en pantalla.
````

por:

````markdown
- `EMAIL_FROM` tiene que usar un **dominio verificado** en la cuenta de FByte.
- Los emails de reservas salen de `RESERVATIONS_FROM_ADDRESS` (`reservas@fbytesolutions.com`) con el nombre visible «<Restaurante> vía Mesa» y `reply-to` al email del restaurante (o al de avisos). Comprueba en Resend → Domains que `fbytesolutions.com` sigue verificado antes de activar la reserva online. Las invitaciones siguen saliendo de `EMAIL_FROM` (`no-responder@`).
- Cada email de reservas se anota en `email_outbox` con la reserva y se envía justo después de responder; si falla, se reintenta a los 15 min y a la hora (la tarea horaria), y al tercer fallo queda «No se pudo enviar» con «Reintentar» en la ficha de la reserva.
- En desarrollo, sin `RESEND_API_KEY` la app no envía nada: escribe el asunto en la consola y muestra el enlace de invitación en pantalla.
````

En `docs/setup.md`, sustituye:

````markdown
6. No hay variables nuevas en el Hito 3. El PNG y el PDF del QR se generan en funciones de Node.js (`sharp` ya viene con Next.js). Los QR apuntan a `NEXT_PUBLIC_SITE_URL/<slug>/menu`: **antes de imprimir QR de verdad, comprueba que esa variable tiene la dirección definitiva** (si después cambias de dominio, los QR impresos dejarán de funcionar; si solo cambia el slug, siguen funcionando).
7. No hay variables nuevas en el Hito 4A. El tiempo real del panel de reservas usa `NEXT_PUBLIC_SUPABASE_URL` y la *publishable key* con la sesión del usuario (nunca la clave secreta). Orden de publicación: **primero las migraciones del Hito 4A en Supabase, después el despliegue**.

## 6. Revisión legal (antes de abrir a clientes)
1. El contrato de encargado del tratamiento (`src/lib/legal/dpa.ts`, versión `2026-11-borrador`) y el aviso legal de la mini-web son plantillas marcadas «PENDIENTE DE REVISIÓN LEGAL»: tiene que revisarlas un abogado antes de publicar restaurantes reales.
2. Vercel y Resend son proveedores de EE. UU.: incluye las **transferencias internacionales de datos** (y sus garantías) en el contrato y en la lista de subencargados.
````

por:

````markdown
6. No hay variables nuevas en el Hito 3. El PNG y el PDF del QR se generan en funciones de Node.js (`sharp` ya viene con Next.js). Los QR apuntan a `NEXT_PUBLIC_SITE_URL/<slug>/menu`: **antes de imprimir QR de verdad, comprueba que esa variable tiene la dirección definitiva** (si después cambias de dominio, los QR impresos dejarán de funcionar; si solo cambia el slug, siguen funcionando).
7. Variables nuevas del Hito 4B (todas se leen al usarlas: el build no las necesita, salvo `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, que se fija al compilar):
   - `MANAGE_TOKEN_SECRET`: al menos 32 caracteres aleatorios (`openssl rand -base64 48`). Firma los enlaces de los comensales. **Si la cambias, dejan de funcionar todos los enlaces ya enviados** (los emails nuevos salen bien; los antiguos llevan a «No encontramos esta reserva»). No la rotes salvo que se haya filtrado.
   - `CRON_SECRET`: al menos 32 caracteres aleatorios; el mismo valor en el secreto de Vault `mesa_cron_secret`. Sin ella, `/api/cron/hourly` responde 503.
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`: el widget de Cloudflare Turnstile (modo *Managed*) del dominio de producción. En desarrollo y en las vistas previas, si faltan, se usan las claves de prueba de Cloudflare (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`, siempre aprueban). **En producción, sin claves, la web no acepta reservas online** y lo dice. Tras cambiar la clave pública, vuelve a desplegar.
   - `RESERVATIONS_FROM_ADDRESS`: `reservas@fbytesolutions.com` (dominio verificado en Resend).
   Orden de publicación: **migraciones del Hito 4B → widget de Turnstile → secretos en Vercel y en Vault → comprobar el dominio en Resend y el job de `pg_cron` → desplegar y probar** (ver la lista de comprobación del plan del Hito 4B).
8. No hay variables nuevas en el Hito 4A. El tiempo real del panel de reservas usa `NEXT_PUBLIC_SUPABASE_URL` y la *publishable key* con la sesión del usuario (nunca la clave secreta). Orden de publicación: **primero las migraciones del Hito 4A en Supabase, después el despliegue**.

## 6. Cloudflare Turnstile (reserva online)
1. En Cloudflare → Turnstile, crea un widget para el dominio de producción (y `localhost` si lo quieres probar en local con claves reales), en modo **Managed**.
2. Guarda la *site key* en `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y la *secret key* en `TURNSTILE_SECRET_KEY` (Vercel, entorno *Production*), sin copiarlas en ningún otro sitio.
3. El widget solo sale en el último paso del alta online; ver, modificar y cancelar con el enlace no lo llevan (tienen su límite de intentos). El servidor comprueba el token con `siteverify` antes de tocar la BD.

## 7. Revisión legal (antes de abrir a clientes)
1. El contrato de encargado del tratamiento (`src/lib/legal/dpa.ts`, versión `2026-11-borrador`) y el aviso legal de la mini-web son plantillas marcadas «PENDIENTE DE REVISIÓN LEGAL»: tiene que revisarlas un abogado antes de publicar restaurantes reales.
2. Vercel y Resend son proveedores de EE. UU.: incluye las **transferencias internacionales de datos** (y sus garantías) en el contrato y en la lista de subencargados.
3. Desde el Hito 4B hay una **política de privacidad de las reservas** por restaurante (`/<slug>/privacidad`, `src/lib/legal/privacy.ts`, en los seis idiomas) marcada «PENDIENTE DE REVISIÓN LEGAL». Nombra a Cloudflare Turnstile como subencargado: añádelo también a la lista de subencargados del contrato (`src/lib/legal/dpa.ts`) en la revisión legal.
````

- [ ] **Step 2: Comprueba**

Run: `pnpm test && pnpm lint && pnpm typecheck && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: `Tests  858 passed (858)` (593 unitarias en 86 archivos + 265 de BD en 17 archivos); lint y typecheck sin errores; el build termina y lista `ƒ /[slug]/reservar`, `ƒ /[slug]/reserva/[token]`, `ƒ /[slug]/privacidad` y `ƒ /api/cron/hourly`, sin variables nuevas.

- [ ] **Step 3: Commit**

```bash
git add docs/setup.md
git commit -m "Docs: puesta en marcha del Hito 4B (migraciones, pg_cron, Vault, Turnstile y variables)"
```

---

## Lista de comprobación manual (para el usuario, tras publicar)

Hazla en producción (o en una vista previa con claves reales), con un restaurante publicado, mesas online y la reserva online activada. Marca cada punto:

1. **Botón «Reservar»**: sale en la mini-web (primero, junto a «Ver carta») y en la cabecera de la carta; al apagar «Aceptar reservas desde tu web» (o dejar sin mesas online) desaparece en menos de un minuto y `/<slug>/reservar` explica cómo reservar por teléfono.
2. **Reserva online en el móvil, en dos idiomas** (por ejemplo `?lang=es` y `?lang=en`): personas → día (los días cerrados y fuera de antelación salen deshabilitados) → horas agrupadas por servicio → zona (si hay varias) → datos → Turnstile → resultado «Te hemos enviado un email a …». Prueba también el calendario con el teclado (flechas, Inicio/Fin, Re Pág/Av Pág) y un lector de pantalla.
3. **Confirmación automática y manual**: con «Confirmar las reservas online sin revisarlas» marcada sale «Reserva confirmada»; desmarcada, «Solicitud enviada» y la reserva aparece arriba en «Pendientes de confirmar» del panel (Confirmar/Rechazar). Comprueba el email al comensal tras confirmar o rechazar.
4. **Solicitud de grupo**: con más personas que el máximo online sale el aviso «Para grupos de más de N…», el botón «Enviar solicitud», y llega como pendiente **sin mesa**; asígnale mesa en la ficha y confírmala.
5. **Hora recién ocupada**: abre la misma hora en dos navegadores y reserva en los dos casi a la vez; el segundo ve «Vaya, esa hora se acaba de ocupar…» con las horas más cercanas.
6. **Enlace del email**: ver, **modificar** (día, hora, personas y zona) y **cancelar** dentro del plazo; con la reserva dentro del límite de cancelación sale «Para cambiar algo, llama al restaurante: …»; un enlace inventado da «No encontramos esta reserva». La página no está indexada y no manda Referer.
7. **Emails**: llegan en el idioma de la reserva, con el logo y el color del restaurante, «Gestionar mi reserva», «Cómo llegar» y el teléfono; el remitente es «<Restaurante> vía Mesa» y al responder va al restaurante. El `.ics` de confirmada, modificada y recordatorio se añade bien a **Google Calendar** y a **Apple Calendar** a la hora correcta (y en Canarias, si tienes un restaurante allí).
8. **Avisos al restaurante**: nueva reserva, solicitud, cambio y cancelación del cliente llegan en castellano al «Email para avisos de reservas» (o al del local si está vacío), con «Abrir en el panel»; apagando «Avisarnos por email…» dejan de llegar. Al responder, va al cliente.
9. **Reserva por teléfono**: con email, la casilla «Enviar confirmación por email» sale marcada; con ella el cliente recibe la confirmación con su enlace; desmarcada o sin email, nada. En la ficha, «Enviar avisos por email a …» los activa después.
10. **Panel**: etiqueta «Online», «Teléfono» o «Walk-in» en cada reserva; historial de emails en la ficha. Para forzar un fallo, pon temporalmente una `RESEND_API_KEY` incorrecta en una vista previa: tras tres intentos sale «No pudimos enviar el email de …» y «Reintentar» lo vuelve a intentar.
11. **Tarea horaria**: comprueba que existe el job (`select jobname, schedule from cron.job;`) y, tras una hora, `select status_code from net._http_response order by created desc limit 1;` da 200. Una reserva confirmada para dentro de ~24 h (creada hace más de 6 h) recibe el **recordatorio**; una mesa sentada se cierra sola **2 h después de acabar** y cuenta como visita.
12. **Límite de intentos**: seis altas seguidas en menos de 10 minutos desde el mismo móvil → «Has hecho demasiados intentos…».

## Publicación (lo hace el controlador, cada paso que toca producción con confirmación del usuario)

1. Aplicar `20261128000100`, `…0200`, `…0300` y `…0400` en Supabase, en orden (comprobar después que `cron.job` tiene `mesa-hourly` y los avisos de seguridad: ninguna función nueva para `anon`).
2. Crear el widget de Turnstile con el conector de Cloudflare (dominio de producción, modo Managed).
3. Generar `MANAGE_TOKEN_SECRET` y `CRON_SECRET` y guardarlos en Vercel (y `CRON_SECRET` también en Vault como `mesa_cron_secret`, con `mesa_site_url`) **sin mostrarlos**, junto con `RESERVATIONS_FROM_ADDRESS` y las claves de Turnstile.
4. Comprobar el dominio `fbytesolutions.com` en Resend.
5. Desplegar y hacer la lista de comprobación manual.

## Autorrevisión: cobertura de las decisiones

| Decisión | Dónde |
|---|---|
| 1 Enlace: ver, modificar y cancelar antes del límite | Tareas 3, 15, 16, 17, 19 |
| 2 Tarea horaria con pg_cron y clave en Vault | Tareas 4, 13, 26 |
| 3 Remitente «<Restaurante> vía Mesa», reply-to, invitaciones desde no-responder | Tareas 6, 9, 12 |
| 4 Turnstile (claves de prueba en desarrollo) | Tareas 6, 7, 17, 26 |
| 5 Nombre, email y teléfono obligatorios (+34, extranjeros); notas opcionales | Tareas 2, 14, 17 |
| 6 Casilla «Enviar confirmación por email» en teléfono | Tareas 3, 23 |
| 7 Cierre automático 2 h después (cuenta como visita) | Tarea 4 |
| 8 Email para avisos e interruptor | Tareas 1, 6, 22 |
| 9 Cola en la BD, envío tras responder y reintentos por la tarea horaria | Tareas 1, 4, 12, 13, 16, 23 |
| 10 Nada nuevo desde el navegador; funciones solo para service_role | Tareas 2, 3, 4, 15, 16 |
| 11 Token HMAC, huella en la BD, id generado por la app | Tareas 2, 3, 7, 16, 23 |
| 12 Turnstile solo en el alta; en producción sin claves se rechaza | Tareas 6, 7, 16, 17 |
| 13 Límite de intentos en la BD con huella de la IP | Tareas 1, 2, 4, 7, 16, 19 |
| 14 Página del token: noindex, no-referrer, «No encontramos esta reserva» | Tarea 19 |
| 15 booking_settings: online_enabled, notify_restaurant, notification_email | Tareas 1, 6, 22 |
| 16 reservations.notify_customer y manage_token_hash | Tareas 1, 2, 3 |
| 17 email_outbox (columnas, índice único, RLS, sin escritura) | Tarea 1 |
| 18 Tipos de email | Tarea 1 |
| 19 Actor customer/staff/system | Tareas 1, 2, 3, 4 |
| 20 Reglas de encolado por trigger (función pura probada) | Tarea 1 |
| 21 get_public_booking_day sin datos personales + módulo TS | Tareas 2, 8, 15 |
| 22 is_bookable_slot comparada con el módulo TS | Tarea 2 |
| 23 create_public_reservation (mesa más pequeña, solicitud sin mesa, SLOT_TAKEN) | Tareas 2, 5, 16 |
| 24 Cliente online sin sobrescribir | Tarea 2 |
| 25 get_public_reservation | Tarea 3 |
| 26 modify/cancel_public_reservation (CHANGE_CLOSED) | Tarea 3 |
| 27 Nuevas create/update_panel_reservation | Tareas 3, 23 |
| 28 claim/finish/retry_outbox | Tarea 4 |
| 29 run_hourly_jobs (recordatorios, cierre, limpieza, pg_net) y job condicional | Tarea 4 |
| 30 /api/cron/hourly con comparación en tiempo constante; after() | Tareas 13, 16, 23 |
| 31 deliverOutbox (datos actuales, idempotencia, skipped, logs sin datos) | Tareas 4, 12 |
| 32 RESERVATIONS_FROM_ADDRESS y nombre visible saneado | Tareas 6, 9, 12 |
| 33 Plantillas (comensal 6 idiomas con marca; restaurante en castellano) | Tareas 10, 11 |
| 34 .ics propio | Tareas 9, 12 |
| 35 /[slug]/reservar (pasos, calendario, grupos, privacidad, resultado, informativa, sitemap) | Tareas 17, 18, 21 |
| 36 /[slug]/reserva/[token] | Tareas 17, 19 |
| 37 /[slug]/privacidad (6 idiomas, PENDIENTE DE REVISIÓN LEGAL) | Tarea 20 |
| 38 Botón «Reservar» y acceptsReservations | Tarea 21 |
| 39 Errores públicos y validación por campo con los mismos esquemas | Tareas 10, 14, 16, 17 |
| 40 Pendientes de confirmar arriba y etiqueta de origen | Tareas 6, 24 |
| 41 Historial de emails y «Reintentar» | Tareas 4, 23, 25 |
| 42 Casilla en el formulario telefónico | Tarea 23 |
| 43 Ajustes: interruptores, email de avisos, texto de ayuda nuevo | Tarea 22 |
| 44 Pruebas unitarias (token, ics, disponibilidad, alternativas, plazo, remitente, plantillas, esquemas, Turnstile) | Tareas 7–14 |
| 45 Pruebas de BD (privilegios, sin datos personales, concurrencia, is_bookable_slot, grupo, token, cliente, encolado, recordatorio, cierre, límite, cola) | Tareas 1–5 |
| 46 Sin e2e: lista manual | Esta sección |
| Variables de entorno nuevas | Tareas 6, 26 |
| Publicación | Sección «Publicación» y Tarea 26 |
| Fuera del 4B | No se construye (Global Constraints) |
