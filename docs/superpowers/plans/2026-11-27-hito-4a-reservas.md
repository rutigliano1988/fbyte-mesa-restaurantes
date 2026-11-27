# Mesa — Hito 4A (Reservas: configuración y panel): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada restaurante configure zonas, mesas, duraciones y reglas, y lleve su libro de reservas en el panel: reservas por teléfono con mesa propuesta (o elegidas, o forzadas sin mesa), walk-ins en un clic, vista del día por servicio, cuadrícula mesas × horas, cambios de estado con «Deshacer», bloqueos y tiempo real entre dispositivos.

**Architecture:** Igual que los Hitos 1–3: la seguridad vive en Postgres (RLS por rol + funciones con `search_path = ''`). Reservas, clientes y mesas de reserva **solo se escriben con funciones `SECURITY DEFINER`** que comprueban el rol, buscan todo por `restaurant_id`, toman un *advisory lock* por restaurante y fecha local y vuelven a comprobar el hueco; una restricción de exclusión (`btree_gist`) impide dos reservas activas solapadas en una mesa. El panel lee un día con una sola función (`get_booking_day`, RLS del usuario) y calcula horas libres, mesa propuesta, reparto por servicio y cuadrícula en módulos TypeScript puros y probados (`src/lib/reservations/*`). Las server actions pasan por `runPanelAction(…, { publicData: false })` (no tocan la caché de la web). Supabase Realtime (`postgres_changes`) refresca la página en los demás dispositivos.

**Tech Stack:** Next.js 16.4.6 (App Router, `cacheComponents` desactivado) · React 19.3 · TypeScript 5.9 · Tailwind CSS 4 · Supabase (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.2, Realtime) · Zod 4.6 · Vitest 4.1 · pnpm 10 · Node 22 · PostgreSQL 16 (pruebas) · **nueva:** `libphonenumber-js` 1.13.16.

**Spec:** `docs/superpowers/specs/2026-11-24-plataforma-restaurantes-design.md` (§5 «Horarios y mesas» y «Reservas», §6.1, §6.2, §6.4, §8.1, §12, §13) · **Decisiones del hito (mandan sobre la spec):** `docs/superpowers/specs/2026-11-27-hito-4a-decisiones.md`

## Global Constraints

- Mercado España. Todo texto visible del panel, en castellano de España, con tuteo y la voz FByte: frases cortas, humanas, sin jerga («Algo ha fallado. Vuelve a intentarlo en un momento.», nunca «Error 500»). Este hito no añade textos públicos.
- Nombre del producto **provisional** «Mesa»: solo se escribe en `src/config/brand.ts` (este hito no lo usa).
- Colores FByte en el panel: `ink #0A1330`, `navy #17317F`, `navy-dark #0F2260`, `orange #FF7A1A`, `orange-dark #E8650A`, `peach #FFC48A`, `peach-soft #FFE9D6`, `paper #F8F5EF`, `muted #3A4157`. **Nunca texto blanco sobre naranja**; botón principal = fondo `orange`, texto `ink`. El estado de una reserva se ve con color **y** texto.
- Roles en BD: `admin` (Administrador), `manager` (Encargado), `staff` (Sala/Recepción). Reservas, estados, walk-ins, vista del día y cuadrícula → permiso `reservations.manage` (los tres). Zonas, mesas, ajustes, servicios y bloqueos → `settings.booking` (Administrador y Encargado). La BD es la fuente de verdad: Sala **no** tiene INSERT/UPDATE efectivo sobre zonas, mesas, ajustes ni bloqueos, y **nadie** tiene INSERT/UPDATE directo sobre `customers`, `reservations` ni `reservation_tables` (solo las funciones).
- Toda tabla nueva lleva `restaurant_id`, RLS activado y `revoke all … from anon, authenticated` antes de los `grant` concretos; las piezas de un restaurante solo apuntan a piezas del mismo restaurante (claves foráneas compuestas `(x_id, restaurant_id)` → `(id, restaurant_id)`), y cada columna de clave foránea usada por un borrado en cascada tiene índice. **Anon no toca ninguna tabla nueva ni ejecuta ninguna función nueva** (sigue ejecutando solo `get_invitation`, `get_public_restaurant`, `list_public_slugs`, `get_public_menu` y `list_public_menus`).
- Funciones `SECURITY DEFINER` siempre con `set search_path = ''` y nombres totalmente cualificados; los triggers `SECURITY DEFINER` que buscan filas relacionadas filtran por `restaurant_id = new.restaurant_id`. Toda función nueva hace `revoke execute … from public, anon` (y `authenticated` si es de trigger o auxiliar), porque Supabase (y el shim de pruebas) las concede por defecto.
- **Las migraciones ya aplicadas en Supabase no se editan:** `20261124000100_base.sql`, `20261124000200_invitations.sql`, `20261125000100_local.sql`, `20261125000200_horario.sql`, `20261125000300_publicar.sql`, `20261126000100_menu.sql`, `20261126000200_menu_funciones.sql`, `20261126000300_menu_fotos.sql`, `20261126000400_menu_publico.sql`. Este hito añade `20261127000100_reservas.sql` y `20261127000200_reservas_funciones.sql`. `btree_gist` ya está instalada (esquema `extensions`, Hito 2).
- Toda página nueva bajo `src/app/panel/[restaurantId]/` llama a `requirePanelAccess(restaurantId, permiso)` de `@/lib/auth/guards` (AGENTS.md). Toda server action del panel pasa por `runPanelAction()` (usa `requirePermission`: nada de escribir en modo soporte ni con el restaurante desactivado) con `{ publicData: false }` (no invalida la web pública).
- Server actions: todo id que llega del formulario se comprueba contra `restaurantId` (filtro `.eq('restaurant_id', …)` o comprobación en la función de BD, que recibe siempre `p_restaurant_id`); las búsquedas en tablas de etiquetas usan `Object.hasOwn`; nunca se enseña `error.message` (siempre `mapDbError`), y los errores inesperados se registran (`console.error`).
- Componentes cliente que llaman a server actions: `try/catch` y «Algo ha fallado. Vuelve a intentarlo en un momento.» (`GENERIC_ERROR`) sin lanzar; la interfaz optimista vuelve al último estado confirmado por el servidor; sin envíos dobles (estado pendiente).
- Accesibilidad: un botón que cambia o se mueve no pierde el foco (nunca `disabled` en el control con foco: `aria-disabled`); los resultados se anuncian en una región `aria-live` que está siempre montada; el nombre accesible contiene el texto visible (y empieza por él); foco visible (`focus-visible:outline-3 … outline-navy`); la cuadrícula es usable con teclado (un punto de tabulación, flechas).
- Fechas `dd/mm/aaaa`, horas `HH:MM`, en la zona del restaurante (`Europe/Madrid` o `Atlantic/Canary`); los instantes van en `timestamptz` (UTC). Una franja que pasa de medianoche cuenta para el día en que empieza. Días ISO 1 = lunes … 7 = domingo. Teléfonos en E.164 (`+34612345678`) con `libphonenumber-js` (país por defecto ES; admite extranjeros).
- Límites: 20 zonas y 100 mesas por restaurante; nombre de zona 1–40 y de mesa 1–20 (único sin mirar mayúsculas); capacidades 1–50 (mín ≤ máx); grupo 1–50; hasta 6 tramos de duración sin solaparse; duración por defecto y de tramo 30–360 min en pasos de 15 (manual en una reserva: 15–720); notas ≤ 500; motivo de bloqueo ≤ 140; como mucho 10 mesas por reserva.
- Dependencia nueva con versión exacta (sin `^`): `libphonenumber-js` 1.13.16. La instala la Task 3.
- Next.js 16 no es el que conoces: antes de usar una API, lee su guía en `node_modules/next/dist/docs/` (cada tarea indica cuáles). `params` y `searchParams` son promesas. `redirect` y `notFound` lanzan: no los metas en un `try` (en `runPanelAction` el fallo se recoge y la redirección va después). La regla `react-hooks/purity` de ESLint no deja llamar a `Date.now()` dentro de un componente.
- Pruebas: `pnpm test:unit`, `pnpm test:db` (PostgreSQL 16 local en el puerto 54329, base UTF-8 con locale C, se resetea sola con el shim + todas las migraciones), `pnpm lint`, `pnpm typecheck`, `pnpm build`. Antes de este hito pasan **469** pruebas (325 unitarias en 47 archivos + 144 de BD en 9 archivos); al terminar deben pasar **622** (444 unitarias en 59 archivos + 178 de BD en 12 archivos).
- `pnpm build` sin `.env.local` necesita las mismas variables que la CI: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`.
- No hay claves reales de Supabase en el contenedor: **no** hay prueba e2e en este hito; al final hay una lista de comprobación manual para el usuario. Aplicar las migraciones en Supabase y desplegar lo hace el controlador después (**primero las migraciones, luego el código**).
- Fuera del Hito 4A (no se construye nada de esto): reserva online y su página pública, enlace del comensal, emails y `.ics`, recordatorio 24 h y cierre automático (crons), Turnstile y límite de intentos, consentimientos del comensal y el botón «Reservar» de la mini-web. Las reglas online y las columnas `manage_token_hash`/`privacy_accepted_at` se guardan ya, sin usarse.
- Commits pequeños, uno por paso de «Commit». Mensajes en castellano.

---

## Decisiones de este plan (no estaban en el documento de decisiones)

1. **Nadie escribe reservas, clientes ni mesas de reserva directamente.** Las tablas solo tienen `SELECT`; escriben `create_panel_reservation`, `create_walk_in`, `update_panel_reservation`, `set_reservation_status` y `undo_reservation_status` (`SECURITY DEFINER`, con `p_restaurant_id` siempre y `has_role` de los tres roles). Zonas, mesas, ajustes y bloqueos sí se escriben con RLS (Administrador y Encargado).
2. **El advisory lock es por cada fecha local que toca la reserva** (una cena de 23:30 a 01:00 bloquea los dos días; al modificar, también los de la hora antigua), en orden de fecha para no esperarse en círculo. Si aun así salta la exclusión, se traduce a `SLOT_TAKEN`.
3. **Mesa de una reserva:** «la que proponemos» (`p_table_ids` nulo: la BD la vuelve a elegir dentro del bloqueo, igual que el módulo TS), «elegidas a mano» (una o varias: del restaurante, activas, sin bloqueos, libres y con la suma de capacidades máximas ≥ personas; a mano no se mira la capacidad mínima) o «sin mesa» (`p_force`). Códigos distintos: `NO_TABLE_AVAILABLE` (no hay propuesta), `SLOT_TAKEN` (ocupada), `TABLE_BLOCKED`, `TABLE_INACTIVE`, `TABLE_TOO_SMALL`. Si no hay propuesta, el formulario lo avisa y el botón pasa a «Guardar sin mesa».
4. **«La más pequeña que sirve»** entre las mesas **activas** con mín ≤ personas ≤ máx; desempate: capacidad máxima, posición de la zona, posición de la mesa, nombre (orden de bytes, `collate "C"`) e id. `online_bookable` solo filtra en la reserva online (opción `onlineOnly`, para el 4B).
5. **Deshacer** vuelve a `previous_status` (en el 4A, `confirmed` o `seated`; un rechazo de una pendiente volverá a `pending` en el 4B), una sola vez (`previous_status` se vacía), y comprueba otra vez que las mesas estén libres **y sin bloquear**.
6. **Cliente:** en la reserva por teléfono el teléfono es obligatorio (el email, opcional); se reconoce por teléfono y, si no, por email; si existe, se actualiza el nombre y se completan los datos que falten (sin pisar los de otro cliente). Un walk-in con nombre crea una ficha sin contacto; sin nombre, la reserva no tiene cliente. Un cliente con reservas no se borra (en el Hito 5 se anonimiza).
7. **Zonas y mesas** con nombre único en el restaurante sin mirar mayúsculas, y un campo «Orden» (0–999) en vez de arrastrar. Una zona con mesas no se borra; una mesa con reservas activas que aún no han terminado no se borra (`TABLE_HAS_RESERVATIONS`): se desactiva; sus reservas la conservan, y en la cuadrícula sale mientras tenga reservas a la vista.
8. **Lectura de un día** con `get_booking_day(restaurante, desde, hasta)` (`SECURITY INVOKER`, hasta 3 días): las reservas que empiezan entre las 00:00 del día y las 06:00 del siguiente, con cliente y mesas, y lo que ocupa mesas (reservas activas y bloqueos) hasta 12 h después. Zonas, mesas, ajustes, servicios y excepciones se leen con `select` normales.
9. **Duración:** la de por defecto y la de los tramos, de 30 min a 6 h; a mano, en el formulario, de 30 min a 6 h (más la que ya tuviera la reserva); la BD acepta de 15 min a 12 h.
10. **Bloqueos** en su propia página («Reservas → Bloqueos», `settings.booking`): una mesa o todo el restaurante, en una franja de un día (si acaba antes de empezar, acaba al día siguiente) o el día entero; se crean y se quitan (no se editan). No toman el advisory lock: un bloqueo puede caer sobre reservas ya hechas (lo mismo que si se creara después); lo que impide es reservar encima.
11. **Tiempo real:** `INSERT` y `UPDATE` de `reservations`, `reservation_tables` y `blocks` filtrados por `restaurant_id=eq.<id>`; los `DELETE` no se pueden filtrar en Supabase (con RLS solo traen la clave primaria), así que cualquier borrado de `reservation_tables` o `blocks` refresca. Cada aviso espera 400 ms y hace `router.refresh()`. Se muestra si la conexión está en directo o no.
12. **Vista del día:** las reservas activas sin mesa salen **solo** en «Sin mesa asignada» (no se repiten en su servicio, para no duplicar botones), pero cuentan en el resumen de su servicio. Las de fuera de cualquier servicio, en «Fuera de horario». El resumen cuenta reservas y personas de `pending`, `confirmed`, `seated` y `completed`.
13. **Hora escrita a mano** antes de las 06:00 en un día con un servicio que pasa de medianoche y la contiene → es de esa noche (00:30 = minuto 1470). Al cambiar la hora del reloj, una hora que no existe o que existe dos veces se convierte como PostgreSQL (diferencia de antes del cambio; hora de invierno).
14. **`runPanelAction` gana `publicData: false`**: solo refresca el panel (`revalidatePath`), sin `updateTag` de la web.
15. **Ficha de la reserva** `/reservas/[id]`: datos, cliente con avisos, estado con sus botones y el formulario de cambios (si está activa). Cambiar la fecha en el formulario vuelve a pedir los huecos de ese día (`?fecha=`).
16. **Cuadrícula:** un servicio cada vez (pestañas si hay varios), solo reservas activas; `role="grid"` con un único punto de tabulación y flechas (de tramo en tramo y de mesa en mesa), Inicio y Fin; los huecos son enlaces a «Nueva reserva» con mesa y hora.
17. **Nombres de los estados:** Pendiente, Confirmada, En mesa, Finalizada, Cancelada por el cliente, Cancelada por el restaurante, Rechazada, No vino. Botones: Confirmar, Rechazar, Sentar, No ha venido, Finalizar, Cancela el cliente, Cancelamos nosotros y «Deshacer «…»».

---

## Estructura de archivos del Hito 4A

```
supabase/migrations/20261127000100_reservas.sql           Tablas, restricciones, triggers (límites, copia de horas, contadores), RLS y Realtime
supabase/migrations/20261127000200_reservas_funciones.sql Duración, transiciones, bloqueo, mesa propuesta, cliente, alta/walk-in/cambio/estado/deshacer, get_booking_day
tests/db/helpers.ts                     (modificar) + insertZone, insertTable, insertCustomer, insertReservation
tests/db/reservations.test.ts           Tablas, RLS, límites, exclusión, cascadas y privilegios
tests/db/reservations-functions.test.ts Funciones del panel
tests/db/reservations-concurrency.test.ts Dos altas a la vez (dos conexiones)
package.json · pnpm-lock.yaml           (modificar) libphonenumber-js 1.13.16
src/lib/reservations/codes.ts           Estados, orígenes, etiquetas, colores y límites
src/lib/reservations/transitions.ts (+test) Cambios de estado y deshacer
src/lib/reservations/phone.ts (+test)   Teléfono → E.164 y formato
src/lib/reservations/time.ts (+test)    Fecha local + minuto ↔ instante, día de servicio, ?fecha=
src/lib/reservations/settings.ts (+test) Ajustes por defecto y duración por tramos
src/lib/reservations/day.ts (+test)     Servicios de una fecha, horas, reparto por servicio, resumen
src/lib/reservations/availability.ts (+test) Mesas libres, mesa propuesta, horas con hueco (§6.2)
src/lib/reservations/grid.ts (+test)    Geometría de la cuadrícula, teclado y nombres accesibles
src/lib/reservations/customers.ts (+test) Avisos del cliente
src/lib/reservations/rows.ts (+test)    JSON y filas de la BD → objetos de la app
src/lib/reservations/data.ts            (server) loadBookingConfig, getBookingConfig, getBookingDay, getReservationStart, countTables
src/lib/reservations/validation.ts (+test) Esquemas Zod de los formularios
src/lib/db-errors.ts (+test)            (modificar) códigos de reservas
src/lib/panel-nav.ts (+test)            (modificar) Reservas
src/lib/onboarding.ts (+test)           (modificar) paso «Mesas»
src/lib/actions/run.ts                  (modificar) publicData
src/lib/actions/reservations.ts (+test) Teléfono, cambios, walk-in, estados, deshacer, buscar cliente
src/lib/actions/booking-settings.ts     Zonas, mesas y ajustes
src/lib/actions/blocks.ts               Bloqueos
src/lib/actions/schedule.ts             (modificar) última reserva e intervalo
src/lib/local/data.ts                   (modificar) servicios con los campos nuevos
src/lib/supabase/browser.ts             Cliente del navegador (Realtime)
src/components/schedule/ServiceRow.tsx  (modificar) última reserva e intervalo
src/components/reservations/RealtimeRefresh.tsx (cliente) cambios en directo
src/components/reservations/ReservationStatusBadge.tsx · CustomerWarnings.tsx · ReservationsNav.tsx (+test) · DayPicker.tsx
src/components/reservations/ReservationActions.tsx (cliente) estado optimista, botones y deshacer
src/components/reservations/ReservationItem.tsx Una reserva en la lista del día
src/components/reservations/TableCheckboxes.tsx (cliente) mesas a mano
src/components/reservations/ReservationForm.tsx (cliente) nueva reserva y cambios
src/components/reservations/WalkInForm.tsx (cliente)
src/components/reservations/ReservationGrid.tsx (cliente) cuadrícula con teclado
src/components/reservations/TableSettings.tsx · BookingSettingsForm.tsx Ajustes
src/app/panel/[restaurantId]/page.tsx   (modificar) paso «Mesas» y enlace a las reservas
src/app/panel/[restaurantId]/horario/page.tsx (modificar)
src/app/panel/[restaurantId]/reservas/page.tsx              Vista del día
src/app/panel/[restaurantId]/reservas/nueva/page.tsx        Nueva reserva (teléfono)
src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx Ficha y cambios
src/app/panel/[restaurantId]/reservas/walk-in/page.tsx
src/app/panel/[restaurantId]/reservas/cuadricula/page.tsx
src/app/panel/[restaurantId]/reservas/bloqueos/page.tsx
src/app/panel/[restaurantId]/reservas/ajustes/page.tsx
docs/setup.md                           (modificar) migraciones, Realtime y orden de publicación
```

---

### Task 1: Migración de reservas: tablas, restricciones, triggers, RLS y Realtime

**Files:**
- Create: `supabase/migrations/20261127000100_reservas.sql`
- Modify: `tests/db/helpers.ts` (añadir al final)
- Test: `tests/db/reservations.test.ts`

**Interfaces:**
- Consumes (Hitos 1–3): `public.restaurants`, `public.services`, `public.has_role(uuid, member_role[])`, `public.is_member(uuid)`, `public.is_platform_admin()`, `public.set_updated_at()`, `auth.uid()`; helpers `tx`, `as`, `asSuperuser`, `createUser`, `insertRestaurant`, `addMember`, `expectDbError`, `pool`.
- Produces:
  - Tipos `public.reservation_status` (`pending|confirmed|seated|completed|cancelled_customer|cancelled_restaurant|rejected|no_show`) y `public.reservation_source` (`online|phone|walk_in`).
  - `public.services.last_booking_minute smallint null` y `slot_interval_min smallint not null default 15` (CHECK `services_last_booking_check`, `services_slot_interval_check`; `grant update` de las dos).
  - Tablas `zones(id, restaurant_id, name, position)` (índice único `zones_name_key`), `tables(id, restaurant_id, zone_id, name, min_capacity, max_capacity, online_bookable, active, position)` (`tables_name_key`, `tables_capacity_check`, FK `tables_zone_id_restaurant_id_fkey`), `booking_settings(restaurant_id PK, default_duration_min, duration_rules jsonb, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm)` (`booking_settings_duration_rules_check`), `customers(…, phone, email, notes, tags, marketing_opt_in, marketing_opt_in_at, visits_count, no_show_count, cancel_count, last_visit_at, anonymized_at)` (`customers_phone_key`, `customers_email_key`, `customers_phone_check`, `customers_email_check`), `reservations(…, customer_id, party_size, starts_at, ends_at, status, previous_status, status_changed_at, source, notes, internal_notes, locale, created_by, manage_token_hash, privacy_accepted_at)`, `reservation_tables(reservation_id, table_id, restaurant_id, starts_at, ends_at, active)` (exclusión `reservation_tables_no_overlap`), `blocks(id, restaurant_id, table_id null, starts_at, ends_at, reason, created_by default auth.uid())`.
  - `public.valid_duration_rules(jsonb) → boolean` (la ejecuta quien inserta).
  - Triggers: `limit_booking_rows` (`ZONE_LIMIT`, `TABLE_LIMIT`, `FORBIDDEN`), `check_table_delete` (`TABLE_HAS_RESERVATIONS`), `fill_reservation_table`, `sync_reservation_tables`, `update_customer_counters`.
  - Helpers de prueba: `insertZone(c, restaurantId, name?, position?) → id`, `insertTable(c, restaurantId, zoneId, { name?, min?, max?, active?, onlineBookable?, position? }) → id` (por defecto «T1», 2–4), `insertCustomer(c, restaurantId, { name?, phone?, email? }) → id`, `insertReservation(c, restaurantId, { startsAt, minutes?, partySize?, status?, source?, customerId?, tableIds? }) → id` (como superusuario; los triggers se ejecutan igual) y el tipo `ReservationStatus`.

Lee antes: `supabase/migrations/20261125000200_horario.sql` (exclusión con `btree_gist`) y `20261126000100_menu.sql` (estilo de límites, claves compuestas, políticas en bucle), y `tests/db/menu.test.ts`.

- [ ] **Step 1: Helpers de prueba de reservas**

Append to `tests/db/helpers.ts`:

```ts
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled_customer'
  | 'cancelled_restaurant'
  | 'rejected'
  | 'no_show';

export async function insertZone(c: pg.PoolClient, restaurantId: string, name = 'Sala', position = 0): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into public.zones (restaurant_id, name, position) values ($1, $2, $3) returning id',
    [restaurantId, name, position],
  );
  return rows[0].id;
}

/** Mesa de una zona: por defecto «T1», de 2 a 4 personas, activa y reservable online. */
export async function insertTable(
  c: pg.PoolClient,
  restaurantId: string,
  zoneId: string,
  t: { name?: string; min?: number; max?: number; active?: boolean; onlineBookable?: boolean; position?: number } = {},
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    `insert into public.tables (restaurant_id, zone_id, name, min_capacity, max_capacity, active, online_bookable, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [restaurantId, zoneId, t.name ?? 'T1', t.min ?? 2, t.max ?? 4, t.active ?? true, t.onlineBookable ?? true, t.position ?? 0],
  );
  return rows[0].id;
}

export async function insertCustomer(
  c: pg.PoolClient,
  restaurantId: string,
  cu: { name?: string; phone?: string | null; email?: string | null } = {},
): Promise<string> {
  await asSuperuser(c);
  const { rows } = await c.query<{ id: string }>(
    'insert into public.customers (restaurant_id, name, phone, email) values ($1, $2, $3, $4) returning id',
    [restaurantId, cu.name ?? 'Ana García', cu.phone === undefined ? '+34612345678' : cu.phone, cu.email ?? null],
  );
  return rows[0].id;
}

/** Reserva insertada a mano (sin las funciones del panel), con sus mesas. Por defecto, confirmada, de 90 minutos y para 2. */
export async function insertReservation(
  c: pg.PoolClient,
  restaurantId: string,
  r: {
    startsAt: string;
    minutes?: number;
    partySize?: number;
    status?: ReservationStatus;
    source?: 'online' | 'phone' | 'walk_in';
    customerId?: string | null;
    tableIds?: string[];
  },
): Promise<string> {
  await asSuperuser(c);
  const customerId = r.customerId === undefined ? await insertCustomer(c, restaurantId, { phone: null }) : r.customerId;
  const { rows } = await c.query<{ id: string }>(
    `insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), $6, $7) returning id`,
    [restaurantId, customerId, r.partySize ?? 2, r.startsAt, r.minutes ?? 90, r.status ?? 'confirmed', r.source ?? 'phone'],
  );
  for (const tableId of r.tableIds ?? []) {
    await c.query('insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)', [
      rows[0].id,
      tableId,
      restaurantId,
    ]);
  }
  return rows[0].id;
}
```

- [ ] **Step 2: Escribir las pruebas (fallan)**

Create `tests/db/reservations.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asSuperuser,
  createUser,
  expectDbError,
  insertCustomer,
  insertReservation,
  insertRestaurant,
  insertTable,
  insertZone,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

async function setup(c: pg.PoolClient) {
  const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
  const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b', status: 'setup' });
  const admin = await createUser(c, 'admin@example.com');
  const manager = await createUser(c, 'enc@example.com');
  const staff = await createUser(c, 'sala@example.com');
  const otherAdmin = await createUser(c, 'otro@example.com');
  await addMember(c, a, admin.id, 'admin');
  await addMember(c, a, manager.id, 'manager');
  await addMember(c, a, staff.id, 'staff');
  await addMember(c, b, otherAdmin.id, 'admin');
  return { a, b, admin, manager, staff, otherAdmin };
}

const insZone = 'insert into public.zones (restaurant_id, name, position) values ($1, $2, $3) returning id';
const insTable =
  'insert into public.tables (restaurant_id, zone_id, name, min_capacity, max_capacity) values ($1, $2, $3, $4, $5) returning id';
const NIGHT = '2030-06-14T19:00:00Z';

describe('zonas y mesas', () => {
  it('administrador y encargado las crean y cambian; sala solo las ve', () =>
    tx(async (c) => {
      const { a, manager, staff } = await setup(c);
      await as(c, manager);
      const zone = (await c.query(insZone, [a, 'Terraza', 1])).rows[0].id as string;
      const table = (await c.query(insTable, [a, zone, 'T1', 2, 4])).rows[0].id as string;
      expect((await c.query('update public.tables set max_capacity = 6, active = false where id = $1', [table])).rowCount).toBe(1);
      await as(c, staff);
      expect((await c.query('select name, max_capacity, active from public.tables')).rows).toEqual([
        { name: 'T1', max_capacity: 6, active: false },
      ]);
      await expectDbError(c, insZone, [a, 'Sala', 0], /FORBIDDEN/);
      await expectDbError(c, insTable, [a, zone, 'T2', 2, 4], /FORBIDDEN/);
      expect((await c.query('update public.zones set name = $2 where id = $1', [zone, 'Patio'])).rowCount).toBe(0);
      expect((await c.query('delete from public.tables')).rowCount).toBe(0);
    }));

  it('otro restaurante y anon no ven ni escriben nada', () =>
    tx(async (c) => {
      const { a, b, otherAdmin } = await setup(c);
      const zone = await insertZone(c, a);
      await insertTable(c, a, zone);
      await insertReservation(c, a, { startsAt: NIGHT });
      await as(c, otherAdmin);
      for (const t of ['zones', 'tables', 'customers', 'reservations', 'reservation_tables', 'booking_settings', 'blocks']) {
        expect((await c.query(`select 1 from public.${t}`)).rowCount, t).toBe(0);
      }
      await expectDbError(c, insZone, [a, 'Robada', 0], /FORBIDDEN/);
      await expectDbError(c, insTable, [b, zone, 'T9', 2, 4], /tables_zone_id_restaurant_id_fkey/);
      await as(c, null);
      await expectDbError(c, 'select 1 from public.reservations', [], /permission denied/);
    }));

  it('valida nombres y capacidades; el nombre de la mesa es único en el restaurante sin mirar mayúsculas', () =>
    tx(async (c) => {
      const { a, b, admin } = await setup(c);
      const zone = await insertZone(c, a);
      const zoneB = await insertZone(c, b);
      await insertTable(c, b, zoneB, { name: 'T1' });
      await as(c, admin);
      await expectDbError(c, insZone, [a, ' ', 0], /zones_name_check/);
      await expectDbError(c, insZone, [a, 'x'.repeat(41), 0], /zones_name_check/);
      await expectDbError(c, insZone, [a, 'sala', 0], /zones_name_key/);
      await expectDbError(c, insTable, [a, zone, 'x'.repeat(21), 2, 4], /tables_name_check/);
      await expectDbError(c, insTable, [a, zone, 'T1', 0, 4], /tables_min_capacity_check/);
      await expectDbError(c, insTable, [a, zone, 'T1', 2, 51], /tables_max_capacity_check/);
      await expectDbError(c, insTable, [a, zone, 'T1', 6, 4], /tables_capacity_check/);
      expect((await c.query(insTable, [a, zone, 'T1', 2, 4])).rowCount).toBe(1);
      await expectDbError(c, insTable, [a, zone, ' t1 ', 1, 2], /tables_name_key/);
    }));

  it('como mucho 20 zonas y 100 mesas por restaurante', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await asSuperuser(c);
      await c.query("insert into public.zones (restaurant_id, name) select $1, 'Zona ' || g from generate_series(1, 20) g", [a]);
      const zone = (await c.query('select id from public.zones where restaurant_id = $1 limit 1', [a])).rows[0].id as string;
      await c.query(
        "insert into public.tables (restaurant_id, zone_id, name, max_capacity) select $1, $2, 'M' || g, 4 from generate_series(1, 100) g",
        [a, zone],
      );
      await as(c, admin);
      await expectDbError(c, insZone, [a, 'Una más', 0], /ZONE_LIMIT/);
      await expectDbError(c, insTable, [a, zone, 'Otra', 2, 4], /TABLE_LIMIT/);
    }));

  it('una zona con mesas no se borra; una mesa con reservas futuras tampoco, pero se puede desactivar', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      const zone = await insertZone(c, a);
      const busy = await insertTable(c, a, zone, { name: 'T1' });
      const past = await insertTable(c, a, zone, { name: 'T2' });
      await insertReservation(c, a, { startsAt: NIGHT, tableIds: [busy] });
      await insertReservation(c, a, { startsAt: '2020-01-10T13:00:00Z', status: 'completed', tableIds: [past] });
      await insertReservation(c, a, { startsAt: '2030-07-01T13:00:00Z', status: 'cancelled_customer', tableIds: [past] });
      await as(c, manager);
      await expectDbError(c, 'delete from public.zones where id = $1', [zone], /update or delete on table "zones"/);
      await expectDbError(c, 'delete from public.tables where id = $1', [busy], /TABLE_HAS_RESERVATIONS/);
      expect((await c.query('update public.tables set active = false where id = $1', [busy])).rowCount).toBe(1);
      expect((await c.query('delete from public.tables where id = $1', [past])).rowCount).toBe(1);
    }));

  it('al borrar el restaurante se borra todo lo de reservas', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const zone = await insertZone(c, a);
      const table = await insertTable(c, a, zone);
      await insertReservation(c, a, { startsAt: NIGHT, tableIds: [table] });
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at) values ($1, $2, $3, $3::timestamptz + interval '1 hour')", [a, table, NIGHT]);
      await c.query('delete from public.restaurants where id = $1', [a]);
      for (const t of ['zones', 'tables', 'customers', 'reservations', 'reservation_tables', 'blocks']) {
        expect((await c.query(`select 1 from public.${t} where restaurant_id = $1`, [a])).rowCount, t).toBe(0);
      }
    }));
});

describe('reservas y sus mesas', () => {
  it('una mesa no tiene dos reservas activas que se solapen; canceladas o seguidas, sí', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      await insertReservation(c, a, { startsAt: NIGHT, tableIds: [table] });
      const other = await insertReservation(c, a, { startsAt: '2030-06-14T19:30:00Z' });
      await expectDbError(
        c,
        'insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)',
        [other, table, a],
        /reservation_tables_no_overlap/,
      );
      await insertReservation(c, a, { startsAt: '2030-06-14T19:30:00Z', status: 'cancelled_customer', tableIds: [table] });
      await insertReservation(c, a, { startsAt: '2030-06-14T20:30:00Z', tableIds: [table] });
      const { rows } = await c.query('select count(*)::int as n from public.reservation_tables where table_id = $1', [table]);
      expect(rows[0].n).toBe(3);
    }));

  it('las mesas copian horas y estado de su reserva, también al cambiarla', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      const id = await insertReservation(c, a, { startsAt: NIGHT, minutes: 120, tableIds: [table] });
      const read = async () =>
        (await c.query('select starts_at, ends_at, active from public.reservation_tables where reservation_id = $1', [id])).rows[0];
      expect(await read()).toEqual({ starts_at: new Date(NIGHT), ends_at: new Date('2030-06-14T21:00:00Z'), active: true });
      await c.query("update public.reservations set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour', status = 'no_show' where id = $1", [id]);
      expect(await read()).toEqual({ starts_at: new Date('2030-06-14T20:00:00Z'), ends_at: new Date('2030-06-14T22:00:00Z'), active: false });
    }));

  it('una reserva no lleva mesas ni clientes de otro restaurante, y sin cliente solo puede ser un walk-in', () =>
    tx(async (c) => {
      const { a, b } = await setup(c);
      const tableB = await insertTable(c, b, await insertZone(c, b));
      const customerB = await insertCustomer(c, b);
      const id = await insertReservation(c, a, { startsAt: NIGHT });
      await expectDbError(
        c,
        'insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)',
        [id, tableB, a],
        /reservation_tables_table_id_restaurant_id_fkey/,
      );
      await expectDbError(
        c,
        'insert into public.reservation_tables (reservation_id, table_id, restaurant_id) values ($1, $2, $3)',
        [id, tableB, b],
        /FORBIDDEN/,
      );
      await expectDbError(c, 'update public.reservations set customer_id = $2 where id = $1', [id, customerB], /reservations_customer_id_restaurant_id_fkey/);
      await expectDbError(c, 'update public.reservations set customer_id = null where id = $1', [id], /reservations_customer_check/);
      await expectDbError(c, "update public.reservations set ends_at = starts_at where id = $1", [id], /reservations_time_check/);
      await expectDbError(c, "update public.reservations set party_size = 51 where id = $1", [id], /reservations_party_size_check/);
    }));

  it('sala lee reservas y clientes pero no los escribe directamente', () =>
    tx(async (c) => {
      const { a, staff } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      const id = await insertReservation(c, a, { startsAt: NIGHT, tableIds: [table] });
      await as(c, staff);
      expect((await c.query('select id from public.reservations')).rows).toEqual([{ id }]);
      expect((await c.query('select 1 from public.customers')).rowCount).toBe(1);
      await expectDbError(c, "update public.reservations set status = 'seated' where id = $1", [id], /permission denied/);
      await expectDbError(c, "insert into public.customers (restaurant_id, name) values ($1, 'X')", [a], /permission denied/);
      await expectDbError(c, 'delete from public.reservation_tables', [], /permission denied/);
      await expectDbError(
        c,
        "insert into public.blocks (restaurant_id, starts_at, ends_at) values ($1, now(), now() + interval '1 hour')",
        [a],
        /row-level security/,
      );
    }));

  it('FByte en soporte lee pero no escribe', () =>
    tx(async (c) => {
      const { a } = await setup(c);
      const fbyte = await createUser(c, 'soporte@fbyte.es', { platformAdmin: true });
      await insertReservation(c, a, { startsAt: NIGHT });
      await as(c, fbyte);
      expect((await c.query('select 1 from public.reservations')).rowCount).toBe(1);
      await expectDbError(c, insZone, [a, 'Sala', 0], /FORBIDDEN/);
    }));
});

describe('ajustes, servicios, clientes y bloqueos', () => {
  it('ajustes de reserva: valores por defecto y tramos de duración válidos', () =>
    tx(async (c) => {
      const { a, b, manager } = await setup(c);
      await as(c, manager);
      const ins = 'insert into public.booking_settings (restaurant_id, duration_rules) values ($1, $2)';
      const rules = (r: unknown) => JSON.stringify(r);
      const bad: unknown[] = [
        { min_party: 1, max_party: 2 },
        [{ min_party: 3, max_party: 2, duration_min: 90 }],
        [{ min_party: 1, max_party: 2, duration_min: 100 }],
        [{ min_party: 1, max_party: 2, duration_min: 15 }],
        [{ min_party: 1, max_party: 60, duration_min: 90 }],
        [{ min_party: 1.5, max_party: 2, duration_min: 90 }],
        [{ min_party: '1', max_party: 2, duration_min: 90 }],
        [{ min_party: 1, max_party: 4, duration_min: 90 }, { min_party: 4, max_party: 6, duration_min: 120 }],
        Array.from({ length: 7 }, (_, i) => ({ min_party: i + 1, max_party: i + 1, duration_min: 90 })),
      ];
      for (const r of bad) await expectDbError(c, ins, [a, rules(r)], /booking_settings_duration_rules_check/);
      await c.query(ins, [a, rules([{ min_party: 1, max_party: 2, duration_min: 75 }, { min_party: 7, max_party: 50, duration_min: 150 }])]);
      const { rows } = await c.query(
        'select default_duration_min, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm from public.booking_settings',
      );
      expect(rows).toEqual([
        { default_duration_min: 90, min_advance_min: 60, max_advance_days: 60, max_online_party: 8, cancel_limit_hours: 2, auto_confirm: true },
      ]);
      await expectDbError(c, 'update public.booking_settings set default_duration_min = 100', [], /booking_settings_default_duration_check/);
      await expectDbError(c, ins, [b, '[]'], /row-level security/);
    }));

  it('servicios: última hora de reserva dentro del servicio e intervalo de 15 o 30', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await as(c, admin);
      const ins =
        'insert into public.services (restaurant_id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min) values ($1, $2, $3, $4, $5, $6, $7)';
      expect((await c.query(ins, [a, 'Cena', 5, 1200, 1470, 1410, 30])).rowCount).toBe(1);
      await expectDbError(c, ins, [a, 'Comida', 1, 780, 960, 960, 15], /services_last_booking_check/);
      await expectDbError(c, ins, [a, 'Comida', 1, 780, 960, 700, 15], /services_last_booking_check/);
      await expectDbError(c, ins, [a, 'Comida', 1, 780, 960, null, 20], /services_slot_interval_check/);
      const { rows } = await c.query(
        "insert into public.services (restaurant_id, name, weekday, start_minute, end_minute) values ($1, 'Comida', 2, 780, 960) returning last_booking_minute, slot_interval_min",
        [a],
      );
      expect(rows[0]).toEqual({ last_booking_minute: null, slot_interval_min: 15 });
      expect((await c.query("update public.services set last_booking_minute = 900, slot_interval_min = 30 where weekday = 2")).rowCount).toBe(1);
    }));

  it('clientes: teléfono E.164 y email en minúsculas, únicos en cada restaurante', () =>
    tx(async (c) => {
      const { a, b } = await setup(c);
      await insertCustomer(c, a, { phone: '+34612345678', email: 'ana@example.com' });
      await insertCustomer(c, b, { phone: '+34612345678', email: 'ana@example.com' });
      const ins = 'insert into public.customers (restaurant_id, name, phone, email) values ($1, $2, $3, $4)';
      await expectDbError(c, ins, [a, 'Otra', '+34612345678', null], /customers_phone_key/);
      await expectDbError(c, ins, [a, 'Otra', null, 'ana@example.com'], /customers_email_key/);
      await expectDbError(c, ins, [a, 'Otra', '612345678', null], /customers_phone_check/);
      await expectDbError(c, ins, [a, 'Otra', null, 'Ana@Example.com'], /customers_email_check/);
      expect((await c.query(ins, [a, 'Sin datos', null, null])).rowCount).toBe(1);
      expect((await c.query(ins, [a, 'Sin datos 2', null, null])).rowCount).toBe(1);
    }));

  it('bloqueos: los crean y borran administrador y encargado, de una mesa o de todo el restaurante', () =>
    tx(async (c) => {
      const { a, manager } = await setup(c);
      const table = await insertTable(c, a, await insertZone(c, a));
      await as(c, manager);
      const ins = 'insert into public.blocks (restaurant_id, table_id, starts_at, ends_at, reason) values ($1, $2, $3, $4, $5) returning created_by';
      const { rows } = await c.query(ins, [a, table, NIGHT, '2030-06-14T21:00:00Z', 'Cumpleaños privado']);
      expect(rows[0].created_by).toBe(manager.id);
      expect((await c.query(ins, [a, null, NIGHT, '2030-06-14T21:00:00Z', null])).rowCount).toBe(1);
      await expectDbError(c, ins, [a, null, NIGHT, NIGHT, null], /blocks_time_check/);
      await expectDbError(c, ins, [a, null, NIGHT, '2030-06-14T21:00:00Z', 'x'.repeat(141)], /blocks_reason_check/);
      await expectDbError(
        c,
        'insert into public.blocks (restaurant_id, starts_at, ends_at, created_by) values ($1, $2, $3, $4)',
        [a, NIGHT, '2030-06-14T21:00:00Z', manager.id],
        /permission denied/,
      );
      expect((await c.query('delete from public.blocks')).rowCount).toBe(2);
    }));
});

describe('privilegios del Hito 4A', () => {
  it('anon no toca ninguna tabla nueva ni ejecuta ninguna función nueva', () =>
    tx(async (c) => {
      for (const t of ['zones', 'tables', 'booking_settings', 'customers', 'reservations', 'reservation_tables', 'blocks']) {
        const { rows } = await c.query("select has_table_privilege('anon', $1, 'select, insert, update, delete') as ok", [`public.${t}`]);
        expect(rows[0].ok, t).toBe(false);
      }
      for (const fn of [
        'public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text)',
        'public.create_walk_in(uuid, integer, uuid[], integer, text)',
        'public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text)',
        'public.set_reservation_status(uuid, uuid, public.reservation_status)',
        'public.undo_reservation_status(uuid, uuid)',
        'public.get_booking_day(uuid, timestamptz, timestamptz)',
        'public.valid_duration_rules(jsonb)',
      ]) {
        const { rows } = await c.query("select has_function_privilege('anon', $1, 'execute') as ok", [fn]);
        expect(rows[0].ok, fn).toBe(false);
      }
    }));

  it('nadie ejecuta los triggers ni las funciones auxiliares', () =>
    tx(async (c) => {
      for (const role of ['anon', 'authenticated']) {
        for (const fn of [
          'public.limit_booking_rows()',
          'public.check_table_delete()',
          'public.fill_reservation_table()',
          'public.sync_reservation_tables()',
          'public.update_customer_counters()',
          'public.reservation_duration(uuid, integer)',
          'public.reservation_transition_ok(public.reservation_status, public.reservation_status)',
          'public.lock_reservation_days(uuid, tstzrange[])',
          'public.pick_reservation_table(uuid, integer, timestamptz, timestamptz, uuid)',
          'public.resolve_reservation_tables(uuid, integer, timestamptz, timestamptz, uuid[], boolean, uuid, uuid[])',
          'public.upsert_customer(uuid, text, text, text)',
        ]) {
          const { rows } = await c.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute']);
          expect(rows[0].ok, `${role} → ${fn}`).toBe(false);
        }
      }
    }));
});
```

- [ ] **Step 3: Comprobar que fallan**

Run: `pnpm vitest run --project db tests/db/reservations.test.ts`
Expected: FAIL; los 17 casos caen con `relation "public.zones" does not exist` (o `public.reservations`).

- [ ] **Step 4: La migración**

Create `supabase/migrations/20261127000100_reservas.sql`:

```sql
-- Mesa · Hito 4A · reservas: zonas, mesas, ajustes, clientes, reservas, mesas de cada reserva y bloqueos.
-- Los instantes van en timestamptz (UTC); el día y la hora local se calculan con restaurants.timezone.

create type public.reservation_status as enum (
  'pending', 'confirmed', 'seated', 'completed', 'cancelled_customer', 'cancelled_restaurant', 'rejected', 'no_show'
);
create type public.reservation_source as enum ('online', 'phone', 'walk_in');

-- Servicios (Hito 2): última hora de reserva (si falta, end_minute − 60 sin bajar de start_minute) e intervalo.
alter table public.services
  add column last_booking_minute smallint,
  add column slot_interval_min smallint not null default 15
    constraint services_slot_interval_check check (slot_interval_min in (15, 30)),
  add constraint services_last_booking_check
    check (last_booking_minute >= start_minute and last_booking_minute < end_minute);
grant update (last_booking_minute, slot_interval_min) on public.services to authenticated;

-- Zonas ---------------------------------------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null constraint zones_name_check check (length(btrim(name)) between 1 and 40),
  position integer not null default 0 constraint zones_position_check check (position between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create unique index zones_name_key on public.zones (restaurant_id, lower(btrim(name)));
create trigger zones_updated_at before update on public.zones
  for each row execute function public.set_updated_at();

-- Mesas ---------------------------------------------------------------------------------------------------------
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  zone_id uuid not null,
  name text not null constraint tables_name_check check (length(btrim(name)) between 1 and 20),
  min_capacity smallint not null default 1 constraint tables_min_capacity_check check (min_capacity between 1 and 50),
  max_capacity smallint not null constraint tables_max_capacity_check check (max_capacity between 1 and 50),
  online_bookable boolean not null default true,
  active boolean not null default true,
  position integer not null default 0 constraint tables_position_check check (position between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  -- Sin ON DELETE: una zona con mesas no se borra (y al borrar el restaurante, la comprobación es al final).
  foreign key (zone_id, restaurant_id) references public.zones (id, restaurant_id),
  constraint tables_capacity_check check (min_capacity <= max_capacity)
);
create unique index tables_name_key on public.tables (restaurant_id, lower(btrim(name)));
create index tables_zone_idx on public.tables (zone_id);
create trigger tables_updated_at before update on public.tables
  for each row execute function public.set_updated_at();

-- Ajustes de reserva (una fila por restaurante; si no existe, valen los valores por defecto) ----------------------
/** Tramos de duración: [{"min_party": 1, "max_party": 2, "duration_min": 75}], como mucho 6 y sin solaparse. */
create or replace function public.valid_duration_rules(p_rules jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 6 then false
    when exists (
      select 1 from jsonb_array_elements(p_rules) e(v)
      where case
        when jsonb_typeof(e.v) = 'object'
          and coalesce(jsonb_typeof(e.v -> 'min_party'), '') = 'number'
          and coalesce(jsonb_typeof(e.v -> 'max_party'), '') = 'number'
          and coalesce(jsonb_typeof(e.v -> 'duration_min'), '') = 'number'
        then not (
          (e.v ->> 'min_party')::numeric % 1 = 0
          and (e.v ->> 'max_party')::numeric % 1 = 0
          and (e.v ->> 'duration_min')::numeric % 15 = 0
          and (e.v ->> 'min_party')::numeric between 1 and 50
          and (e.v ->> 'max_party')::numeric between (e.v ->> 'min_party')::numeric and 50
          and (e.v ->> 'duration_min')::numeric between 30 and 360
        )
        else true
      end
    ) then false
    else not exists (
      select 1
        from jsonb_array_elements(p_rules) with ordinality a(v, i)
        join jsonb_array_elements(p_rules) with ordinality b(v, j) on a.i < b.j
       where (a.v ->> 'min_party')::numeric <= (b.v ->> 'max_party')::numeric
         and (b.v ->> 'min_party')::numeric <= (a.v ->> 'max_party')::numeric
    )
  end
$$;

create table public.booking_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  default_duration_min smallint not null default 90
    constraint booking_settings_default_duration_check check (default_duration_min between 30 and 360 and default_duration_min % 15 = 0),
  duration_rules jsonb not null default '[]'::jsonb
    constraint booking_settings_duration_rules_check check (public.valid_duration_rules(duration_rules)),
  -- Reglas de la reserva online: se guardan ya y se aplican en el Hito 4B.
  min_advance_min integer not null default 60
    constraint booking_settings_min_advance_check check (min_advance_min between 0 and 10080),
  max_advance_days smallint not null default 60
    constraint booking_settings_max_advance_check check (max_advance_days between 1 and 365),
  max_online_party smallint not null default 8
    constraint booking_settings_max_online_party_check check (max_online_party between 1 and 50),
  cancel_limit_hours smallint not null default 2
    constraint booking_settings_cancel_limit_check check (cancel_limit_hours between 0 and 168),
  auto_confirm boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger booking_settings_updated_at before update on public.booking_settings
  for each row execute function public.set_updated_at();

-- Clientes (ficha mínima; la pantalla de clientes llega en el Hito 5) --------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null constraint customers_name_check check (length(btrim(name)) between 1 and 120),
  -- E.164 (+34612345678), normalizado en la app con libphonenumber-js.
  phone text constraint customers_phone_check check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text constraint customers_email_check
    check (email = lower(email) and length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes text constraint customers_notes_check check (length(notes) <= 500),
  tags text[] not null default '{}' constraint customers_tags_check check (tags <@ array['vip', 'regular', 'problem']),
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  visits_count integer not null default 0 constraint customers_visits_count_check check (visits_count >= 0),
  no_show_count integer not null default 0 constraint customers_no_show_count_check check (no_show_count >= 0),
  cancel_count integer not null default 0 constraint customers_cancel_count_check check (cancel_count >= 0),
  last_visit_at timestamptz,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create unique index customers_phone_key on public.customers (restaurant_id, phone) where phone is not null;
create unique index customers_email_key on public.customers (restaurant_id, email) where email is not null;
create index customers_restaurant_idx on public.customers (restaurant_id);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Reservas ------------------------------------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id uuid,
  party_size smallint not null constraint reservations_party_size_check check (party_size between 1 and 50),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.reservation_status not null default 'confirmed',
  -- Para «Deshacer» el último cambio de estado (una sola vez).
  previous_status public.reservation_status,
  status_changed_at timestamptz,
  source public.reservation_source not null,
  notes text constraint reservations_notes_check check (length(notes) <= 500),
  internal_notes text constraint reservations_internal_notes_check check (length(internal_notes) <= 500),
  locale text not null default 'es'
    constraint reservations_locale_check check (locale in ('es', 'en', 'ca', 'fr', 'de', 'it')),
  created_by uuid references auth.users (id) on delete set null,
  -- Hito 4B (reserva online): se crean ya y quedan vacías.
  manage_token_hash text unique,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  -- Sin ON DELETE: un cliente con reservas no se borra (en el Hito 5 se anonimiza).
  foreign key (customer_id, restaurant_id) references public.customers (id, restaurant_id),
  constraint reservations_time_check check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  constraint reservations_customer_check check (customer_id is not null or source = 'walk_in')
);
create index reservations_day_idx on public.reservations (restaurant_id, starts_at);
create index reservations_customer_idx on public.reservations (customer_id);
create index reservations_created_by_idx on public.reservations (created_by);
create trigger reservations_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();

-- Mesas de cada reserva: horas y «activa» copiadas de la reserva por trigger --------------------------------------
create table public.reservation_tables (
  reservation_id uuid not null,
  table_id uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null,
  created_at timestamptz not null default now(),
  primary key (reservation_id, table_id),
  foreign key (reservation_id, restaurant_id) references public.reservations (id, restaurant_id) on delete cascade,
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade,
  -- Segunda red de seguridad: una mesa nunca tiene dos reservas activas que se solapen.
  constraint reservation_tables_no_overlap
    exclude using gist (table_id with =, tstzrange(starts_at, ends_at) with &&) where (active)
);
create index reservation_tables_table_idx on public.reservation_tables (table_id, starts_at);
create index reservation_tables_restaurant_idx on public.reservation_tables (restaurant_id, starts_at);

-- Bloqueos: una mesa o todo el restaurante (table_id nulo) ------------------------------------------------------
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text constraint blocks_reason_check check (length(btrim(reason)) between 1 and 140),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (table_id, restaurant_id) references public.tables (id, restaurant_id) on delete cascade,
  constraint blocks_time_check check (ends_at > starts_at and ends_at <= starts_at + interval '31 days')
);
create index blocks_restaurant_idx on public.blocks (restaurant_id, starts_at);
create index blocks_table_idx on public.blocks (table_id);
create index blocks_created_by_idx on public.blocks (created_by);
create trigger blocks_updated_at before update on public.blocks
  for each row execute function public.set_updated_at();

-- Triggers ------------------------------------------------------------------------------------------------------
-- Los SECURITY DEFINER buscan las filas relacionadas también por restaurant_id = new.restaurant_id.

/**
 * Como mucho 20 zonas y 100 mesas por restaurante (con bloqueo, para que dos altas a la vez no se cuelen).
 * Un usuario sin permiso recibe FORBIDDEN antes de contar nada de otro restaurante.
 * Sin sesión (superusuario o clave de servicio) no hay rol que mirar.
 */
create or replace function public.limit_booking_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_role(new.restaurant_id, '{admin,manager}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform 1 from public.restaurants r where r.id = new.restaurant_id for no key update;
  if tg_table_name = 'zones' then
    if (select count(*) from public.zones z where z.restaurant_id = new.restaurant_id) >= 20 then
      raise exception 'ZONE_LIMIT' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.tables t where t.restaurant_id = new.restaurant_id) >= 100 then
    raise exception 'TABLE_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger zones_limit before insert on public.zones
  for each row execute function public.limit_booking_rows();
create trigger tables_limit before insert on public.tables
  for each row execute function public.limit_booking_rows();

/** Una mesa con reservas activas que aún no han terminado no se borra: se desactiva. */
create or replace function public.check_table_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Borrado en cascada del restaurante: no hay nada que proteger.
  if not exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
    return old;
  end if;
  if exists (
    select 1 from public.reservation_tables rt
     where rt.table_id = old.id and rt.restaurant_id = old.restaurant_id and rt.active and rt.ends_at > now()
  ) then
    raise exception 'TABLE_HAS_RESERVATIONS' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger tables_check_delete before delete on public.tables
  for each row execute function public.check_table_delete();

/** Al asignar una mesa, copia las horas y si está activa (pending, confirmed o seated) desde su reserva. */
create or replace function public.fill_reservation_table() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select r.starts_at, r.ends_at, r.status in ('pending', 'confirmed', 'seated')
    into new.starts_at, new.ends_at, new.active
    from public.reservations r
   where r.id = new.reservation_id and r.restaurant_id = new.restaurant_id;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reservation_tables_fill before insert on public.reservation_tables
  for each row execute function public.fill_reservation_table();

/** Si cambian las horas o el estado de la reserva, sus mesas lo copian (y la exclusión vuelve a comprobarse). */
create or replace function public.sync_reservation_tables() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reservation_tables rt
     set starts_at = new.starts_at, ends_at = new.ends_at, active = new.status in ('pending', 'confirmed', 'seated')
   where rt.reservation_id = new.id and rt.restaurant_id = new.restaurant_id;
  return null;
end $$;
create trigger reservations_sync_tables after update of starts_at, ends_at, status on public.reservations
  for each row execute function public.sync_reservation_tables();

/**
 * Contadores del cliente: no_show suma en no_show_count, cancelled_customer en cancel_count y completed en
 * visits_count (y last_visit_at); al deshacer, restan.
 */
create or replace function public.update_customer_counters() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null or new.status = old.status then
    return null;
  end if;
  update public.customers c
     set no_show_count = greatest(c.no_show_count
           + (case when new.status = 'no_show' then 1 else 0 end) - (case when old.status = 'no_show' then 1 else 0 end), 0),
         cancel_count = greatest(c.cancel_count
           + (case when new.status = 'cancelled_customer' then 1 else 0 end)
           - (case when old.status = 'cancelled_customer' then 1 else 0 end), 0),
         visits_count = greatest(c.visits_count
           + (case when new.status = 'completed' then 1 else 0 end) - (case when old.status = 'completed' then 1 else 0 end), 0),
         last_visit_at = case when 'completed' in (new.status, old.status) then (
             select max(x.starts_at) from public.reservations x
              where x.customer_id = c.id and x.restaurant_id = c.restaurant_id and x.status = 'completed'
           ) else c.last_visit_at end
   where c.id = new.customer_id and c.restaurant_id = new.restaurant_id;
  return null;
end $$;
create trigger reservations_customer_counters after update of status on public.reservations
  for each row execute function public.update_customer_counters();

-- Privilegios y RLS ---------------------------------------------------------------------------------------------
-- Leen los miembros (y FByte en soporte). Zonas, mesas, ajustes y bloqueos: Administrador y Encargado.
-- Clientes, reservas y sus mesas solo se escriben con las funciones de la siguiente migración. Anon, nada.
alter table public.zones enable row level security;
alter table public.tables enable row level security;
alter table public.booking_settings enable row level security;
alter table public.customers enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_tables enable row level security;
alter table public.blocks enable row level security;

revoke all on public.zones, public.tables, public.booking_settings, public.customers, public.reservations,
  public.reservation_tables, public.blocks from anon, authenticated;

grant select on public.zones, public.tables, public.booking_settings, public.customers, public.reservations,
  public.reservation_tables, public.blocks to authenticated;
grant insert, delete on public.zones, public.tables to authenticated;
grant update (name, position) on public.zones to authenticated;
grant update (zone_id, name, min_capacity, max_capacity, online_bookable, active, position) on public.tables to authenticated;
grant insert on public.booking_settings to authenticated;
grant update (default_duration_min, duration_rules, min_advance_min, max_advance_days, max_online_party,
  cancel_limit_hours, auto_confirm) on public.booking_settings to authenticated;
grant insert (restaurant_id, table_id, starts_at, ends_at, reason) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['zones', 'tables', 'booking_settings', 'customers', 'reservations', 'reservation_tables', 'blocks'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_member(restaurant_id) or public.is_platform_admin())',
      t || '_select', t);
  end loop;
  foreach t in array array['zones', 'tables', 'booking_settings', 'blocks'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_insert', t);
  end loop;
  foreach t in array array['zones', 'tables', 'booking_settings'] loop
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, ''{admin,manager}'')) '
      'with check (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_update', t);
  end loop;
  foreach t in array array['zones', 'tables', 'blocks'] loop
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, ''{admin,manager}''))',
      t || '_delete', t);
  end loop;
end $$;

-- Funciones: triggers para nadie; valid_duration_rules la ejecuta quien inserta (la usa un CHECK).
revoke execute on function public.limit_booking_rows(), public.check_table_delete(), public.fill_reservation_table(),
  public.sync_reservation_tables(), public.update_customer_counters()
  from public, anon, authenticated;
revoke execute on function public.valid_duration_rules(jsonb) from public, anon;
grant execute on function public.valid_duration_rules(jsonb) to authenticated;

-- Tiempo real (Supabase Realtime): solo si existe la publicación (el shim de pruebas no la tiene).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.reservations, public.reservation_tables, public.blocks;
  end if;
end $$;
```

- [ ] **Step 5: Comprobar que pasan**

Run: `pnpm vitest run --project db tests/db/reservations.test.ts && pnpm test:db`
Expected: 17 pruebas en verde; `test:db` → **161** pruebas en verde (10 archivos). (`public.test.ts` sigue diciendo que anon solo ejecuta las 5 funciones públicas.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261127000100_reservas.sql tests/db/helpers.ts tests/db/reservations.test.ts
git commit -m "Reservas (SQL): zonas, mesas, ajustes, clientes, reservas, mesas de reserva y bloqueos con RLS y Realtime"
```

---

### Task 2: Migración de las funciones del panel de reservas y prueba de concurrencia

**Files:**
- Create: `supabase/migrations/20261127000200_reservas_funciones.sql`
- Test: `tests/db/reservations-functions.test.ts`, `tests/db/reservations-concurrency.test.ts`

**Interfaces:**
- Consumes: todo lo de la Task 1 y los helpers `insertZone`, `insertTable`, `insertCustomer`, `insertReservation`.
- Produces (todas con `p_restaurant_id` y `FORBIDDEN` si el usuario no es de ese restaurante o la pieza no es suya):
  - `public.create_panel_reservation(p_restaurant_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer, p_table_ids uuid[], p_force boolean, p_customer_name text, p_customer_phone text, p_customer_email text, p_notes text, p_internal_notes text) → jsonb {"id", "table_ids"}` (nace `confirmed`, `source = 'phone'`; `p_duration_min` nulo = la del tramo; `p_table_ids` nulo o vacío = la propuesta; `p_force` = sin mesa).
  - `public.create_walk_in(p_restaurant_id uuid, p_party_size integer, p_table_ids uuid[], p_duration_min integer, p_customer_name text) → jsonb` (nace `seated` a `date_trunc('minute', now())`; mesas obligatorias).
  - `public.update_panel_reservation(p_restaurant_id uuid, p_reservation_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer, p_table_ids uuid[], p_force boolean, p_notes text, p_internal_notes text) → jsonb` (`RESERVATION_CLOSED` si no está activa).
  - `public.set_reservation_status(p_restaurant_id uuid, p_reservation_id uuid, p_status reservation_status) → void` (`INVALID_TRANSITION`).
  - `public.undo_reservation_status(p_restaurant_id uuid, p_reservation_id uuid) → reservation_status` (`NOTHING_TO_UNDO`, `SLOT_TAKEN`, `TABLE_BLOCKED`).
  - `public.get_booking_day(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz) → jsonb {reservations: [{id, starts_at, ends_at, party_size, status, previous_status, source, notes, internal_notes, created_at, table_ids, customer: {id, name, phone, email, tags, visits_count, no_show_count, cancel_count} | null}], occupancy: [{reservation_id, table_id, starts_at, ends_at}], blocks: [{id, table_id, starts_at, ends_at, reason}]}` (`INVALID_INPUT` si el rango pasa de 3 días).
  - Auxiliares sin `execute` para nadie: `reservation_duration`, `reservation_transition_ok`, `lock_reservation_days`, `pick_reservation_table`, `resolve_reservation_tables`, `upsert_customer`.
  - Códigos de error: `SLOT_TAKEN`, `NO_TABLE_AVAILABLE`, `TABLE_TOO_SMALL`, `TABLE_BLOCKED`, `TABLE_INACTIVE`, `INVALID_TRANSITION`, `NOTHING_TO_UNDO`, `RESERVATION_CLOSED`, `INVALID_INPUT`, `FORBIDDEN`.

Lee antes: `supabase/migrations/20261126000200_menu_funciones.sql` (estilo de funciones y privilegios). En la prueba de concurrencia los datos se confirman de verdad (`commit`) y se borran al final; las demás pruebas de BD siguen haciendo `rollback`.

- [ ] **Step 1: Pruebas de las funciones (fallan)**

Create `tests/db/reservations-functions.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  addMember,
  as,
  asSuperuser,
  createUser,
  expectDbError,
  insertCustomer,
  insertReservation,
  insertRestaurant,
  insertTable,
  insertZone,
  pool,
  tx,
} from './helpers';

afterAll(() => pool.end());

const NIGHT = '2030-06-14T19:00:00Z';
const CREATE = 'select public.create_panel_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as r';
const UPDATE = 'select public.update_panel_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9) as r';
const STATUS = 'select public.set_reservation_status($1, $2, $3)';
const UNDO = 'select public.undo_reservation_status($1, $2) as status';
const WALK_IN = 'select public.create_walk_in($1, $2, $3, $4, $5) as r';

/** Restaurante A con Terraza (posición 0: T1 2–2, T2 2–4) y Sala (posición 1: S1 2–4, S2 5–8), y B con una mesa. */
async function setup(c: pg.PoolClient) {
  const a = await insertRestaurant(c, { name: 'Rest A', slug: 'rest-a', status: 'setup' });
  const b = await insertRestaurant(c, { name: 'Rest B', slug: 'rest-b', status: 'setup' });
  const admin = await createUser(c, 'admin@example.com');
  const staff = await createUser(c, 'sala@example.com');
  const otherAdmin = await createUser(c, 'otro@example.com');
  await addMember(c, a, admin.id, 'admin');
  await addMember(c, a, staff.id, 'staff');
  await addMember(c, b, otherAdmin.id, 'admin');
  const terraza = await insertZone(c, a, 'Terraza', 0);
  const sala = await insertZone(c, a, 'Sala', 1);
  const t = {
    T1: await insertTable(c, a, terraza, { name: 'T1', min: 1, max: 2, position: 0 }),
    T2: await insertTable(c, a, terraza, { name: 'T2', min: 2, max: 4, position: 1 }),
    S1: await insertTable(c, a, sala, { name: 'S1', min: 2, max: 4, position: 0 }),
    S2: await insertTable(c, a, sala, { name: 'S2', min: 5, max: 8, position: 1 }),
    B1: await insertTable(c, b, await insertZone(c, b), { name: 'B1' }),
  };
  return { a, b, admin, staff, otherAdmin, t };
}

type Args = {
  startsAt?: string;
  duration?: number | null;
  party?: number;
  tables?: string[] | null;
  force?: boolean;
  name?: string;
  phone?: string | null;
  email?: string | null;
};

function createArgs(restaurantId: string, o: Args = {}) {
  return [
    restaurantId,
    o.startsAt ?? NIGHT,
    o.duration === undefined ? null : o.duration,
    o.party ?? 2,
    o.tables === undefined ? null : o.tables,
    o.force ?? false,
    o.name ?? 'Ana García',
    o.phone === undefined ? '+34612345678' : o.phone,
    o.email ?? null,
    'Trona para un bebé',
    null,
  ];
}

async function create(c: pg.PoolClient, restaurantId: string, o: Args = {}): Promise<{ id: string; table_ids: string[] }> {
  return (await c.query(CREATE, createArgs(restaurantId, o))).rows[0].r;
}

async function reservation(c: pg.PoolClient, id: string) {
  await asSuperuser(c);
  const { rows } = await c.query(
    `select r.status, r.previous_status, r.source, r.party_size, r.starts_at, r.ends_at, r.notes, r.created_by,
            array(select rt.table_id from public.reservation_tables rt where rt.reservation_id = r.id order by rt.table_id) as table_ids
       from public.reservations r where r.id = $1`,
    [id],
  );
  return rows[0];
}

async function counters(c: pg.PoolClient, customerId: string) {
  await asSuperuser(c);
  const { rows } = await c.query(
    'select visits_count, no_show_count, cancel_count, last_visit_at from public.customers where id = $1',
    [customerId],
  );
  return rows[0];
}

describe('create_panel_reservation', () => {
  it('propone la mesa más pequeña que sirve (desempate por posición) y nace confirmada con su cliente', () =>
    tx(async (c) => {
      const { a, staff, t } = await setup(c);
      await as(c, staff);
      const r = await create(c, a, { party: 2 });
      expect(r.table_ids).toEqual([t.T1]);
      const second = await create(c, a, { party: 2, phone: '+34600000002' });
      expect(second.table_ids).toEqual([t.T2]);
      const third = await create(c, a, { party: 3, phone: '+34600000003' });
      expect(third.table_ids).toEqual([t.S1]);
      const row = await reservation(c, r.id);
      expect(row).toMatchObject({ status: 'confirmed', source: 'phone', party_size: 2, notes: 'Trona para un bebé', created_by: staff.id });
      expect(row.ends_at.getTime() - row.starts_at.getTime()).toBe(90 * 60_000);
      const { rows } = await c.query('select name, phone from public.customers where restaurant_id = $1 order by phone', [a]);
      expect(rows).toEqual([
        { name: 'Ana García', phone: '+34600000002' },
        { name: 'Ana García', phone: '+34600000003' },
        { name: 'Ana García', phone: '+34612345678' },
      ]);
    }));

  it('con mesas elegidas: varias si entre todas hay sitio, y si no, TABLE_TOO_SMALL', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const group = await create(c, a, { party: 10, tables: [t.S2, t.S1, t.S2] });
      expect(group.table_ids).toEqual([t.S1, t.S2].sort());
      await expectDbError(c, CREATE, createArgs(a, { party: 7, tables: [t.T1, t.T2] }), /TABLE_TOO_SMALL/);
      const small = await create(c, a, { party: 1, tables: [t.T2], phone: '+34600000009' });
      expect(small.table_ids).toEqual([t.T2]);
    }));

  it('mesa ocupada → SLOT_TAKEN; sin mesa libre → NO_TABLE_AVAILABLE; bloqueada (mesa o restaurante) → TABLE_BLOCKED', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await insertReservation(c, a, { startsAt: '2030-06-14T18:00:00Z', minutes: 90, tableIds: [t.S2] });
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { party: 6, tables: [t.S2] }), /SLOT_TAKEN/);
      await expectDbError(c, CREATE, createArgs(a, { party: 6 }), /NO_TABLE_AVAILABLE/);
      const after = await create(c, a, { party: 6, startsAt: '2030-06-14T19:30:00Z' });
      expect(after.table_ids).toEqual([t.S2]);
      await asSuperuser(c);
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at) values ($1, $2, '2030-06-15T12:00:00Z', '2030-06-15T16:00:00Z')", [a, t.T1]);
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-15T13:00:00Z', tables: [t.T1] }), /TABLE_BLOCKED/);
      expect((await create(c, a, { startsAt: '2030-06-15T13:00:00Z', party: 2 })).table_ids).toEqual([t.T2]);
      await asSuperuser(c);
      await c.query("insert into public.blocks (restaurant_id, starts_at, ends_at, reason) values ($1, '2030-06-16T12:00:00Z', '2030-06-16T16:00:00Z', 'Evento')", [a]);
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-16T13:00:00Z', tables: [t.S1] }), /TABLE_BLOCKED/);
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-16T13:00:00Z' }), /NO_TABLE_AVAILABLE/);
    }));

  it('forzar: se guarda sin mesa aunque no haya hueco y nunca encima de otra reserva', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      for (const id of Object.values(t).slice(0, 4)) await insertReservation(c, a, { startsAt: NIGHT, tableIds: [id] });
      await as(c, admin);
      const forced = await create(c, a, { party: 4, force: true, tables: [t.S1] });
      expect(forced.table_ids).toEqual([]);
      expect((await reservation(c, forced.id)).table_ids).toEqual([]);
    }));

  it('reconoce al cliente por teléfono o por email, actualiza el nombre y completa lo que falta', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const known = await insertCustomer(c, a, { name: 'Ana', phone: '+34612345678', email: null });
      const byEmail = await insertCustomer(c, a, { name: 'Luis', phone: null, email: 'luis@example.com' });
      await as(c, admin);
      await create(c, a, { name: 'Ana García', email: 'ana@example.com' });
      await create(c, a, { startsAt: '2030-06-15T19:00:00Z', name: 'Luis Pérez', phone: '+34699999999', email: 'luis@example.com' });
      await asSuperuser(c);
      const { rows } = await c.query('select id, name, phone, email from public.customers where restaurant_id = $1 order by name', [a]);
      expect(rows).toEqual([
        { id: known, name: 'Ana García', phone: '+34612345678', email: 'ana@example.com' },
        { id: byEmail, name: 'Luis Pérez', phone: '+34699999999', email: 'luis@example.com' },
      ]);
    }));

  it('duración: la del tramo, la de por defecto o la escrita a mano; datos que no valen → INVALID_INPUT', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      await as(c, admin);
      await c.query('insert into public.booking_settings (restaurant_id, default_duration_min, duration_rules) values ($1, 105, $2)', [
        a,
        JSON.stringify([{ min_party: 1, max_party: 2, duration_min: 60 }]),
      ]);
      const minutes = async (id: string) => {
        const row = await reservation(c, id);
        await as(c, admin);
        return (row.ends_at.getTime() - row.starts_at.getTime()) / 60_000;
      };
      expect(await minutes((await create(c, a, { party: 2 })).id)).toBe(60);
      expect(await minutes((await create(c, a, { party: 3, phone: '+34600000003' })).id)).toBe(105);
      expect(await minutes((await create(c, a, { party: 4, duration: 150, phone: '+34600000004' })).id)).toBe(150);
      for (const o of [{ party: 0 }, { party: 51 }, { duration: 20 }, { duration: 735 }, { name: ' ' }, { phone: null }] as Args[]) {
        await expectDbError(c, CREATE, createArgs(a, o), /INVALID_INPUT/);
      }
      await expectDbError(c, CREATE, createArgs(a, { startsAt: '2030-06-20T19:00:00Z', phone: '612345678' }), /customers_phone_check/);
    }));

  it('sala reserva; otro restaurante, una mesa de otro restaurante o FByte en soporte → FORBIDDEN', () =>
    tx(async (c) => {
      const { a, otherAdmin, admin, t } = await setup(c);
      const fbyte = await createUser(c, 'soporte@fbyte.es', { platformAdmin: true });
      for (const u of [otherAdmin, fbyte]) {
        await as(c, u);
        await expectDbError(c, CREATE, createArgs(a), /FORBIDDEN/);
      }
      await as(c, admin);
      await expectDbError(c, CREATE, createArgs(a, { tables: [t.B1] }), /FORBIDDEN/);
      await as(c, null);
      await expectDbError(c, CREATE, createArgs(a), /permission denied/);
    }));
});

describe('create_walk_in', () => {
  it('se sienta ya en la mesa elegida, con o sin nombre', () =>
    tx(async (c) => {
      const { a, staff, t } = await setup(c);
      await as(c, staff);
      const anon = (await c.query(WALK_IN, [a, 2, [t.T2], null, null])).rows[0].r;
      const named = (await c.query(WALK_IN, [a, 4, [t.S1], 60, 'Familia Ruiz'])).rows[0].r;
      const row = await reservation(c, anon.id);
      expect(row).toMatchObject({ status: 'seated', source: 'walk_in', table_ids: [t.T2] });
      expect(Math.abs(row.starts_at.getTime() - Date.now())).toBeLessThan(120_000);
      const { rows } = await c.query('select c.name from public.reservations r join public.customers c on c.id = r.customer_id where r.id = $1', [named.id]);
      expect(rows).toEqual([{ name: 'Familia Ruiz' }]);
      const n = await c.query('select customer_id from public.reservations where id = $1', [anon.id]);
      expect(n.rows[0].customer_id).toBeNull();
      await as(c, staff);
      await expectDbError(c, WALK_IN, [a, 2, [t.T2], null, null], /SLOT_TAKEN/);
      await expectDbError(c, WALK_IN, [a, 2, [], null, null], /INVALID_INPUT/);
    }));
});

describe('update_panel_reservation', () => {
  it('cambia hora, personas y mesas comprobando el hueco sin contar la propia reserva', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const r = await create(c, a, { party: 2, tables: [t.T2] });
      const later = await create(c, a, { startsAt: '2030-06-14T21:00:00Z', party: 2, tables: [t.S1], phone: '+34600000002' });
      await c.query(UPDATE, [a, r.id, '2030-06-14T19:30:00Z', 90, 3, [t.T2], false, 'Cambia a las 21:30', 'Cliente habitual']);
      let row = await reservation(c, r.id);
      expect(row).toMatchObject({ party_size: 3, table_ids: [t.T2], notes: 'Cambia a las 21:30' });
      expect(row.starts_at).toEqual(new Date('2030-06-14T19:30:00Z'));
      await as(c, admin);
      await expectDbError(c, UPDATE, [a, r.id, '2030-06-14T20:00:00Z', 90, 3, [t.S1], false, null, null], /SLOT_TAKEN/);
      await c.query(UPDATE, [a, r.id, '2030-06-14T19:30:00Z', 90, 6, null, false, null, null]);
      row = await reservation(c, r.id);
      expect(row.table_ids).toEqual([t.S2]);
      await as(c, admin);
      await c.query(UPDATE, [a, r.id, '2030-06-14T19:30:00Z', 90, 6, null, true, null, null]);
      expect((await reservation(c, r.id)).table_ids).toEqual([]);
      expect((await reservation(c, later.id)).table_ids).toEqual([t.S1]);
    }));

  it('solo notas: no vuelve a mirar bloqueos ni mesas desactivadas; reservas cerradas → RESERVATION_CLOSED', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const r = await create(c, a, { party: 2, tables: [t.T2] });
      await asSuperuser(c);
      await c.query('update public.tables set active = false where id = $1', [t.T2]);
      await c.query("insert into public.blocks (restaurant_id, starts_at, ends_at) values ($1, $2, $2::timestamptz + interval '3 hours')", [a, NIGHT]);
      await as(c, admin);
      await c.query(UPDATE, [a, r.id, NIGHT, 90, 2, [t.T2], false, 'Mesa junto a la ventana', null]);
      expect((await reservation(c, r.id)).notes).toBe('Mesa junto a la ventana');
      await as(c, admin);
      await expectDbError(c, UPDATE, [a, r.id, NIGHT, 90, 5, [t.T2], false, null, null], /TABLE_TOO_SMALL/);
      await c.query(STATUS, [a, r.id, 'no_show']);
      await expectDbError(c, UPDATE, [a, r.id, NIGHT, 90, 2, [t.T2], false, null, null], /RESERVATION_CLOSED/);
    }));
});

describe('estados, contadores y deshacer', () => {
  it('solo deja los cambios de estado permitidos', () =>
    tx(async (c) => {
      const { a, staff } = await setup(c);
      const pending = await insertReservation(c, a, { startsAt: NIGHT, status: 'pending' });
      const confirmed = await insertReservation(c, a, { startsAt: NIGHT });
      await as(c, staff);
      await expectDbError(c, STATUS, [a, pending, 'seated'], /INVALID_TRANSITION/);
      await c.query(STATUS, [a, pending, 'confirmed']);
      await c.query(STATUS, [a, pending, 'seated']);
      await expectDbError(c, STATUS, [a, pending, 'no_show'], /INVALID_TRANSITION/);
      await c.query(STATUS, [a, pending, 'completed']);
      await expectDbError(c, STATUS, [a, pending, 'seated'], /INVALID_TRANSITION/);
      await c.query(STATUS, [a, confirmed, 'cancelled_restaurant']);
      await expectDbError(c, STATUS, [a, confirmed, 'confirmed'], /INVALID_TRANSITION/);
      expect(await reservation(c, pending)).toMatchObject({ status: 'completed', previous_status: 'seated' });
    }));

  it('no-show, cancelación del cliente y visita cuentan en el cliente; deshacer resta', () =>
    tx(async (c) => {
      const { a, admin } = await setup(c);
      const customer = await insertCustomer(c, a);
      const r1 = await insertReservation(c, a, { startsAt: '2030-06-10T19:00:00Z', customerId: customer });
      const r2 = await insertReservation(c, a, { startsAt: '2030-06-11T19:00:00Z', customerId: customer });
      const r3 = await insertReservation(c, a, { startsAt: '2030-06-12T19:00:00Z', customerId: customer, status: 'seated' });
      await as(c, admin);
      await c.query(STATUS, [a, r1, 'no_show']);
      await c.query(STATUS, [a, r2, 'cancelled_customer']);
      await c.query(STATUS, [a, r3, 'completed']);
      expect(await counters(c, customer)).toEqual({
        visits_count: 1,
        no_show_count: 1,
        cancel_count: 1,
        last_visit_at: new Date('2030-06-12T19:00:00Z'),
      });
      await as(c, admin);
      expect((await c.query(UNDO, [a, r1])).rows[0].status).toBe('confirmed');
      expect((await c.query(UNDO, [a, r3])).rows[0].status).toBe('seated');
      expect(await counters(c, customer)).toEqual({ visits_count: 0, no_show_count: 0, cancel_count: 1, last_visit_at: null });
      await as(c, admin);
      await expectDbError(c, UNDO, [a, r1], /NOTHING_TO_UNDO/);
      await c.query(STATUS, [a, r1, 'seated']);
      await expectDbError(c, UNDO, [a, r1], /NOTHING_TO_UNDO/);
    }));

  it('deshacer vuelve a mirar que la mesa siga libre y sin bloquear', () =>
    tx(async (c) => {
      const { a, admin, t } = await setup(c);
      await as(c, admin);
      const first = await create(c, a, { party: 2, tables: [t.T1] });
      await c.query(STATUS, [a, first.id, 'cancelled_restaurant']);
      await create(c, a, { party: 2, tables: [t.T1], phone: '+34600000002' });
      await expectDbError(c, UNDO, [a, first.id], /SLOT_TAKEN/);
      const other = await create(c, a, { startsAt: '2030-06-15T19:00:00Z', party: 2, tables: [t.T2], phone: '+34600000003' });
      await c.query(STATUS, [a, other.id, 'no_show']);
      await asSuperuser(c);
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at) values ($1, $2, '2030-06-15T18:00:00Z', '2030-06-15T23:00:00Z')", [a, t.T2]);
      await as(c, admin);
      await expectDbError(c, UNDO, [a, other.id], /TABLE_BLOCKED/);
      expect((await reservation(c, first.id)).status).toBe('cancelled_restaurant');
    }));

  it('una reserva de otro restaurante → FORBIDDEN', () =>
    tx(async (c) => {
      const { a, b, admin } = await setup(c);
      const theirs = await insertReservation(c, b, { startsAt: NIGHT });
      await as(c, admin);
      await expectDbError(c, STATUS, [a, theirs, 'seated'], /FORBIDDEN/);
      await expectDbError(c, UNDO, [a, theirs], /FORBIDDEN/);
      await expectDbError(c, UPDATE, [a, theirs, NIGHT, 90, 2, null, false, null, null], /FORBIDDEN/);
      await expectDbError(c, STATUS, [b, theirs, 'seated'], /FORBIDDEN/);
    }));
});

describe('get_booking_day', () => {
  it('devuelve las reservas del rango con cliente y mesas, y lo que ocupa mesas hasta 12 h después', () =>
    tx(async (c) => {
      const { a, staff, otherAdmin, t } = await setup(c);
      const customer = await insertCustomer(c, a, { name: 'Ana', phone: '+34612345678' });
      const inside = await insertReservation(c, a, { startsAt: NIGHT, customerId: customer, tableIds: [t.T1, t.T2], partySize: 5 });
      await insertReservation(c, a, { startsAt: '2030-06-15T09:00:00Z', tableIds: [t.S1] });
      await insertReservation(c, a, { startsAt: '2030-06-14T20:00:00Z', status: 'cancelled_customer', tableIds: [t.S2] });
      await c.query("insert into public.blocks (restaurant_id, table_id, starts_at, ends_at, reason) values ($1, $2, '2030-06-14T12:00:00Z', '2030-06-14T15:00:00Z', 'Obras')", [a, t.S2]);
      await as(c, staff);
      const { rows } = await c.query('select public.get_booking_day($1, $2, $3) as d', [a, '2030-06-14T00:00:00Z', '2030-06-15T04:00:00Z']);
      const day = rows[0].d;
      expect(day.reservations.map((r: { id: string }) => r.id)).toHaveLength(2);
      expect(day.reservations[0]).toMatchObject({
        id: inside,
        party_size: 5,
        status: 'confirmed',
        table_ids: [t.T1, t.T2].sort(),
        customer: { id: customer, name: 'Ana', phone: '+34612345678', tags: [], visits_count: 0, no_show_count: 0, cancel_count: 0 },
      });
      expect(day.occupancy.map((o: { table_id: string }) => o.table_id).sort()).toEqual([t.T1, t.T2, t.S1].sort());
      expect(day.blocks).toEqual([
        expect.objectContaining({ table_id: t.S2, reason: 'Obras' }),
      ]);
      await expectDbError(c, 'select public.get_booking_day($1, $2, $3)', [a, '2030-06-14T00:00:00Z', '2030-06-20T00:00:00Z'], /INVALID_INPUT/);
      await as(c, otherAdmin);
      await expectDbError(c, 'select public.get_booking_day($1, $2, $3)', [a, '2030-06-14T00:00:00Z', '2030-06-15T00:00:00Z'], /FORBIDDEN/);
    }));
});
```

- [ ] **Step 2: Prueba de concurrencia (falla)**

Create `tests/db/reservations-concurrency.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import type pg from 'pg';
import { pool } from './helpers';

// Aquí los datos se confirman de verdad (commit): cada conexión solo ve lo que la otra ya ha confirmado.
// Al acabar se borra el restaurante (en cascada) y el usuario.
const CREATE = 'select public.create_panel_reservation($1, $2, null, $3, $4, false, $5, $6, null, null, null) as r';
let restaurantId = '';
let userId = '';
const tables: Record<'T1' | 'T2', string> = { T1: '', T2: '' };

beforeAll(async () => {
  const c = await pool.connect();
  try {
    restaurantId = (await c.query("insert into public.restaurants (name, slug) values ('Concurrencia', 'concurrencia-4a') returning id")).rows[0].id;
    userId = (await c.query("insert into auth.users (email) values ('concurrencia@example.com') returning id")).rows[0].id;
    await c.query("insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'staff')", [restaurantId, userId]);
    const zone = (await c.query("insert into public.zones (restaurant_id, name) values ($1, 'Sala') returning id", [restaurantId])).rows[0].id;
    for (const [name, max] of [['T1', 2], ['T2', 4]] as const) {
      tables[name] = (
        await c.query('insert into public.tables (restaurant_id, zone_id, name, max_capacity, position) values ($1, $2, $3, $4, $5) returning id', [
          restaurantId,
          zone,
          name,
          max,
          max,
        ])
      ).rows[0].id;
    }
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await pool.query('delete from public.restaurants where id = $1', [restaurantId]);
  await pool.query('delete from auth.users where id = $1', [userId]);
  await pool.end();
});

/** Una conexión con su transacción abierta, como el usuario de Sala. */
async function session(): Promise<pg.PoolClient> {
  const c = await pool.connect();
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  await c.query('set local role authenticated');
  return c;
}

async function close(...clients: pg.PoolClient[]) {
  for (const c of clients) {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

/** La segunda llamada se queda esperando al advisory lock de la primera; la resolvemos cuando la primera confirma. */
async function race(startsAt: string, tableIds: string[] | null, phones: [string, string]) {
  const one = await session();
  const two = await session();
  try {
    const first = (await one.query(CREATE, [restaurantId, startsAt, 2, tableIds, 'Primera', phones[0]])).rows[0].r;
    let settled = false;
    const second = two
      .query(CREATE, [restaurantId, startsAt, 2, tableIds, 'Segunda', phones[1]])
      .then(
        (res) => ({ ok: true as const, r: res.rows[0].r as { table_ids: string[] } }),
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
    return { first: first as { table_ids: string[] }, second: result, waited };
  } finally {
    await close(one, two);
  }
}

it('dos altas a la vez en la misma mesa: la segunda espera al bloqueo y da SLOT_TAKEN', async () => {
  const { first, second, waited } = await race('2030-06-14T19:00:00Z', [tables.T1], ['+34600000001', '+34600000002']);
  expect(first.table_ids).toEqual([tables.T1]);
  expect(waited).toBe(true);
  expect(second).toEqual({ ok: false, message: 'SLOT_TAKEN' });
  const { rows } = await pool.query("select count(*)::int as n from public.reservations where restaurant_id = $1 and starts_at = '2030-06-14T19:00:00Z'", [restaurantId]);
  expect(rows[0].n).toBe(1);
});

it('con mesa propuesta, la segunda alta espera y se lleva la siguiente mesa libre', async () => {
  const { first, second, waited } = await race('2030-06-15T19:00:00Z', null, ['+34600000003', '+34600000004']);
  expect(waited).toBe(true);
  expect(first.table_ids).toEqual([tables.T1]);
  expect(second).toEqual({ ok: true, r: expect.objectContaining({ table_ids: [tables.T2] }) });
});
```

- [ ] **Step 3: Comprobar que fallan**

Run: `pnpm vitest run --project db tests/db/reservations-functions.test.ts tests/db/reservations-concurrency.test.ts`
Expected: FAIL con `function public.create_panel_reservation(...) does not exist` (y similares).

- [ ] **Step 4: La migración de funciones**

Create `supabase/migrations/20261127000200_reservas_funciones.sql`:

```sql
-- Mesa · Hito 4A · funciones de reservas del panel: leer el día, crear (teléfono y walk-in), modificar y cambiar
-- de estado. Las que escriben son SECURITY DEFINER (las tablas no tienen INSERT ni UPDATE para nadie): comprueban
-- el rol con has_role, buscan todo por restaurant_id y toman un advisory lock por restaurante y fecha local.

/** Duración por defecto para un grupo: la del tramo que contiene party_size; si ninguno, la de por defecto (90). */
create or replace function public.reservation_duration(p_restaurant_id uuid, p_party integer) returns integer
language sql stable set search_path = '' as $$
  select coalesce(
    (select (e.v ->> 'duration_min')::integer
       from public.booking_settings s, jsonb_array_elements(s.duration_rules) e(v)
      where s.restaurant_id = p_restaurant_id
        and p_party between (e.v ->> 'min_party')::integer and (e.v ->> 'max_party')::integer
      limit 1),
    (select s.default_duration_min::integer from public.booking_settings s where s.restaurant_id = p_restaurant_id),
    90)
$$;

/** Cambios de estado permitidos (igual que src/lib/reservations/transitions.ts). */
create or replace function public.reservation_transition_ok(p_from public.reservation_status, p_to public.reservation_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'pending' then p_to in ('confirmed', 'rejected', 'cancelled_customer', 'cancelled_restaurant')
    when 'confirmed' then p_to in ('seated', 'no_show', 'cancelled_customer', 'cancelled_restaurant')
    when 'seated' then p_to = 'completed'
    else false
  end
$$;

/**
 * Bloqueo por restaurante y fecha local (zona del restaurante) de cada día que tocan los rangos, en orden de fecha
 * para que dos llamadas no se esperen la una a la otra. Se suelta al acabar la transacción.
 */
create or replace function public.lock_reservation_days(p_restaurant_id uuid, p_ranges tstzrange[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text;
  v_day date;
begin
  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  for v_day in
    select distinct d::date as day
      from unnest(p_ranges) x(r),
           generate_series((lower(x.r) at time zone v_tz)::date,
                           ((upper(x.r) - interval '1 microsecond') at time zone v_tz)::date,
                           interval '1 day') d
     order by day
  loop
    perform pg_advisory_xact_lock(hashtextextended('reservations/' || p_restaurant_id::text || '/' || v_day::text, 0));
  end loop;
end $$;

/** La mesa activa más pequeña que sirve (mín ≤ personas ≤ máx) libre y sin bloquear; desempate por posición. */
create or replace function public.pick_reservation_table(
  p_restaurant_id uuid, p_party integer, p_starts timestamptz, p_ends timestamptz, p_ignore uuid
) returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
    from public.tables t
    join public.zones z on z.id = t.zone_id and z.restaurant_id = t.restaurant_id
   where t.restaurant_id = p_restaurant_id and t.active
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
 * Mesas definitivas de una reserva. p_force: ninguna (forzar = sin mesa). Sin mesas elegidas: la propuesta
 * (NO_TABLE_AVAILABLE si no hay). Con mesas elegidas: del restaurante, activas (salvo las que ya tenía, p_keep),
 * con sitio para todos entre todas, sin bloqueos y libres.
 */
create or replace function public.resolve_reservation_tables(
  p_restaurant_id uuid, p_party integer, p_starts timestamptz, p_ends timestamptz,
  p_table_ids uuid[], p_force boolean, p_ignore uuid, p_keep uuid[]
) returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_count integer;
  v_capacity integer;
  v_inactive boolean;
begin
  if coalesce(p_force, false) then
    return '{}';
  end if;
  if p_table_ids is null or cardinality(p_table_ids) = 0 then
    v_id := public.pick_reservation_table(p_restaurant_id, p_party, p_starts, p_ends, p_ignore);
    if v_id is null then
      raise exception 'NO_TABLE_AVAILABLE' using errcode = 'P0001';
    end if;
    return array[v_id];
  end if;
  v_ids := array(select distinct x from unnest(p_table_ids) x where x is not null order by x);
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 10 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(t.max_capacity), 0),
         coalesce(bool_or(not t.active and not (t.id = any (coalesce(p_keep, '{}')))), false)
    into v_count, v_capacity, v_inactive
    from public.tables t
   where t.id = any (v_ids) and t.restaurant_id = p_restaurant_id;
  if v_count <> cardinality(v_ids) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_inactive then
    raise exception 'TABLE_INACTIVE' using errcode = 'P0001';
  end if;
  if v_capacity < p_party then
    raise exception 'TABLE_TOO_SMALL' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.blocks b
     where b.restaurant_id = p_restaurant_id and (b.table_id = any (v_ids) or b.table_id is null)
       and b.starts_at < p_ends and b.ends_at > p_starts
  ) then
    raise exception 'TABLE_BLOCKED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservation_tables rt
     where rt.table_id = any (v_ids) and rt.restaurant_id = p_restaurant_id and rt.active
       and rt.reservation_id is distinct from p_ignore and rt.starts_at < p_ends and rt.ends_at > p_starts
  ) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;
  return v_ids;
end $$;

/**
 * Busca el cliente por teléfono (E.164) y, si no, por email; si existe, actualiza el nombre y completa los datos
 * de contacto que le falten; si no, lo crea. Sin ningún dato (walk-in anónimo), null.
 */
create or replace function public.upsert_customer(p_restaurant_id uuid, p_name text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := lower(nullif(btrim(p_email), ''));
  v_id uuid;
begin
  for attempt in 1..2 loop
    v_id := null;
    if v_phone is not null then
      select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.phone = v_phone;
    end if;
    if v_id is null and v_email is not null then
      select c.id into v_id from public.customers c where c.restaurant_id = p_restaurant_id and c.email = v_email;
    end if;
    if v_id is not null then
      update public.customers c
         set name = coalesce(v_name, c.name),
             phone = coalesce(c.phone, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.phone = v_phone) then v_phone end),
             email = coalesce(c.email, case when not exists (
               select 1 from public.customers o where o.restaurant_id = p_restaurant_id and o.email = v_email) then v_email end)
       where c.id = v_id and c.restaurant_id = p_restaurant_id and c.anonymized_at is null;
      return v_id;
    end if;
    if v_name is null then
      return null;
    end if;
    -- Si otra reserva crea el mismo cliente a la vez, no se inserta y se vuelve a buscar.
    insert into public.customers (restaurant_id, name, phone, email)
    values (p_restaurant_id, v_name, v_phone, v_email)
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  raise exception 'INVALID_INPUT' using errcode = '22023';
end $$;

/**
 * Reserva del panel (por teléfono): nace confirmada. Mesas: p_force → sin mesa; sin p_table_ids → la propuesta;
 * con p_table_ids → esas. p_duration_min null → la del tramo. Devuelve {"id": …, "table_ids": […]}.
 */
create or replace function public.create_panel_reservation(
  p_restaurant_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer,
  p_table_ids uuid[], p_force boolean,
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_notes text, p_internal_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_duration integer;
  v_ends timestamptz;
  v_tables uuid[];
  v_customer uuid;
  v_id uuid;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_starts_at is null or p_party_size is null or p_party_size not between 1 and 50
     or (p_duration_min is not null and (p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0))
     or nullif(btrim(p_customer_name), '') is null
     or (nullif(btrim(p_customer_phone), '') is null and nullif(btrim(p_customer_email), '') is null) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_duration := coalesce(p_duration_min, public.reservation_duration(p_restaurant_id, p_party_size));
  v_ends := p_starts_at + make_interval(mins => v_duration);
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(p_starts_at, v_ends)]);
  v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, p_starts_at, v_ends, p_table_ids, p_force, null, null);
  v_customer := public.upsert_customer(p_restaurant_id, p_customer_name, p_customer_phone, p_customer_email);
  begin
    insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source,
                                     notes, internal_notes, created_by)
    values (p_restaurant_id, v_customer, p_party_size, p_starts_at, v_ends, 'confirmed', 'phone',
            nullif(btrim(p_notes), ''), nullif(btrim(p_internal_notes), ''), auth.uid())
    returning id into v_id;
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select v_id, t, p_restaurant_id from unnest(v_tables) t;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id, 'table_ids', to_jsonb(v_tables));
end $$;

/** Walk-in: se sienta ya (hora actual), en una o varias mesas libres; el nombre es opcional. */
create or replace function public.create_walk_in(
  p_restaurant_id uuid, p_party_size integer, p_table_ids uuid[], p_duration_min integer, p_customer_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_starts timestamptz := date_trunc('minute', now());
  v_ends timestamptz;
  v_tables uuid[];
  v_customer uuid;
  v_id uuid;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_party_size is null or p_party_size not between 1 and 50 or p_table_ids is null or cardinality(p_table_ids) = 0
     or (p_duration_min is not null and (p_duration_min not between 15 and 720 or p_duration_min % 15 <> 0)) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_ends := v_starts + make_interval(mins => coalesce(p_duration_min, public.reservation_duration(p_restaurant_id, p_party_size)));
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(v_starts, v_ends)]);
  v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, v_starts, v_ends, p_table_ids, false, null, null);
  v_customer := public.upsert_customer(p_restaurant_id, p_customer_name, null, null);
  begin
    insert into public.reservations (restaurant_id, customer_id, party_size, starts_at, ends_at, status, source, created_by)
    values (p_restaurant_id, v_customer, p_party_size, v_starts, v_ends, 'seated', 'walk_in', auth.uid())
    returning id into v_id;
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select v_id, t, p_restaurant_id from unnest(v_tables) t;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id, 'table_ids', to_jsonb(v_tables));
end $$;

/**
 * Cambia hora, personas, duración, mesas y notas de una reserva activa. Si cambian la hora o las mesas, se vuelve a
 * comprobar el hueco (sin contar la propia reserva). Mesas: igual que al crear (p_table_ids = las que quieras dejar).
 */
create or replace function public.update_panel_reservation(
  p_restaurant_id uuid, p_reservation_id uuid, p_starts_at timestamptz, p_duration_min integer, p_party_size integer,
  p_table_ids uuid[], p_force boolean, p_notes text, p_internal_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations%rowtype;
  v_ends timestamptz;
  v_current uuid[];
  v_tables uuid[];
begin
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
  else
    v_tables := public.resolve_reservation_tables(p_restaurant_id, p_party_size, p_starts_at, v_ends, p_table_ids, p_force,
                                                  r.id, v_current);
  end if;
  begin
    update public.reservations
       set starts_at = p_starts_at, ends_at = v_ends, party_size = p_party_size,
           notes = nullif(btrim(p_notes), ''), internal_notes = nullif(btrim(p_internal_notes), '')
     where id = r.id;
    delete from public.reservation_tables rt where rt.reservation_id = r.id and not (rt.table_id = any (v_tables));
    insert into public.reservation_tables (reservation_id, table_id, restaurant_id)
    select r.id, t, p_restaurant_id from unnest(v_tables) t
     where not (t = any (v_current));
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', r.id, 'table_ids', to_jsonb(v_tables));
end $$;

/** Cambia el estado si la transición está permitida; guarda el anterior para poder deshacerlo. */
create or replace function public.set_reservation_status(
  p_restaurant_id uuid, p_reservation_id uuid, p_status public.reservation_status
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status public.reservation_status;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select x.status into v_status from public.reservations x
   where x.id = p_reservation_id and x.restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status is null or not public.reservation_transition_ok(v_status, p_status) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update public.reservations
     set status = p_status, previous_status = v_status, status_changed_at = now()
   where id = p_reservation_id;
end $$;

/**
 * Deshace el último cambio a no_show, cancelled_*, rejected o completed: vuelve al estado anterior (pending,
 * confirmed o seated) si sus mesas siguen libres y sin bloquear. Devuelve el estado recuperado.
 */
create or replace function public.undo_reservation_status(p_restaurant_id uuid, p_reservation_id uuid)
returns public.reservation_status language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations%rowtype;
begin
  if not public.has_role(p_restaurant_id, '{admin,manager,staff}') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.reservations x where x.id = p_reservation_id and x.restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if r.status not in ('no_show', 'cancelled_customer', 'cancelled_restaurant', 'rejected', 'completed')
     or r.previous_status is null or r.previous_status not in ('pending', 'confirmed', 'seated') then
    raise exception 'NOTHING_TO_UNDO' using errcode = 'P0001';
  end if;
  perform public.lock_reservation_days(p_restaurant_id, array[tstzrange(r.starts_at, r.ends_at)]);
  if exists (
    select 1 from public.reservation_tables mine
      join public.reservation_tables other
        on other.table_id = mine.table_id and other.restaurant_id = mine.restaurant_id and other.active
       and other.reservation_id <> r.id and other.starts_at < r.ends_at and other.ends_at > r.starts_at
     where mine.reservation_id = r.id and mine.restaurant_id = p_restaurant_id
  ) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservation_tables mine
      join public.blocks b on b.restaurant_id = mine.restaurant_id and (b.table_id = mine.table_id or b.table_id is null)
       and b.starts_at < r.ends_at and b.ends_at > r.starts_at
     where mine.reservation_id = r.id and mine.restaurant_id = p_restaurant_id
  ) then
    raise exception 'TABLE_BLOCKED' using errcode = 'P0001';
  end if;
  begin
    update public.reservations
       set status = r.previous_status, previous_status = null, status_changed_at = now()
     where id = r.id;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end;
  return r.previous_status;
end $$;

/**
 * Para el panel (RLS del usuario): las reservas que empiezan en [p_from, p_to) con su cliente y sus mesas, y lo que
 * ocupa mesas (reservas activas y bloqueos) en [p_from, p_to + 12 h), que es lo que necesita el cálculo de huecos.
 */
create or replace function public.get_booking_day(p_restaurant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_until timestamptz := p_to + interval '12 hours';
begin
  if not (public.is_member(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '3 days' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'party_size', r.party_size,
               'status', r.status, 'previous_status', r.previous_status, 'source', r.source,
               'notes', r.notes, 'internal_notes', r.internal_notes, 'created_at', r.created_at,
               'table_ids', coalesce((
                 select jsonb_agg(rt.table_id order by rt.table_id)
                   from public.reservation_tables rt where rt.reservation_id = r.id
               ), '[]'::jsonb),
               'customer', case when c.id is null then null else jsonb_build_object(
                 'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'tags', to_jsonb(c.tags),
                 'visits_count', c.visits_count, 'no_show_count', c.no_show_count, 'cancel_count', c.cancel_count
               ) end
             ) order by r.starts_at, r.created_at, r.id)
        from public.reservations r
        left join public.customers c on c.id = r.customer_id and c.restaurant_id = r.restaurant_id
       where r.restaurant_id = p_restaurant_id and r.starts_at >= p_from and r.starts_at < p_to
    ), '[]'::jsonb),
    'occupancy', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reservation_id', rt.reservation_id, 'table_id', rt.table_id, 'starts_at', rt.starts_at, 'ends_at', rt.ends_at
             ) order by rt.starts_at, rt.table_id)
        from public.reservation_tables rt
       where rt.restaurant_id = p_restaurant_id and rt.active and rt.starts_at < v_until and rt.ends_at > p_from
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'table_id', b.table_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason
             ) order by b.starts_at, b.id)
        from public.blocks b
       where b.restaurant_id = p_restaurant_id and b.starts_at < v_until and b.ends_at > p_from
    ), '[]'::jsonb)
  );
end $$;

-- Privilegios: las auxiliares, para nadie; las del panel, solo usuarios autenticados.
revoke execute on function public.reservation_duration(uuid, integer),
  public.reservation_transition_ok(public.reservation_status, public.reservation_status),
  public.lock_reservation_days(uuid, tstzrange[]),
  public.pick_reservation_table(uuid, integer, timestamptz, timestamptz, uuid),
  public.resolve_reservation_tables(uuid, integer, timestamptz, timestamptz, uuid[], boolean, uuid, uuid[]),
  public.upsert_customer(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function
  public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text),
  public.create_walk_in(uuid, integer, uuid[], integer, text),
  public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text),
  public.set_reservation_status(uuid, uuid, public.reservation_status),
  public.undo_reservation_status(uuid, uuid),
  public.get_booking_day(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function
  public.create_panel_reservation(uuid, timestamptz, integer, integer, uuid[], boolean, text, text, text, text, text),
  public.create_walk_in(uuid, integer, uuid[], integer, text),
  public.update_panel_reservation(uuid, uuid, timestamptz, integer, integer, uuid[], boolean, text, text),
  public.set_reservation_status(uuid, uuid, public.reservation_status),
  public.undo_reservation_status(uuid, uuid),
  public.get_booking_day(uuid, timestamptz, timestamptz)
  to authenticated;
```

- [ ] **Step 5: Comprobar que pasan**

Run: `pnpm test:db`
Expected: **178** pruebas en verde (12 archivos). En la de concurrencia, la segunda alta se queda esperando al bloqueo (`waited = true`) y da exactamente `SLOT_TAKEN`; con mesa propuesta, se lleva la otra mesa.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261127000200_reservas_funciones.sql tests/db/reservations-functions.test.ts tests/db/reservations-concurrency.test.ts
git commit -m "Reservas (SQL): alta por teléfono y walk-in con bloqueo por día, cambios, estados, deshacer y lectura del día"
```

---

### Task 3: Dependencia de teléfonos; códigos, cambios de estado y teléfonos

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/lib/reservations/codes.ts`, `src/lib/reservations/transitions.ts`, `src/lib/reservations/phone.ts`
- Test: `src/lib/reservations/transitions.test.ts`, `src/lib/reservations/phone.test.ts`

**Interfaces:**
- Produces:
  - `codes.ts`: `RESERVATION_STATUSES`, `type ReservationStatus`, `RESERVATION_SOURCES`, `type ReservationSource`, `ACTIVE_STATUSES`, `COUNTED_STATUSES`, `STATUS_LABELS_ES`, `STATUS_STYLES`, `SOURCE_LABELS_ES`, `CUSTOMER_TAGS`, `type CustomerTag`, `CUSTOMER_TAG_LABELS_ES`, `BOOKING_LIMITS { zones: 20, tables: 100, durationRules: 6, partySize: 50, tablesPerReservation: 10, notes: 500, blockReason: 140 }`, `isReservationStatus(v): v is ReservationStatus`, `isActiveStatus(s): boolean`.
  - `transitions.ts`: `type StatusAction = { to: ReservationStatus; label: string; tone: 'primary' | 'secondary' | 'danger' }`, `nextActions(status): StatusAction[]`, `canTransition(from, to): boolean`, `UNDOABLE_STATUSES`, `canUndo(status, previous: ReservationStatus | null): boolean`, `undoLabel(status): string`.
  - `phone.ts`: `normalizePhoneE164(input: string): string | null`, `formatPhoneDisplay(e164: string): string`.

- [ ] **Step 1: Instalar `libphonenumber-js`**

Run: `pnpm add libphonenumber-js@1.13.16 --save-exact`
Expected: `package.json` lleva `"libphonenumber-js": "1.13.16"` (sin `^`) en `dependencies`. (Es del 10/11/2026: tiene más de dos semanas.)

- [ ] **Step 2: Pruebas (fallan)**

Create `src/lib/reservations/transitions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from './codes';
import { canTransition, canUndo, nextActions, undoLabel } from './transitions';

describe('cambios de estado', () => {
  it('pendiente → confirmar, rechazar o cancelar', () => {
    expect(nextActions('pending').map((a) => a.to)).toEqual(['confirmed', 'rejected', 'cancelled_customer', 'cancelled_restaurant']);
  });

  it('confirmada → sentar, no ha venido o cancelar; en mesa → finalizar', () => {
    expect(nextActions('confirmed').map((a) => a.label)).toEqual(['Sentar', 'No ha venido', 'Cancela el cliente', 'Cancelamos nosotros']);
    expect(nextActions('seated').map((a) => a.to)).toEqual(['completed']);
  });

  it('los estados finales no tienen botones', () => {
    for (const s of ['completed', 'cancelled_customer', 'cancelled_restaurant', 'rejected', 'no_show'] as const) {
      expect(nextActions(s)).toEqual([]);
    }
  });

  it('canTransition coincide con la tabla de la BD', () => {
    const allowed = new Set([
      'pending>confirmed',
      'pending>rejected',
      'pending>cancelled_customer',
      'pending>cancelled_restaurant',
      'confirmed>seated',
      'confirmed>no_show',
      'confirmed>cancelled_customer',
      'confirmed>cancelled_restaurant',
      'seated>completed',
    ]);
    for (const from of RESERVATION_STATUSES) {
      for (const to of RESERVATION_STATUSES) expect(canTransition(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
    }
  });

  it('un estado desconocido (también los heredados, como toString) no tiene botones', () => {
    expect(nextActions('toString' as 'pending')).toEqual([]);
  });
});

describe('deshacer', () => {
  it('se deshace un no-show, una cancelación, un rechazo o un finalizar, si hay estado anterior activo', () => {
    expect(canUndo('no_show', 'confirmed')).toBe(true);
    expect(canUndo('completed', 'seated')).toBe(true);
    expect(canUndo('rejected', 'pending')).toBe(true);
    expect(canUndo('cancelled_restaurant', null)).toBe(false);
    expect(canUndo('seated', 'confirmed')).toBe(false);
    expect(canUndo('no_show', 'completed')).toBe(false);
  });

  it('el botón dice qué deshace', () => {
    expect(undoLabel('no_show')).toBe('Deshacer «No vino»');
  });
});
```

Create `src/lib/reservations/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay, normalizePhoneE164 } from './phone';

describe('normalizePhoneE164', () => {
  it.each([
    ['612 34 56 78', '+34612345678'],
    ['612-345-678', '+34612345678'],
    ['(91) 000 00 00', '+34910000000'],
    ['+34 612345678', '+34612345678'],
    ['0034 612 345 678', '+34612345678'],
    ['922 123 456', '+34922123456'],
    ['+44 20 7946 0958', '+442079460958'],
    ['0033 6 12 34 56 78', '+33612345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhoneE164(input)).toBe(expected);
  });

  it.each(['', '12', '12345', 'abc', '612 34 56 7x', '+34 12', '6123456789012345678901'])('%s no vale', (input) => {
    expect(normalizePhoneE164(input)).toBeNull();
  });
});

describe('formatPhoneDisplay', () => {
  it('los españoles sin prefijo; los extranjeros, con él', () => {
    expect(formatPhoneDisplay('+34612345678')).toBe('612 34 56 78');
    expect(formatPhoneDisplay('+442079460958')).toBe('+44 20 7946 0958');
  });

  it('si no se entiende, tal cual', () => {
    expect(formatPhoneDisplay('raro')).toBe('raro');
  });
});
```

- [ ] **Step 3: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations`
Expected: FAIL: `Failed to resolve import "./codes"` / `"./transitions"` / `"./phone"`.

- [ ] **Step 4: Implementación**

Create `src/lib/reservations/codes.ts`:

```ts
/** Estados de una reserva (igual que el tipo public.reservation_status). */
export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled_customer',
  'cancelled_restaurant',
  'rejected',
  'no_show',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_SOURCES = ['online', 'phone', 'walk_in'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

/** Ocupan mesa (igual que la restricción de exclusión de reservation_tables). */
export const ACTIVE_STATUSES: readonly ReservationStatus[] = ['pending', 'confirmed', 'seated'];
/** Cuentan en el resumen del día (reservas y personas). */
export const COUNTED_STATUSES: readonly ReservationStatus[] = ['pending', 'confirmed', 'seated', 'completed'];

export const STATUS_LABELS_ES: Record<ReservationStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  seated: 'En mesa',
  completed: 'Finalizada',
  cancelled_customer: 'Cancelada por el cliente',
  cancelled_restaurant: 'Cancelada por el restaurante',
  rejected: 'Rechazada',
  no_show: 'No vino',
};

/** Color y texto: el estado nunca se distingue solo por el color. */
export const STATUS_STYLES: Record<ReservationStatus, string> = {
  pending: 'border-orange-dark bg-peach-soft text-ink',
  confirmed: 'border-navy bg-on-navy-soft text-navy-dark',
  seated: 'border-ink bg-ink text-white',
  completed: 'border-ink/30 bg-white text-muted',
  cancelled_customer: 'border-red-700 bg-white text-red-800 line-through decoration-1',
  cancelled_restaurant: 'border-red-700 bg-white text-red-800 line-through decoration-1',
  rejected: 'border-red-700 bg-white text-red-800 line-through decoration-1',
  no_show: 'border-red-700 bg-red-50 text-red-800',
};

export const SOURCE_LABELS_ES: Record<ReservationSource, string> = {
  online: 'Web',
  phone: 'Teléfono',
  walk_in: 'Sin reserva',
};

export const CUSTOMER_TAGS = ['vip', 'regular', 'problem'] as const;
export type CustomerTag = (typeof CUSTOMER_TAGS)[number];
export const CUSTOMER_TAG_LABELS_ES: Record<CustomerTag, string> = {
  vip: 'VIP',
  regular: 'Habitual',
  problem: 'Problemático',
};

export const BOOKING_LIMITS = {
  zones: 20,
  tables: 100,
  durationRules: 6,
  partySize: 50,
  tablesPerReservation: 10,
  notes: 500,
  blockReason: 140,
} as const;

export function isReservationStatus(value: unknown): value is ReservationStatus {
  return typeof value === 'string' && Object.hasOwn(STATUS_LABELS_ES, value);
}

export function isActiveStatus(status: ReservationStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
```

Create `src/lib/reservations/transitions.ts`:

```ts
import { STATUS_LABELS_ES, type ReservationStatus } from './codes';

export type StatusAction = { to: ReservationStatus; label: string; tone: 'primary' | 'secondary' | 'danger' };

const CANCELS: StatusAction[] = [
  { to: 'cancelled_customer', label: 'Cancela el cliente', tone: 'danger' },
  { to: 'cancelled_restaurant', label: 'Cancelamos nosotros', tone: 'danger' },
];

/** Cambios permitidos desde cada estado (igual que public.reservation_transition_ok), en el orden de los botones. */
const TRANSITIONS: Record<ReservationStatus, StatusAction[]> = {
  pending: [{ to: 'confirmed', label: 'Confirmar', tone: 'primary' }, { to: 'rejected', label: 'Rechazar', tone: 'danger' }, ...CANCELS],
  confirmed: [{ to: 'seated', label: 'Sentar', tone: 'primary' }, { to: 'no_show', label: 'No ha venido', tone: 'secondary' }, ...CANCELS],
  seated: [{ to: 'completed', label: 'Finalizar', tone: 'primary' }],
  completed: [],
  cancelled_customer: [],
  cancelled_restaurant: [],
  rejected: [],
  no_show: [],
};

/** Estados desde los que se puede deshacer el último cambio (vuelve al estado anterior). */
export const UNDOABLE_STATUSES: readonly ReservationStatus[] = [
  'no_show',
  'cancelled_customer',
  'cancelled_restaurant',
  'rejected',
  'completed',
];
const UNDO_TARGETS: readonly ReservationStatus[] = ['pending', 'confirmed', 'seated'];

export function nextActions(status: ReservationStatus): StatusAction[] {
  return Object.hasOwn(TRANSITIONS, status) ? TRANSITIONS[status] : [];
}

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return nextActions(from).some((a) => a.to === to);
}

export function canUndo(status: ReservationStatus, previous: ReservationStatus | null): boolean {
  return UNDOABLE_STATUSES.includes(status) && previous !== null && UNDO_TARGETS.includes(previous);
}

/** 'Deshacer «No vino»'. */
export function undoLabel(status: ReservationStatus): string {
  return `Deshacer «${STATUS_LABELS_ES[status]}»`;
}
```

Create `src/lib/reservations/phone.ts`:

```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Teléfono escrito a mano → E.164 (+34612345678). Sin prefijo se entiende de España; admite extranjeros con +
 * o 00. null si no es un número válido.
 */
export function normalizePhoneE164(input: string): string | null {
  const value = input.trim().replace(/^00/, '+');
  if (!/^\+?[\d\s().-]{6,25}$/.test(value)) return null;
  const phone = parsePhoneNumberFromString(value, 'ES');
  return phone?.isValid() ? phone.number : null;
}

/** '+34612345678' → '612 34 56 78'; extranjeros con su prefijo: '+44 20 7946 0958'. */
export function formatPhoneDisplay(e164: string): string {
  const phone = parsePhoneNumberFromString(e164);
  if (!phone) return e164;
  return phone.country === 'ES' ? phone.formatNational() : phone.formatInternational();
}
```

- [ ] **Step 5: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit`
Expected: 24 pruebas nuevas en verde; `test:unit` → **349** (49 archivos).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/reservations/codes.ts src/lib/reservations/transitions.ts src/lib/reservations/transitions.test.ts src/lib/reservations/phone.ts src/lib/reservations/phone.test.ts
git commit -m "Reservas: estados y sus cambios, deshacer y teléfonos en E.164 con libphonenumber-js"
```

---

### Task 4: Fechas en la zona del restaurante y duración por tamaño de grupo

**Files:**
- Create: `src/lib/reservations/time.ts`, `src/lib/reservations/settings.ts`
- Test: `src/lib/reservations/time.test.ts`, `src/lib/reservations/settings.test.ts`

**Interfaces:**
- Consumes: `formatDateEs`, `isWeekday`, `MINUTES_PER_DAY`, `WEEKDAY_LABELS_ES` de `@/lib/schedule`.
- Produces:
  - `time.ts`: `addDays(date, days): string`, `weekdayOf(date): number`, `zonedTimeToUtc(date, minute, timeZone): number` (ms; `minute` puede pasar de 1440), `localParts(ms, timeZone): { date; minute }`, `serviceDayMinute(ms, date, timeZone): number | null`, `formatTime(ms, timeZone): string`, `formatDayEs(date): string`, `serviceDayWindow(date, timeZone): { from: number; to: number }` (00:00 → 06:00 del día siguiente), `dateParam(value: string | string[] | undefined, fallback): string`.
  - `settings.ts`: `type DurationRule = { minParty; maxParty; durationMin }`, `type BookingSettings = { defaultDurationMin; durationRules; minAdvanceMin; maxAdvanceDays; maxOnlineParty; cancelLimitHours; autoConfirm }`, `DEFAULT_BOOKING_SETTINGS`, `DURATION_OPTIONS` (30…360 cada 15), `durationFor(partySize, settings): number`, `overlappingRules(rules): [number, number] | null`, `formatDuration(minutes): string`.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/reservations/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays, dateParam, formatDayEs, formatTime, localParts, serviceDayMinute, serviceDayWindow, weekdayOf, zonedTimeToUtc } from './time';

const iso = (ms: number) => new Date(ms).toISOString();

describe('fechas', () => {
  it('addDays cruza meses, años y años bisiestos', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('weekdayOf: 1 = lunes … 7 = domingo', () => {
    expect(weekdayOf('2026-11-23')).toBe(1);
    expect(weekdayOf('2026-11-29')).toBe(7);
  });

  it('formatDayEs', () => {
    expect(formatDayEs('2030-06-14')).toBe('Viernes 14/06/2030');
  });
});

describe('zonedTimeToUtc', () => {
  it('Madrid en invierno (+1) y en verano (+2); Canarias una hora menos', () => {
    expect(iso(zonedTimeToUtc('2026-11-27', 21 * 60, 'Europe/Madrid'))).toBe('2026-11-27T20:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-10', 21 * 60, 'Europe/Madrid'))).toBe('2026-07-10T19:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-10', 21 * 60, 'Atlantic/Canary'))).toBe('2026-07-10T20:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-11-27', 21 * 60, 'Atlantic/Canary'))).toBe('2026-11-27T21:00:00.000Z');
  });

  it('pasada la medianoche (minuto 1470) es del día siguiente', () => {
    expect(iso(zonedTimeToUtc('2026-12-31', 1470, 'Europe/Madrid'))).toBe('2026-12-31T23:30:00.000Z');
  });

  it('cambio de hora: la que no existe y la que existe dos veces, como PostgreSQL', () => {
    expect(iso(zonedTimeToUtc('2026-03-29', 150, 'Europe/Madrid'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-10-25', 150, 'Europe/Madrid'))).toBe('2026-10-25T01:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', 13 * 60, 'Europe/Madrid'))).toBe('2026-03-29T11:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', 13 * 60, 'Atlantic/Canary'))).toBe('2026-03-29T12:00:00.000Z');
  });
});

describe('hora local de un instante', () => {
  it('localParts y formatTime', () => {
    const ms = Date.parse('2026-07-10T19:15:00Z');
    expect(localParts(ms, 'Europe/Madrid')).toEqual({ date: '2026-07-10', minute: 21 * 60 + 15 });
    expect(formatTime(ms, 'Atlantic/Canary')).toBe('20:15');
  });

  it('serviceDayMinute: la madrugada sigue contando para el día anterior', () => {
    const late = Date.parse('2026-12-31T23:30:00Z');
    expect(serviceDayMinute(late, '2026-12-31', 'Europe/Madrid')).toBe(1470);
    expect(serviceDayMinute(late, '2027-01-01', 'Europe/Madrid')).toBe(30);
    expect(serviceDayMinute(late, '2026-12-29', 'Europe/Madrid')).toBeNull();
  });

  it('serviceDayWindow va de las 00:00 a las 06:00 del día siguiente, también el día del cambio de hora', () => {
    const w = serviceDayWindow('2026-10-25', 'Europe/Madrid');
    expect(iso(w.from)).toBe('2026-10-24T22:00:00.000Z');
    expect(iso(w.to)).toBe('2026-10-26T05:00:00.000Z');
  });
});

it('dateParam: solo fechas reales; si no, la de por defecto', () => {
  expect(dateParam('2030-06-14', '2026-11-27')).toBe('2030-06-14');
  for (const bad of ['2030-02-30', '14/06/2030', '', undefined, ['2030-06-14', '2030-06-15']]) {
    expect(dateParam(bad, '2026-11-27')).toBe('2026-11-27');
  }
});
```

Create `src/lib/reservations/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOKING_SETTINGS, DURATION_OPTIONS, durationFor, formatDuration, overlappingRules } from './settings';

const settings = {
  defaultDurationMin: 90,
  durationRules: [
    { minParty: 1, maxParty: 2, durationMin: 75 },
    { minParty: 7, maxParty: 50, durationMin: 150 },
  ],
};

describe('duración por tamaño de grupo', () => {
  it('la del tramo que contiene el grupo, con los extremos incluidos', () => {
    expect(durationFor(1, settings)).toBe(75);
    expect(durationFor(2, settings)).toBe(75);
    expect(durationFor(7, settings)).toBe(150);
    expect(durationFor(50, settings)).toBe(150);
  });

  it('si ningún tramo lo contiene, la de por defecto', () => {
    expect(durationFor(4, settings)).toBe(90);
    expect(durationFor(4, DEFAULT_BOOKING_SETTINGS)).toBe(90);
  });

  it('detecta tramos solapados', () => {
    expect(overlappingRules(settings.durationRules)).toBeNull();
    expect(overlappingRules([...settings.durationRules, { minParty: 2, maxParty: 4, durationMin: 90 }])).toEqual([0, 2]);
  });
});

it('opciones de duración de 30 min a 6 h y formato corto', () => {
  expect(DURATION_OPTIONS[0]).toBe(30);
  expect(DURATION_OPTIONS.at(-1)).toBe(360);
  expect(formatDuration(90)).toBe('1 h 30 min');
  expect(formatDuration(120)).toBe('2 h');
  expect(formatDuration(45)).toBe('45 min');
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations/time.test.ts src/lib/reservations/settings.test.ts`
Expected: FAIL: `Failed to resolve import "./time"` y `"./settings"`.

- [ ] **Step 3: Implementación**

Create `src/lib/reservations/time.ts`:

```ts
import { formatDateEs, isWeekday, MINUTES_PER_DAY, WEEKDAY_LABELS_ES } from '@/lib/schedule';

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** La hora de pared de un instante, como si fuera UTC (ms, sin segundos). */
function wallClock(ms: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
}

function offsetAt(ms: number, timeZone: string): number {
  return wallClock(ms, timeZone) - Math.floor(ms / MINUTE) * MINUTE;
}

/** '2026-03-28' + 1 → '2026-03-29'. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Día ISO de una fecha: 1 = lunes … 7 = domingo. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Fecha local + minuto (puede pasar de 1440: es del día siguiente) → instante (ms) en esa zona horaria.
 * Como PostgreSQL: una hora que no existe (al adelantar el reloj) usa la diferencia de antes del cambio, y una
 * que existe dos veces (al atrasarlo), la de la hora de invierno.
 */
export function zonedTimeToUtc(date: string, minute: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d) + minute * MINUTE;
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const valid = [...new Set([before, after])].filter((o) => wallClock(wall - o, timeZone) === wall);
  if (valid.length === 1) return wall - valid[0];
  if (valid.length > 1) return wall - Math.min(...valid);
  return wall - before;
}

/** Fecha local (AAAA-MM-DD) y minuto del día de un instante. */
export function localParts(ms: number, timeZone: string): { date: string; minute: number } {
  const wall = wallClock(ms, timeZone);
  return { date: new Date(wall).toISOString().slice(0, 10), minute: Math.floor((wall % DAY) / MINUTE) };
}

/**
 * Minuto de un instante contado desde el inicio de `date` (zona del restaurante): los de la madrugada del día
 * siguiente siguen contando (1470 = 00:30). null si es de otro día.
 */
export function serviceDayMinute(ms: number, date: string, timeZone: string): number | null {
  const p = localParts(ms, timeZone);
  if (p.date === date) return p.minute;
  if (p.date === addDays(date, 1)) return p.minute + MINUTES_PER_DAY;
  return null;
}

/** Instante → '21:30' en la zona del restaurante. */
export function formatTime(ms: number, timeZone: string): string {
  const { minute } = localParts(ms, timeZone);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** '2030-06-14' → 'Viernes 14/06/2030'. */
export function formatDayEs(date: string): string {
  const weekday = weekdayOf(date);
  return `${isWeekday(weekday) ? WEEKDAY_LABELS_ES[weekday] : ''} ${formatDateEs(date)}`.trim();
}

/** Desde las 00:00 de `date` hasta las 06:00 del día siguiente: ahí empiezan todas las reservas de sus servicios. */
export function serviceDayWindow(date: string, timeZone: string): { from: number; to: number } {
  return { from: zonedTimeToUtc(date, 0, timeZone), to: zonedTimeToUtc(date, 1800, timeZone) };
}

/** ?fecha= de la URL: una fecha real AAAA-MM-DD o, si no, la de por defecto (también si llega repetida). */
export function dateParam(value: string | string[] | undefined, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : fallback;
}
```

Create `src/lib/reservations/settings.ts`:

```ts
/** Tramo de duración por tamaño de grupo (de min a max personas, ambos incluidos). */
export type DurationRule = { minParty: number; maxParty: number; durationMin: number };

export type BookingSettings = {
  defaultDurationMin: number;
  durationRules: DurationRule[];
  minAdvanceMin: number;
  maxAdvanceDays: number;
  maxOnlineParty: number;
  cancelLimitHours: number;
  autoConfirm: boolean;
};

/** Si el restaurante aún no ha guardado sus ajustes (mismos valores por defecto que la tabla booking_settings). */
export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  defaultDurationMin: 90,
  durationRules: [],
  minAdvanceMin: 60,
  maxAdvanceDays: 60,
  maxOnlineParty: 8,
  cancelLimitHours: 2,
  autoConfirm: true,
};

/** Duraciones que se pueden elegir: de 30 min a 6 h, cada 15 min. */
export const DURATION_OPTIONS: readonly number[] = Array.from({ length: 23 }, (_, i) => 30 + i * 15);

/** La duración del tramo que contiene party_size; si ninguno, la de por defecto (igual que public.reservation_duration). */
export function durationFor(partySize: number, settings: Pick<BookingSettings, 'defaultDurationMin' | 'durationRules'>): number {
  const rule = settings.durationRules.find((r) => partySize >= r.minParty && partySize <= r.maxParty);
  return rule ? rule.durationMin : settings.defaultDurationMin;
}

/** Primer par de tramos que se solapan (índices), o null. */
export function overlappingRules(rules: readonly DurationRule[]): [number, number] | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[i].minParty <= rules[j].maxParty && rules[j].minParty <= rules[i].maxParty) return [i, j];
    }
  }
  return null;
}

/** 90 → '1 h 30 min'; 60 → '1 h'; 45 → '45 min'. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit`
Expected: 14 pruebas nuevas en verde (incluido el cambio de hora y Canarias); `test:unit` → **363** (51 archivos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/time.ts src/lib/reservations/time.test.ts src/lib/reservations/settings.ts src/lib/reservations/settings.test.ts
git commit -m "Reservas: horas del reloj del restaurante (cambio de hora y Canarias) y duración por tramos"
```

---

### Task 5: Servicios de un día y reparto de reservas por servicio

**Files:**
- Create: `src/lib/reservations/day.ts`
- Test: `src/lib/reservations/day.test.ts`

**Interfaces:**
- Consumes: `addDays`, `localParts`, `serviceDayMinute`, `weekdayOf`, `zonedTimeToUtc` (Task 4); `COUNTED_STATUSES`, `ReservationStatus` (Task 3); `MINUTES_PER_DAY` de `@/lib/schedule`.
- Produces: `type ServiceConfig = { id?; name; weekday; startMinute; endMinute; lastBookingMinute: number | null; slotIntervalMin }`, `type ExceptionConfig = { dateFrom; dateTo; kind: 'closed' | 'custom'; customServices: { name; startMinute; endMinute }[] }`, `type DayService = { key: string /* minuto de inicio */; name; startMinute; endMinute; lastBookingMinute: number; slotIntervalMin: number }`, `effectiveLastBooking(start, end, last | null): number`, `servicesForDate(date, services, exceptions): DayService[]`, `slotMinutes(s): number[]`, `serviceAt(minute, services): DayService | null`, `resolveMinute(minute, services): number`, `type ServiceGroup<T> = { service; items: T[] }`, `groupByService<T extends { startMs }>(items, date, timeZone, today, yesterday): { groups: ServiceGroup<T>[]; outside: T[] }`, `type DaySummary = { reservations; covers; pending }`, `summarize(items): DaySummary`, `serviceDateOf(startMs, timeZone, services, exceptions): string`.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/reservations/day.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  effectiveLastBooking,
  groupByService,
  resolveMinute,
  serviceAt,
  serviceDateOf,
  servicesForDate,
  slotMinutes,
  summarize,
  type ServiceConfig,
} from './day';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
// Viernes 2030-06-14: comida 13:00–16:00 (última 15:00 por defecto) y cena 20:30–00:30 con última 23:30 cada 30.
const services: ServiceConfig[] = [
  { name: 'Comida', weekday: 5, startMinute: 780, endMinute: 960, lastBookingMinute: null, slotIntervalMin: 15 },
  { name: 'Cena', weekday: 5, startMinute: 1230, endMinute: 1470, lastBookingMinute: 1410, slotIntervalMin: 30 },
  { name: 'Cena', weekday: 4, startMinute: 1260, endMinute: 1500, lastBookingMinute: null, slotIntervalMin: 15 },
];

describe('servicios de una fecha', () => {
  it('los de su día de la semana, en orden', () => {
    expect(servicesForDate('2030-06-14', services, []).map((s) => [s.name, s.startMinute, s.lastBookingMinute, s.slotIntervalMin])).toEqual([
      ['Comida', 780, 900, 15],
      ['Cena', 1230, 1410, 30],
    ]);
  });

  it('un cierre los quita y un horario especial los sustituye (con los valores por defecto)', () => {
    const closed = [{ dateFrom: '2030-06-10', dateTo: '2030-06-16', kind: 'closed' as const, customServices: [] }];
    expect(servicesForDate('2030-06-14', services, closed)).toEqual([]);
    const custom = [{ dateFrom: '2030-06-14', dateTo: '2030-06-14', kind: 'custom' as const, customServices: [{ name: 'Gala', startMinute: 1260, endMinute: 1560 }] }];
    expect(servicesForDate('2030-06-14', services, custom)).toEqual([
      { key: '1260', name: 'Gala', startMinute: 1260, endMinute: 1560, lastBookingMinute: 1500, slotIntervalMin: 15 },
    ]);
  });

  it('la última hora por defecto no baja del inicio', () => {
    expect(effectiveLastBooking(780, 810, null)).toBe(780);
    expect(effectiveLastBooking(780, 960, 930)).toBe(930);
  });

  it('horas candidatas del inicio a la última, cada intervalo', () => {
    const [comida, cena] = servicesForDate('2030-06-14', services, []);
    expect(slotMinutes(comida)).toHaveLength(9);
    expect(slotMinutes(cena)).toEqual([1230, 1260, 1290, 1320, 1350, 1380, 1410]);
  });
});

describe('hora escrita y servicio que la contiene', () => {
  const today = servicesForDate('2030-06-14', services, []);

  it('00:15 en un día con cena hasta las 00:30 es de esa noche; 03:00, no', () => {
    expect(resolveMinute(15, today)).toBe(1455);
    expect(resolveMinute(180, today)).toBe(180);
    expect(resolveMinute(1300, today)).toBe(1300);
  });

  it('serviceAt: inicio incluido, fin excluido', () => {
    expect(serviceAt(780, today)?.name).toBe('Comida');
    expect(serviceAt(960, today)).toBeNull();
  });
});

describe('reparto de reservas por servicio', () => {
  const at = (date: string, minute: number) => ({ id: `${date}@${minute}`, startMs: zonedTimeToUtc(date, minute, TZ) });
  const today = servicesForDate('2030-06-14', services, []);
  const yesterday = servicesForDate('2030-06-13', services, []);

  it('cada una en su servicio; las de fuera, aparte; la madrugada siguiente cuenta para la cena', () => {
    const items = [at('2030-06-14', 800), at('2030-06-14', 1320), at('2030-06-15', 10), at('2030-06-14', 1000), at('2030-06-15', 200)];
    const { groups, outside } = groupByService(items, '2030-06-14', TZ, today, yesterday);
    expect(groups.map((g) => [g.service.name, g.items.map((i) => i.id)])).toEqual([
      ['Comida', ['2030-06-14@800']],
      ['Cena', ['2030-06-14@1320', '2030-06-15@10']],
    ]);
    expect(outside.map((i) => i.id)).toEqual(['2030-06-14@1000']);
  });

  it('la madrugada que es de la cena de la víspera no sale en este día', () => {
    const { groups, outside } = groupByService([at('2030-06-14', 30)], '2030-06-14', TZ, today, yesterday);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
    expect(outside).toEqual([]);
  });

  it('un día cerrado: todo sale fuera de horario', () => {
    const { groups, outside } = groupByService([at('2030-06-14', 800)], '2030-06-14', TZ, [], yesterday);
    expect(groups).toEqual([]);
    expect(outside).toHaveLength(1);
  });
});

it('resumen: reservas y personas sin canceladas ni no-shows, y pendientes', () => {
  expect(
    summarize([
      { status: 'confirmed', partySize: 2 },
      { status: 'pending', partySize: 4 },
      { status: 'completed', partySize: 3 },
      { status: 'no_show', partySize: 6 },
      { status: 'cancelled_customer', partySize: 2 },
    ]),
  ).toEqual({ reservations: 3, covers: 9, pending: 1 });
});

it('serviceDateOf: la madrugada de la cena de la víspera es de la víspera', () => {
  expect(serviceDateOf(zonedTimeToUtc('2030-06-14', 30, TZ), TZ, services, [])).toBe('2030-06-13');
  expect(serviceDateOf(zonedTimeToUtc('2030-06-15', 10, TZ), TZ, services, [])).toBe('2030-06-14');
  expect(serviceDateOf(zonedTimeToUtc('2030-06-15', 200, TZ), TZ, services, [])).toBe('2030-06-15');
  expect(serviceDateOf(zonedTimeToUtc('2030-06-14', 800, TZ), TZ, services, [])).toBe('2030-06-14');
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations/day.test.ts`
Expected: FAIL: `Failed to resolve import "./day"`.

- [ ] **Step 3: Implementación**

Create `src/lib/reservations/day.ts`:

```ts
import { MINUTES_PER_DAY } from '@/lib/schedule';
import { COUNTED_STATUSES, type ReservationStatus } from './codes';
import { addDays, localParts, serviceDayMinute, weekdayOf } from './time';

/** Servicio de la semana tal como se guarda (Hito 2 + los dos campos del Hito 4A). */
export type ServiceConfig = {
  id?: string;
  name: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  lastBookingMinute: number | null;
  slotIntervalMin: number;
};

export type ExceptionConfig = {
  dateFrom: string;
  dateTo: string;
  kind: 'closed' | 'custom';
  customServices: { name: string; startMinute: number; endMinute: number }[];
};

/** Un servicio de un día concreto, con la última hora de reserva ya resuelta. key: su minuto de inicio. */
export type DayService = {
  key: string;
  name: string;
  startMinute: number;
  endMinute: number;
  lastBookingMinute: number;
  slotIntervalMin: number;
};

/** Última hora de reserva: la guardada o, si falta, una hora antes del cierre (sin bajar del inicio). */
export function effectiveLastBooking(startMinute: number, endMinute: number, lastBookingMinute: number | null): number {
  return lastBookingMinute ?? Math.max(startMinute, endMinute - 60);
}

function daySlot(name: string, startMinute: number, endMinute: number, last: number | null, interval: number): DayService {
  return {
    key: String(startMinute),
    name,
    startMinute,
    endMinute,
    lastBookingMinute: effectiveLastBooking(startMinute, endMinute, last),
    slotIntervalMin: interval === 30 ? 30 : 15,
  };
}

/** Servicios de una fecha: los de su día de la semana, salvo cierre (ninguno) u horario especial (los suyos). */
export function servicesForDate(date: string, services: readonly ServiceConfig[], exceptions: readonly ExceptionConfig[]): DayService[] {
  const exception = exceptions.find((e) => e.dateFrom <= date && date <= e.dateTo);
  const list = exception
    ? exception.customServices.map((s) => daySlot(s.name, s.startMinute, s.endMinute, null, 15))
    : services
        .filter((s) => s.weekday === weekdayOf(date))
        .map((s) => daySlot(s.name, s.startMinute, s.endMinute, s.lastBookingMinute, s.slotIntervalMin));
  return exception?.kind === 'closed' ? [] : list.sort((a, b) => a.startMinute - b.startMinute);
}

/** Horas en que se puede reservar: del inicio a la última hora de reserva, cada intervalo. */
export function slotMinutes(s: DayService): number[] {
  const out: number[] = [];
  for (let m = s.startMinute; m <= s.lastBookingMinute; m += s.slotIntervalMin) out.push(m);
  return out;
}

/** El servicio cuya franja contiene ese minuto del día (inicio incluido, fin excluido). */
export function serviceAt(minute: number, services: readonly DayService[]): DayService | null {
  return services.find((s) => minute >= s.startMinute && minute < s.endMinute) ?? null;
}

/**
 * Hora escrita a mano (0–1439) → minuto del día de servicio: una hora de madrugada que cae dentro de un servicio de
 * ese día que pasa de medianoche es de la noche (00:30 → 1470); si no, se queda como está.
 */
export function resolveMinute(minute: number, services: readonly DayService[]): number {
  const late = minute + MINUTES_PER_DAY;
  return services.some((s) => s.endMinute > MINUTES_PER_DAY && late >= s.startMinute && late < s.endMinute) ? late : minute;
}

export type ServiceGroup<T> = { service: DayService; items: T[] };

/**
 * Reparte las reservas de un día de servicio: cada una, en el servicio cuya franja contiene su hora de inicio; las de
 * la madrugada que son de la cena de la víspera no cuentan para este día; las que no caen en ningún servicio, a
 * «Fuera de horario». `items` puede traer de más (la ventana de 00:00 a 06:00 del día siguiente).
 */
export function groupByService<T extends { startMs: number }>(
  items: readonly T[],
  date: string,
  timeZone: string,
  today: readonly DayService[],
  yesterday: readonly DayService[],
): { groups: ServiceGroup<T>[]; outside: T[] } {
  const groups = today.map((service) => ({ service, items: [] as T[] }));
  const outside: T[] = [];
  for (const item of items) {
    const minute = serviceDayMinute(item.startMs, date, timeZone);
    if (minute === null) continue;
    if (minute < MINUTES_PER_DAY && serviceAt(minute + MINUTES_PER_DAY, yesterday)) continue;
    const service = serviceAt(minute, today);
    if (service) groups.find((g) => g.service.key === service.key)?.items.push(item);
    else if (minute < MINUTES_PER_DAY) outside.push(item);
  }
  return { groups, outside };
}

export type DaySummary = { reservations: number; covers: number; pending: number };

/** Resumen de un servicio: reservas y personas (sin canceladas, rechazadas ni no-shows) y pendientes. */
export function summarize(items: readonly { status: ReservationStatus; partySize: number }[]): DaySummary {
  const counted = items.filter((r) => COUNTED_STATUSES.includes(r.status));
  return {
    reservations: counted.length,
    covers: counted.reduce((n, r) => n + r.partySize, 0),
    pending: items.filter((r) => r.status === 'pending').length,
  };
}

/**
 * Día de servicio de una reserva: el de su fecha local, salvo si es de madrugada y cae en la cena de la víspera
 * que pasa de medianoche.
 */
export function serviceDateOf(
  startMs: number,
  timeZone: string,
  services: readonly ServiceConfig[],
  exceptions: readonly ExceptionConfig[],
): string {
  const { date, minute } = localParts(startMs, timeZone);
  const yesterday = addDays(date, -1);
  return serviceAt(minute + MINUTES_PER_DAY, servicesForDate(yesterday, services, exceptions)) ? yesterday : date;
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit`
Expected: 11 pruebas nuevas en verde; `test:unit` → **374** (52 archivos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/day.ts src/lib/reservations/day.test.ts
git commit -m "Reservas: servicios de cada fecha con última hora e intervalo, y reparto por servicio con la madrugada"
```

---

### Task 6: Disponibilidad: mesas libres, mesa propuesta y horas con hueco

**Files:**
- Create: `src/lib/reservations/availability.ts`
- Test: `src/lib/reservations/availability.test.ts`

**Interfaces:**
- Consumes: `slotMinutes`, `servicesForDate`, `type DayService`, `type ServiceConfig` (Task 5); `zonedTimeToUtc` (Task 4).
- Produces: `type BookingTable = { id; zoneId; zoneName; zonePosition; name; minCapacity; maxCapacity; onlineBookable; active; position }`, `type Occupancy = { reservationId; tableId; startMs; endMs }`, `type BlockSpan = { id; tableId: string | null; startMs; endMs; reason: string | null }`, `compareTables(a, b)`, `compareTablesForDisplay(a, b)`, `blockFor(tableId, startMs, endMs, blocks): BlockSpan | null`, `isTableFree(tableId, startMs, endMs, occupancy, blocks, ignoreReservationId?)`, `freeTables(tables, startMs, endMs, occupancy, blocks, ignoreReservationId?)`, `type ProposeOptions = { ignoreReservationId?; onlineOnly?; zoneId? }`, `proposeTable(tables, partySize, startMs, endMs, occupancy, blocks, opts?): BookingTable | null`, `capacityOf(tables): number`, `type Slot = { serviceKey; serviceName; minute; startMs; endMs; table: BookingTable | null }`, `type SlotsInput`, `getAvailableSlots(input: SlotsInput): Slot[]`.

El orden de `compareTables` es el mismo que el `order by` de `public.pick_reservation_table` (Task 2): capacidad máxima, posición de la zona, posición, nombre por unidades de código (`collate "C"`) e id.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/reservations/availability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  blockFor,
  capacityOf,
  compareTablesForDisplay,
  freeTables,
  getAvailableSlots,
  isTableFree,
  proposeTable,
  type BlockSpan,
  type BookingTable,
  type Occupancy,
} from './availability';
import { servicesForDate, type ServiceConfig } from './day';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
const H = 3_600_000;

function table(id: string, max: number, o: Partial<BookingTable> = {}): BookingTable {
  return {
    id,
    zoneId: 'terraza',
    zoneName: 'Terraza',
    zonePosition: 0,
    name: id.toUpperCase(),
    minCapacity: 1,
    maxCapacity: max,
    onlineBookable: true,
    active: true,
    position: 0,
    ...o,
  };
}

const tables = [
  table('s2', 8, { zoneId: 'sala', zoneName: 'Sala', zonePosition: 1, minCapacity: 5 }),
  table('t2', 4, { position: 1, minCapacity: 2 }),
  table('s1', 4, { zoneId: 'sala', zoneName: 'Sala', zonePosition: 1, minCapacity: 2 }),
  table('t1', 2),
  table('off', 2, { active: false }),
];
const at = (date: string, minute: number) => zonedTimeToUtc(date, minute, TZ);
const night = at('2030-06-14', 21 * 60);

describe('mesa propuesta', () => {
  it('la más pequeña que sirve; a igualdad, la de la zona y la posición primeras', () => {
    expect(proposeTable(tables, 2, night, night + 1.5 * H, [], [])?.id).toBe('t1');
    expect(proposeTable(tables, 3, night, night + 1.5 * H, [], [])?.id).toBe('t2');
    expect(proposeTable(tables, 6, night, night + 1.5 * H, [], [])?.id).toBe('s2');
    expect(proposeTable(tables, 9, night, night + 1.5 * H, [], [])).toBeNull();
  });

  it('respeta la capacidad mínima: 4 personas no van a S2 (5–8)', () => {
    const occupied: Occupancy[] = ['t2', 's1'].map((id) => ({ reservationId: id, tableId: id, startMs: night, endMs: night + 2 * H }));
    expect(proposeTable(tables, 4, night, night + 1.5 * H, occupied, [])).toBeNull();
  });

  it('se salta las ocupadas y las bloqueadas; una reserva que acaba justo cuando empieza otra no molesta', () => {
    const occupied: Occupancy[] = [{ reservationId: 'r1', tableId: 't1', startMs: night - 1.5 * H, endMs: night + 0.5 * H }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, occupied, [])?.id).toBe('t2');
    const blocks: BlockSpan[] = [{ id: 'b', tableId: 't2', startMs: night, endMs: night + H, reason: null }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, occupied, blocks)?.id).toBe('s1');
    const touching: Occupancy[] = [{ reservationId: 'r1', tableId: 't1', startMs: night - 1.5 * H, endMs: night }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, touching, [])?.id).toBe('t1');
  });

  it('un bloqueo de todo el restaurante deja sin mesas', () => {
    const all: BlockSpan[] = [{ id: 'b', tableId: null, startMs: night - H, endMs: night + 3 * H, reason: 'Evento' }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, [], all)).toBeNull();
    expect(blockFor('s1', night, night + H, all)?.reason).toBe('Evento');
  });

  it('al modificar una reserva, su propia ocupación no cuenta', () => {
    const own: Occupancy[] = [{ reservationId: 'mine', tableId: 't1', startMs: night, endMs: night + 1.5 * H }];
    expect(isTableFree('t1', night + 0.5 * H, night + 2 * H, own, [])).toBe(false);
    expect(isTableFree('t1', night + 0.5 * H, night + 2 * H, own, [], 'mine')).toBe(true);
  });

  it('online: solo mesas reservables online, y de la zona elegida', () => {
    const list = [table('t1', 2, { onlineBookable: false }), ...tables.slice(0, 3)];
    expect(proposeTable(list, 2, night, night + H, [], [], { onlineOnly: true })?.id).toBe('t2');
    expect(proposeTable(list, 2, night, night + H, [], [], { zoneId: 'sala' })?.id).toBe('s1');
  });
});

describe('varias mesas', () => {
  it('libres ordenadas de menor a mayor, sin las desactivadas; capacidad sumada', () => {
    const free = freeTables(tables, night, night + H, [], []);
    expect(free.map((t) => t.id)).toEqual(['t1', 't2', 's1', 's2']);
    expect(capacityOf(free.filter((t) => t.id !== 's2'))).toBe(10);
  });

  it('orden para pintar: por zona y posición', () => {
    expect([...tables].sort(compareTablesForDisplay).map((t) => t.id)).toEqual(['off', 't1', 't2', 's1', 's2']);
  });
});

describe('getAvailableSlots', () => {
  const week: ServiceConfig[] = [
    { name: 'Comida', weekday: 5, startMinute: 780, endMinute: 900, lastBookingMinute: 840, slotIntervalMin: 30 },
    { name: 'Cena', weekday: 5, startMinute: 1320, endMinute: 1500, lastBookingMinute: 1440, slotIntervalMin: 30 },
  ];
  const services = servicesForDate('2030-06-14', week, []);
  const base = { date: '2030-06-14', timeZone: TZ, services, partySize: 2, durationMin: 90, tables: [table('t1', 2)], occupancy: [], blocks: [] };

  it('horas de cada servicio hasta la última, con la mesa propuesta, también pasada la medianoche', () => {
    const slots = getAvailableSlots(base);
    expect(slots.map((s) => [s.serviceName, s.minute])).toEqual([
      ['Comida', 780],
      ['Comida', 810],
      ['Comida', 840],
      ['Cena', 1320],
      ['Cena', 1350],
      ['Cena', 1380],
      ['Cena', 1410],
      ['Cena', 1440],
    ]);
    expect(new Date(slots.at(-1)!.startMs).toISOString()).toBe('2030-06-14T22:00:00.000Z');
    expect(slots.every((s) => s.table?.id === 't1')).toBe(true);
  });

  it('una reserva tapa las horas cuya duración se solapa con ella', () => {
    const occupancy: Occupancy[] = [{ reservationId: 'r', tableId: 't1', startMs: at('2030-06-14', 1380), endMs: at('2030-06-14', 1470) }];
    const free = getAvailableSlots({ ...base, occupancy }).filter((s) => s.serviceName === 'Cena').map((s) => [s.minute, s.table !== null]);
    expect(free).toEqual([
      [1320, false],
      [1350, false],
      [1380, false],
      [1410, false],
      [1440, false],
    ]);
    const shorter = getAvailableSlots({ ...base, occupancy, durationMin: 60 }).filter((s) => s.serviceName === 'Cena');
    expect(shorter.map((s) => [s.minute, s.table !== null])).toEqual([
      [1320, true],
      [1350, false],
      [1380, false],
      [1410, false],
      [1440, false],
    ]);
  });

  it('la antelación quita las horas de antes y de después de la ventana', () => {
    const slots = getAvailableSlots({ ...base, notBeforeMs: at('2030-06-14', 840), notAfterMs: at('2030-06-14', 1350) });
    expect(slots.map((s) => s.minute)).toEqual([840, 1320, 1350]);
  });

  it('en Canarias, la misma hora local es una hora más tarde en UTC', () => {
    const [slot] = getAvailableSlots({ ...base, timeZone: 'Atlantic/Canary' });
    expect(new Date(slot.startMs).toISOString()).toBe('2030-06-14T12:00:00.000Z');
  });

  it('el día del cambio de hora, las horas siguen siendo las del reloj del restaurante', () => {
    const sunday: ServiceConfig[] = [{ name: 'Comida', weekday: 7, startMinute: 780, endMinute: 900, lastBookingMinute: 840, slotIntervalMin: 30 }];
    const slots = getAvailableSlots({ ...base, date: '2026-03-29', services: servicesForDate('2026-03-29', sunday, []) });
    expect(slots.map((s) => new Date(s.startMs).toISOString())).toEqual([
      '2026-03-29T11:00:00.000Z',
      '2026-03-29T11:30:00.000Z',
      '2026-03-29T12:00:00.000Z',
    ]);
  });
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations/availability.test.ts`
Expected: FAIL: `Failed to resolve import "./availability"`.

- [ ] **Step 3: Implementación**

Create `src/lib/reservations/availability.ts`:

```ts
import { slotMinutes, type DayService } from './day';
import { zonedTimeToUtc } from './time';

export type BookingTable = {
  id: string;
  zoneId: string;
  zoneName: string;
  zonePosition: number;
  name: string;
  minCapacity: number;
  maxCapacity: number;
  onlineBookable: boolean;
  active: boolean;
  position: number;
};

/** Una mesa ocupada por una reserva activa (pending, confirmed o seated) entre startMs y endMs. */
export type Occupancy = { reservationId: string; tableId: string; startMs: number; endMs: number };
/** Bloqueo de una mesa o de todo el restaurante (tableId null). */
export type BlockSpan = { id: string; tableId: string | null; startMs: number; endMs: number; reason: string | null };

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** «La más pequeña que sirve»: capacidad máxima, posición de la zona, posición, nombre (igual que la BD). */
export function compareTables(a: BookingTable, b: BookingTable): number {
  return (
    a.maxCapacity - b.maxCapacity ||
    a.zonePosition - b.zonePosition ||
    a.position - b.position ||
    byCodeUnits(a.name, b.name) ||
    byCodeUnits(a.id, b.id)
  );
}

/** Orden de las filas de la cuadrícula y de las listas: por zona y, dentro, por posición y nombre. */
export function compareTablesForDisplay(a: BookingTable, b: BookingTable): number {
  return a.zonePosition - b.zonePosition || byCodeUnits(a.zoneId, b.zoneId) || a.position - b.position || byCodeUnits(a.name, b.name);
}

/** El bloqueo que afecta a esa mesa en ese rato (el suyo o uno de todo el restaurante), si lo hay. */
export function blockFor(tableId: string, startMs: number, endMs: number, blocks: readonly BlockSpan[]): BlockSpan | null {
  return blocks.find((b) => (b.tableId === null || b.tableId === tableId) && overlaps(startMs, endMs, b.startMs, b.endMs)) ?? null;
}

export function isTableFree(
  tableId: string,
  startMs: number,
  endMs: number,
  occupancy: readonly Occupancy[],
  blocks: readonly BlockSpan[],
  ignoreReservationId?: string,
): boolean {
  if (blockFor(tableId, startMs, endMs, blocks)) return false;
  return !occupancy.some(
    (o) => o.tableId === tableId && o.reservationId !== ignoreReservationId && overlaps(startMs, endMs, o.startMs, o.endMs),
  );
}

/** Mesas activas libres y sin bloquear en ese rato, de la más pequeña a la más grande. */
export function freeTables(
  tables: readonly BookingTable[],
  startMs: number,
  endMs: number,
  occupancy: readonly Occupancy[],
  blocks: readonly BlockSpan[],
  ignoreReservationId?: string,
): BookingTable[] {
  return tables
    .filter((t) => t.active && isTableFree(t.id, startMs, endMs, occupancy, blocks, ignoreReservationId))
    .sort(compareTables);
}

export type ProposeOptions = { ignoreReservationId?: string; onlineOnly?: boolean; zoneId?: string | null };

/** La mesa más pequeña que sirve (mín ≤ personas ≤ máx), libre y sin bloquear; desempate por posición. */
export function proposeTable(
  tables: readonly BookingTable[],
  partySize: number,
  startMs: number,
  endMs: number,
  occupancy: readonly Occupancy[],
  blocks: readonly BlockSpan[],
  opts: ProposeOptions = {},
): BookingTable | null {
  return (
    freeTables(tables, startMs, endMs, occupancy, blocks, opts.ignoreReservationId).find(
      (t) =>
        t.minCapacity <= partySize &&
        partySize <= t.maxCapacity &&
        (!opts.onlineOnly || t.onlineBookable) &&
        (!opts.zoneId || t.zoneId === opts.zoneId),
    ) ?? null
  );
}

/** Personas que caben entre varias mesas (suma de sus capacidades máximas). */
export function capacityOf(tables: readonly Pick<BookingTable, 'maxCapacity'>[]): number {
  return tables.reduce((n, t) => n + t.maxCapacity, 0);
}

export type Slot = {
  serviceKey: string;
  serviceName: string;
  /** Minuto del día de servicio (1470 = 00:30 del día siguiente). */
  minute: number;
  startMs: number;
  endMs: number;
  /** La mesa que se propondría; null = no hay hueco. */
  table: BookingTable | null;
};

export type SlotsInput = {
  date: string;
  timeZone: string;
  services: readonly DayService[];
  partySize: number;
  durationMin: number;
  tables: readonly BookingTable[];
  occupancy: readonly Occupancy[];
  blocks: readonly BlockSpan[];
  zoneId?: string | null;
  onlineOnly?: boolean;
  /** Antelación: fuera quedan las horas antes de notBeforeMs o después de notAfterMs. */
  notBeforeMs?: number;
  notAfterMs?: number;
  ignoreReservationId?: string;
};

/**
 * Horas de un día con su mesa propuesta (spec §6.2): las de cada servicio del inicio a la última hora de reserva,
 * dentro de la antelación, con la mesa más pequeña que sirve libre durante toda la duración.
 */
export function getAvailableSlots(input: SlotsInput): Slot[] {
  const out: Slot[] = [];
  for (const service of input.services) {
    for (const minute of slotMinutes(service)) {
      const startMs = zonedTimeToUtc(input.date, minute, input.timeZone);
      if (input.notBeforeMs !== undefined && startMs < input.notBeforeMs) continue;
      if (input.notAfterMs !== undefined && startMs > input.notAfterMs) continue;
      const endMs = startMs + input.durationMin * 60_000;
      out.push({
        serviceKey: service.key,
        serviceName: service.name,
        minute,
        startMs,
        endMs,
        table: proposeTable(input.tables, input.partySize, startMs, endMs, input.occupancy, input.blocks, {
          onlineOnly: input.onlineOnly,
          zoneId: input.zoneId,
          ignoreReservationId: input.ignoreReservationId,
        }),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit`
Expected: 13 pruebas nuevas en verde; `test:unit` → **387** (53 archivos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/availability.ts src/lib/reservations/availability.test.ts
git commit -m "Reservas: disponibilidad pura con mesa más pequeña que sirve, bloqueos, antelación, medianoche y cambio de hora"
```

---

### Task 7: Cuadrícula: geometría, teclado y nombres accesibles

**Files:**
- Create: `src/lib/reservations/grid.ts`
- Test: `src/lib/reservations/grid.test.ts`

**Interfaces:**
- Consumes: `isActiveStatus`, `STATUS_LABELS_ES`, `ReservationStatus` (Task 3); `BlockSpan`, `BookingTable` (Task 6); `DayService` (Task 5); `serviceDayMinute`, `zonedTimeToUtc` (Task 4); `minutesToTime` de `@/lib/schedule`.
- Produces: `GRID_STEP = 15`, `type GridReservation = { id; startMs; endMs; tableIds; status; name; partySize }`, `type GridSegment = { kind: 'free'; col; span: 1; minute } | { kind: 'reservation'; col; span; reservationId } | { kind: 'block'; col; span; blockId }`, `type GridRow = { tableId; segments }`, `type GridLayout = { columns: number[]; rows: GridRow[] }`, `gridColumns(service)`, `buildGrid({ date, timeZone, service, tables, reservations, blocks }): GridLayout`, `segmentAt(row, col)`, `type GridPos = { row; col }`, `moveFocus(layout, pos, key): GridPos | null`, `freeCellLabel(tableName, minute)`, `reservationBarText(r)`, `reservationBarLabel(r, tableName, timeRange)`, `blockLabel(tableName, timeRange, reason)`.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/reservations/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BookingTable } from './availability';
import { blockLabel, buildGrid, freeCellLabel, gridColumns, moveFocus, reservationBarLabel, reservationBarText, segmentAt, type GridReservation } from './grid';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
const DATE = '2030-06-14';
const at = (minute: number) => zonedTimeToUtc(DATE, minute, TZ);
const service = { startMinute: 1260, endMinute: 1410 }; // 21:00–23:30 → 10 columnas
const t = (id: string, active = true): BookingTable => ({
  id,
  zoneId: 'z',
  zoneName: 'Sala',
  zonePosition: 0,
  name: id.toUpperCase(),
  minCapacity: 1,
  maxCapacity: 4,
  onlineBookable: true,
  active,
  position: 0,
});
const res = (id: string, tableIds: string[], from: number, to: number, status: GridReservation['status'] = 'confirmed'): GridReservation => ({
  id,
  startMs: at(from),
  endMs: at(to),
  tableIds,
  status,
  name: 'García',
  partySize: 4,
});

describe('cuadrícula', () => {
  it('columnas cada 15 min del inicio al cierre', () => {
    expect(gridColumns(service)).toEqual([1260, 1275, 1290, 1305, 1320, 1335, 1350, 1365, 1380, 1395]);
  });

  it('reservas como barras, huecos de 15 min y bloqueos; una reserva con dos mesas sale en las dos', () => {
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1'), t('t2')],
      reservations: [res('r1', ['t1', 't2'], 1290, 1380)],
      blocks: [{ id: 'b1', tableId: 't2', startMs: at(1380), endMs: at(1500), reason: 'Reparación' }],
    });
    expect(layout.rows[0].segments.map((s) => [s.kind, s.col, s.span])).toEqual([
      ['free', 0, 1],
      ['free', 1, 1],
      ['reservation', 2, 6],
      ['free', 8, 1],
      ['free', 9, 1],
    ]);
    expect(layout.rows[1].segments.slice(-2).map((s) => [s.kind, s.col, s.span])).toEqual([
      ['reservation', 2, 6],
      ['block', 8, 2],
    ]);
  });

  it('recorta lo que empieza antes o acaba después; no pinta canceladas; manda la reserva sobre el bloqueo', () => {
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1')],
      reservations: [res('early', ['t1'], 1200, 1275), res('late', ['t1'], 1395, 1500), res('gone', ['t1'], 1305, 1350, 'cancelled_customer')],
      blocks: [{ id: 'all', tableId: null, startMs: at(1260), endMs: at(1320), reason: null }],
    });
    expect(layout.rows[0].segments.map((s) => [s.kind, s.col, s.span])).toEqual([
      ['reservation', 0, 1],
      ['block', 1, 3],
      ['free', 4, 1],
      ['free', 5, 1],
      ['free', 6, 1],
      ['free', 7, 1],
      ['free', 8, 1],
      ['reservation', 9, 1],
    ]);
  });

  it('las mesas desactivadas solo salen si tienen reservas a la vista; la madrugada cuenta', () => {
    const late = { startMinute: 1320, endMinute: 1470 };
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service: late,
      tables: [t('t1'), t('off', false), t('off2', false)],
      reservations: [res('r', ['off'], 1440, 1470)],
      blocks: [],
    });
    expect(layout.rows.map((r) => r.tableId)).toEqual(['t1', 'off']);
    expect(layout.rows[1].segments.at(-1)).toEqual({ kind: 'reservation', col: 8, span: 2, reservationId: 'r' });
  });
});

describe('teclado', () => {
  const layout = buildGrid({
    date: DATE,
    timeZone: TZ,
    service,
    tables: [t('t1'), t('t2')],
    reservations: [res('r1', ['t1'], 1290, 1380)],
    blocks: [],
  });

  it('derecha e izquierda saltan la barra entera', () => {
    expect(moveFocus(layout, { row: 0, col: 1 }, 'ArrowRight')).toEqual({ row: 0, col: 2 });
    expect(moveFocus(layout, { row: 0, col: 2 }, 'ArrowRight')).toEqual({ row: 0, col: 8 });
    expect(moveFocus(layout, { row: 0, col: 8 }, 'ArrowLeft')).toEqual({ row: 0, col: 2 });
    expect(moveFocus(layout, { row: 0, col: 9 }, 'ArrowRight')).toEqual({ row: 0, col: 9 });
    expect(moveFocus(layout, { row: 0, col: 0 }, 'ArrowLeft')).toEqual({ row: 0, col: 0 });
  });

  it('arriba y abajo mantienen la columna; Inicio y Fin; otras teclas, nada', () => {
    expect(moveFocus(layout, { row: 1, col: 5 }, 'ArrowUp')).toEqual({ row: 0, col: 5 });
    expect(segmentAt(layout.rows[0], 5)).toMatchObject({ kind: 'reservation', col: 2 });
    expect(moveFocus(layout, { row: 1, col: 5 }, 'ArrowDown')).toEqual({ row: 1, col: 5 });
    expect(moveFocus(layout, { row: 0, col: 5 }, 'End')).toEqual({ row: 0, col: 9 });
    expect(moveFocus(layout, { row: 0, col: 5 }, 'Home')).toEqual({ row: 0, col: 0 });
    expect(moveFocus(layout, { row: 0, col: 5 }, 'Enter')).toBeNull();
  });
});

it('nombres accesibles: el de la barra empieza por su texto visible', () => {
  expect(freeCellLabel('T4', 1275)).toBe('Nueva reserva en T4 a las 21:15');
  const r = res('r', ['t4'], 1260, 1350);
  expect(reservationBarText(r)).toBe('García · 4');
  expect(reservationBarLabel(r, 'T4', '21:00–22:30')).toBe('García · 4 personas, T4, 21:00–22:30, Confirmada. Abrir la reserva');
  expect(blockLabel('T4', '13:00–16:00', 'Obras')).toBe('T4 bloqueada, 13:00–16:00: Obras');
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations/grid.test.ts`
Expected: FAIL: `Failed to resolve import "./grid"`.

- [ ] **Step 3: Implementación**

Create `src/lib/reservations/grid.ts`:

```ts
import { minutesToTime } from '@/lib/schedule';
import { isActiveStatus, STATUS_LABELS_ES, type ReservationStatus } from './codes';
import type { BlockSpan, BookingTable } from './availability';
import type { DayService } from './day';
import { serviceDayMinute, zonedTimeToUtc } from './time';

/** Cada columna de la cuadrícula son 15 minutos. */
export const GRID_STEP = 15;

export type GridReservation = {
  id: string;
  startMs: number;
  endMs: number;
  tableIds: string[];
  status: ReservationStatus;
  name: string;
  partySize: number;
};

export type GridSegment =
  | { kind: 'free'; col: number; span: 1; minute: number }
  | { kind: 'reservation'; col: number; span: number; reservationId: string }
  | { kind: 'block'; col: number; span: number; blockId: string };

export type GridRow = { tableId: string; segments: GridSegment[] };
export type GridLayout = { columns: number[]; rows: GridRow[] };

/** Minutos de cada columna: del inicio al cierre del servicio, cada 15 min (el cierre no tiene columna). */
export function gridColumns(service: Pick<DayService, 'startMinute' | 'endMinute'>): number[] {
  const out: number[] = [];
  for (let m = service.startMinute; m < service.endMinute; m += GRID_STEP) out.push(m);
  return out;
}

type Occupant = { kind: 'reservation' | 'block'; id: string } | null;

/**
 * Filas (mesas activas y las desactivadas que tienen reservas a la vista, en el orden recibido) con sus tramos:
 * reservas activas, bloqueos (rayados) y huecos de 15 min. Si una reserva y un bloqueo se pisan, manda la reserva.
 */
export function buildGrid(input: {
  date: string;
  timeZone: string;
  service: Pick<DayService, 'startMinute' | 'endMinute'>;
  tables: readonly BookingTable[];
  reservations: readonly GridReservation[];
  blocks: readonly BlockSpan[];
}): GridLayout {
  const columns = gridColumns(input.service);
  const n = columns.length;
  const dayStart = zonedTimeToUtc(input.date, 0, input.timeZone);
  const minuteOf = (ms: number) => serviceDayMinute(ms, input.date, input.timeZone) ?? (ms < dayStart ? -Infinity : Infinity);
  const span = (startMs: number, endMs: number): [number, number] | null => {
    const from = Math.max(0, Math.floor((minuteOf(startMs) - input.service.startMinute) / GRID_STEP));
    const to = Math.min(n, Math.ceil((minuteOf(endMs) - input.service.startMinute) / GRID_STEP));
    return to > from ? [from, to] : null;
  };
  const active = input.reservations.filter((r) => isActiveStatus(r.status));
  const tables = input.tables.filter((t) => t.active || active.some((r) => r.tableIds.includes(t.id)));

  const rows = tables.map((table): GridRow => {
    const cells: Occupant[] = Array.from({ length: n }, () => null);
    for (const b of input.blocks) {
      if (b.tableId !== null && b.tableId !== table.id) continue;
      const s = span(b.startMs, b.endMs);
      if (s) for (let c = s[0]; c < s[1]; c++) cells[c] = { kind: 'block', id: b.id };
    }
    for (const r of active) {
      if (!r.tableIds.includes(table.id)) continue;
      const s = span(r.startMs, r.endMs);
      if (s) for (let c = s[0]; c < s[1]; c++) cells[c] = { kind: 'reservation', id: r.id };
    }
    const segments: GridSegment[] = [];
    for (let c = 0; c < n; c++) {
      const occupant = cells[c];
      if (!occupant) {
        segments.push({ kind: 'free', col: c, span: 1, minute: columns[c] });
        continue;
      }
      let end = c + 1;
      while (end < n && cells[end]?.kind === occupant.kind && cells[end]?.id === occupant.id) end++;
      segments.push(
        occupant.kind === 'reservation'
          ? { kind: 'reservation', col: c, span: end - c, reservationId: occupant.id }
          : { kind: 'block', col: c, span: end - c, blockId: occupant.id },
      );
      c = end - 1;
    }
    return { tableId: table.id, segments };
  });
  return { columns, rows };
}

/** El tramo de la fila que cubre esa columna. */
export function segmentAt(row: GridRow, col: number): GridSegment {
  return row.segments.find((s) => col >= s.col && col < s.col + s.span) ?? row.segments[row.segments.length - 1];
}

export type GridPos = { row: number; col: number };

/**
 * Teclado de la cuadrícula (un solo punto de tabulación): flechas para ir de tramo en tramo y de mesa en mesa (se
 * mantiene la columna), Inicio y Fin para ir al primero y al último de la fila. null si la tecla no es de moverse.
 */
export function moveFocus(layout: GridLayout, pos: GridPos, key: string): GridPos | null {
  const last = layout.columns.length - 1;
  const row = layout.rows[pos.row];
  if (!row || last < 0) return null;
  const current = segmentAt(row, pos.col);
  switch (key) {
    case 'ArrowRight': {
      const next = current.col + current.span;
      return { row: pos.row, col: next <= last ? next : pos.col };
    }
    case 'ArrowLeft':
      return { row: pos.row, col: current.col > 0 ? segmentAt(row, current.col - 1).col : pos.col };
    case 'ArrowDown':
      return { row: Math.min(pos.row + 1, layout.rows.length - 1), col: pos.col };
    case 'ArrowUp':
      return { row: Math.max(pos.row - 1, 0), col: pos.col };
    case 'Home':
      return { row: pos.row, col: 0 };
    case 'End':
      return { row: pos.row, col: last };
    default:
      return null;
  }
}

/** Nombre accesible de un hueco: 'Nueva reserva en T4 a las 21:15'. */
export function freeCellLabel(tableName: string, minute: number): string {
  return `Nueva reserva en ${tableName} a las ${minutesToTime(minute)}`;
}

/** Texto visible de una barra ('García · 4') y su nombre accesible, que empieza por él. */
export function reservationBarText(r: Pick<GridReservation, 'name' | 'partySize'>): string {
  return `${r.name} · ${r.partySize}`;
}

export function reservationBarLabel(r: GridReservation, tableName: string, timeRange: string): string {
  return `${reservationBarText(r)} personas, ${tableName}, ${timeRange}, ${STATUS_LABELS_ES[r.status]}. Abrir la reserva`;
}

export function blockLabel(tableName: string, timeRange: string, reason: string | null): string {
  return `${tableName} bloqueada, ${timeRange}${reason ? `: ${reason}` : ''}`;
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit`
Expected: 7 pruebas nuevas en verde; `test:unit` → **394** (54 archivos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/grid.ts src/lib/reservations/grid.test.ts
git commit -m "Reservas: geometría de la cuadrícula mesas × horas, teclado y nombres accesibles"
```

---

### Task 8: Avisos del cliente, lectura de filas y datos del panel

**Files:**
- Create: `src/lib/reservations/customers.ts`, `src/lib/reservations/rows.ts`, `src/lib/reservations/data.ts`
- Test: `src/lib/reservations/customers.test.ts`, `src/lib/reservations/rows.test.ts`

**Interfaces:**
- Consumes: `CUSTOMER_TAGS`, `CUSTOMER_TAG_LABELS_ES`, `RESERVATION_STATUSES`, `RESERVATION_SOURCES` (Task 3); `DEFAULT_BOOKING_SETTINGS`, `BookingSettings` (Task 4); `ServiceConfig`, `ExceptionConfig` (Task 5); `BookingTable`, `Occupancy`, `BlockSpan` (Task 6); `serviceDayWindow` (Task 4); `createClient` de `@/lib/supabase/server`; `type SupabaseServerClient` de `@/lib/actions/run`; la función `get_booking_day` (Task 2).
- Produces:
  - `customers.ts`: `type CustomerSummary = { id; name; phone; email; tags: CustomerTag[]; visitsCount; noShowCount; cancelCount }`, `type CustomerWarning = { text; tone: 'warning' | 'info' }`, `customerWarnings(c): CustomerWarning[]`.
  - `rows.ts`: `type PanelReservation = { id; startMs; endMs; partySize; status; previousStatus; source; notes; internalNotes; tableIds; customer: CustomerSummary | null }`, `type BookingDayData = { reservations; occupancy; blocks }`, `parseBookingDay(json): BookingDayData`, `type ZoneRow = { id; name; position }`, `type TableRow`, `toBookingTables(zones, tables)`, `type SettingsRow`, `toBookingSettings(row | null)`, `type ServiceRow`, `toServiceConfigs(rows)`, `type ExceptionRow`, `toExceptionConfigs(rows)`.
  - `data.ts` (server): `type RestaurantTimeZone`, `type BookingConfig = { timezone; zones: ZoneRow[]; tables: BookingTable[]; settings; services; exceptions }`, `loadBookingConfig(supabase, restaurantId): Promise<BookingConfig>`, `getBookingConfig(restaurantId)`, `getBookingDay(restaurantId, date, timeZone): Promise<BookingDayData>`, `getReservationStart(restaurantId, reservationId): Promise<number | null>`, `countTables(restaurantId): Promise<number>`.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/reservations/customers.test.ts`:

```ts
import { expect, it } from 'vitest';
import { customerWarnings, type CustomerSummary } from './customers';

const base: CustomerSummary = { id: 'c', name: 'Ana', phone: null, email: null, tags: [], visitsCount: 0, noShowCount: 0, cancelCount: 0 };

it('un cliente nuevo: primera visita', () => {
  expect(customerWarnings(base)).toEqual([{ text: 'Primera visita', tone: 'info' }]);
});

it('primero los avisos (problemático, no-shows, cancelaciones) y después VIP, habitual y visitas', () => {
  expect(customerWarnings({ ...base, tags: ['vip', 'problem', 'regular'], noShowCount: 2, cancelCount: 1, visitsCount: 1 })).toEqual([
    { text: 'Problemático', tone: 'warning' },
    { text: '2 no-shows', tone: 'warning' },
    { text: '1 cancelación', tone: 'warning' },
    { text: 'VIP', tone: 'info' },
    { text: 'Habitual', tone: 'info' },
    { text: '1 visita', tone: 'info' },
  ]);
  expect(customerWarnings({ ...base, noShowCount: 1, visitsCount: 5 }).map((w) => w.text)).toEqual(['1 no-show', '5 visitas']);
});
```

Create `src/lib/reservations/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseBookingDay, toBookingSettings, toBookingTables, toExceptionConfigs, toServiceConfigs } from './rows';
import { DEFAULT_BOOKING_SETTINGS } from './settings';

const day = {
  reservations: [
    {
      id: 'r1',
      starts_at: '2030-06-14T19:00:00+00:00',
      ends_at: '2030-06-14T20:30:00+00:00',
      party_size: 4,
      status: 'confirmed',
      previous_status: null,
      source: 'phone',
      notes: 'Trona',
      internal_notes: null,
      created_at: '2030-06-01T10:00:00+00:00',
      table_ids: ['t1'],
      customer: { id: 'c1', name: 'Ana', phone: '+34612345678', email: null, tags: ['vip', 'raro'], visits_count: 3, no_show_count: 1, cancel_count: 0 },
    },
  ],
  occupancy: [{ reservation_id: 'r1', table_id: 't1', starts_at: '2030-06-14T19:00:00+00:00', ends_at: '2030-06-14T20:30:00+00:00' }],
  blocks: [{ id: 'b1', table_id: null, starts_at: '2030-06-14T12:00:00+00:00', ends_at: '2030-06-14T15:00:00+00:00', reason: null }],
};

describe('parseBookingDay', () => {
  it('pasa el JSON de la BD a objetos con instantes en ms', () => {
    const d = parseBookingDay(day);
    expect(d.reservations[0]).toEqual({
      id: 'r1',
      startMs: Date.parse('2030-06-14T19:00:00Z'),
      endMs: Date.parse('2030-06-14T20:30:00Z'),
      partySize: 4,
      status: 'confirmed',
      previousStatus: null,
      source: 'phone',
      notes: 'Trona',
      internalNotes: null,
      tableIds: ['t1'],
      customer: { id: 'c1', name: 'Ana', phone: '+34612345678', email: null, tags: ['vip'], visitsCount: 3, noShowCount: 1, cancelCount: 0 },
    });
    expect(d.occupancy).toEqual([{ reservationId: 'r1', tableId: 't1', startMs: Date.parse('2030-06-14T19:00:00Z'), endMs: Date.parse('2030-06-14T20:30:00Z') }]);
    expect(d.blocks[0]).toMatchObject({ id: 'b1', tableId: null, reason: null });
  });

  it('lanza si falta algo o un estado no existe', () => {
    expect(() => parseBookingDay({ ...day, blocks: undefined })).toThrow();
    expect(() => parseBookingDay({ ...day, reservations: [{ ...day.reservations[0], status: 'perdida' }] })).toThrow();
    expect(() => parseBookingDay({ ...day, occupancy: [{ ...day.occupancy[0], starts_at: 'ayer' }] })).toThrow();
  });
});

describe('filas de configuración', () => {
  it('mesas con su zona; sin zona, fuera', () => {
    const tables = toBookingTables(
      [{ id: 'z1', name: 'Terraza', position: 2 }],
      [
        { id: 't1', zone_id: 'z1', name: 'T1', min_capacity: 1, max_capacity: 2, online_bookable: true, active: true, position: 0 },
        { id: 't2', zone_id: 'zx', name: 'T2', min_capacity: 1, max_capacity: 2, online_bookable: true, active: true, position: 1 },
      ],
    );
    expect(tables).toEqual([
      { id: 't1', zoneId: 'z1', zoneName: 'Terraza', zonePosition: 2, name: 'T1', minCapacity: 1, maxCapacity: 2, onlineBookable: true, active: true, position: 0 },
    ]);
  });

  it('ajustes: sin fila, los de por defecto; con fila, sus valores y tramos', () => {
    expect(toBookingSettings(null)).toEqual(DEFAULT_BOOKING_SETTINGS);
    expect(
      toBookingSettings({
        default_duration_min: 105,
        duration_rules: [{ min_party: 1, max_party: 2, duration_min: 60 }],
        min_advance_min: 0,
        max_advance_days: 30,
        max_online_party: 6,
        cancel_limit_hours: 24,
        auto_confirm: false,
      }),
    ).toEqual({
      defaultDurationMin: 105,
      durationRules: [{ minParty: 1, maxParty: 2, durationMin: 60 }],
      minAdvanceMin: 0,
      maxAdvanceDays: 30,
      maxOnlineParty: 6,
      cancelLimitHours: 24,
      autoConfirm: false,
    });
  });

  it('servicios y excepciones', () => {
    expect(toServiceConfigs([{ id: 's', name: 'Cena', weekday: 5, start_minute: 1200, end_minute: 1440, last_booking_minute: null, slot_interval_min: 30 }])).toEqual([
      { id: 's', name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1440, lastBookingMinute: null, slotIntervalMin: 30 },
    ]);
    expect(
      toExceptionConfigs([{ date_from: '2030-12-24', date_to: '2030-12-24', kind: 'custom', custom_services: [{ name: 'Gala', start_minute: 1260, end_minute: 1560 }] }]),
    ).toEqual([{ dateFrom: '2030-12-24', dateTo: '2030-12-24', kind: 'custom', customServices: [{ name: 'Gala', startMinute: 1260, endMinute: 1560 }] }]);
  });
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations/customers.test.ts src/lib/reservations/rows.test.ts`
Expected: FAIL: `Failed to resolve import "./customers"` y `"./rows"`.

- [ ] **Step 3: Implementación**

Create `src/lib/reservations/customers.ts`:

```ts
import { CUSTOMER_TAG_LABELS_ES, type CustomerTag } from './codes';

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tags: CustomerTag[];
  visitsCount: number;
  noShowCount: number;
  cancelCount: number;
};

export type CustomerWarning = { text: string; tone: 'warning' | 'info' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Avisos del cliente que se ven en la reserva: etiquetas, no-shows, cancelaciones y visitas. */
export function customerWarnings(c: CustomerSummary): CustomerWarning[] {
  const out: CustomerWarning[] = [];
  if (c.tags.includes('problem')) out.push({ text: CUSTOMER_TAG_LABELS_ES.problem, tone: 'warning' });
  if (c.noShowCount > 0) out.push({ text: plural(c.noShowCount, 'no-show', 'no-shows'), tone: 'warning' });
  if (c.cancelCount > 0) out.push({ text: plural(c.cancelCount, 'cancelación', 'cancelaciones'), tone: 'warning' });
  if (c.tags.includes('vip')) out.push({ text: CUSTOMER_TAG_LABELS_ES.vip, tone: 'info' });
  if (c.tags.includes('regular')) out.push({ text: CUSTOMER_TAG_LABELS_ES.regular, tone: 'info' });
  out.push({ text: c.visitsCount === 0 ? 'Primera visita' : plural(c.visitsCount, 'visita', 'visitas'), tone: 'info' });
  return out;
}
```

Create `src/lib/reservations/rows.ts`:

```ts
import { z } from 'zod';
import type { BlockSpan, BookingTable, Occupancy } from './availability';
import { CUSTOMER_TAGS, RESERVATION_SOURCES, RESERVATION_STATUSES, type ReservationSource, type ReservationStatus } from './codes';
import type { CustomerSummary } from './customers';
import type { ExceptionConfig, ServiceConfig } from './day';
import { DEFAULT_BOOKING_SETTINGS, type BookingSettings } from './settings';

export type PanelReservation = {
  id: string;
  startMs: number;
  endMs: number;
  partySize: number;
  status: ReservationStatus;
  previousStatus: ReservationStatus | null;
  source: ReservationSource;
  notes: string | null;
  internalNotes: string | null;
  tableIds: string[];
  customer: CustomerSummary | null;
};

export type BookingDayData = { reservations: PanelReservation[]; occupancy: Occupancy[]; blocks: BlockSpan[] };

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
  reservations: z.array(
    z.object({
      id: z.string(),
      starts_at: instant,
      ends_at: instant,
      party_size: int,
      status: z.enum(RESERVATION_STATUSES),
      previous_status: z.enum(RESERVATION_STATUSES).nullable(),
      source: z.enum(RESERVATION_SOURCES),
      notes: z.string().nullable(),
      internal_notes: z.string().nullable(),
      table_ids: z.array(z.string()),
      customer: z
        .object({
          id: z.string(),
          name: z.string(),
          phone: z.string().nullable(),
          email: z.string().nullable(),
          tags: z.array(z.string()),
          visits_count: int,
          no_show_count: int,
          cancel_count: int,
        })
        .nullable(),
    }),
  ),
  occupancy: z.array(z.object({ reservation_id: z.string(), table_id: z.string(), starts_at: instant, ends_at: instant })),
  blocks: z.array(z.object({ id: z.string(), table_id: z.string().nullable(), starts_at: instant, ends_at: instant, reason: z.string().nullable() })),
});

/** JSON de get_booking_day → objetos de la app (instantes en ms). Lanza si no tiene la forma esperada. */
export function parseBookingDay(json: unknown): BookingDayData {
  const d = daySchema.parse(json);
  return {
    reservations: d.reservations.map((r) => ({
      id: r.id,
      startMs: r.starts_at,
      endMs: r.ends_at,
      partySize: r.party_size,
      status: r.status,
      previousStatus: r.previous_status,
      source: r.source,
      notes: r.notes,
      internalNotes: r.internal_notes,
      tableIds: r.table_ids,
      customer: r.customer && {
        id: r.customer.id,
        name: r.customer.name,
        phone: r.customer.phone,
        email: r.customer.email,
        tags: CUSTOMER_TAGS.filter((t) => r.customer?.tags.includes(t)),
        visitsCount: r.customer.visits_count,
        noShowCount: r.customer.no_show_count,
        cancelCount: r.customer.cancel_count,
      },
    })),
    occupancy: d.occupancy.map((o) => ({ reservationId: o.reservation_id, tableId: o.table_id, startMs: o.starts_at, endMs: o.ends_at })),
    blocks: d.blocks.map((b) => ({ id: b.id, tableId: b.table_id, startMs: b.starts_at, endMs: b.ends_at, reason: b.reason })),
  };
}

export type ZoneRow = { id: string; name: string; position: number };
export type TableRow = {
  id: string;
  zone_id: string;
  name: string;
  min_capacity: number;
  max_capacity: number;
  online_bookable: boolean;
  active: boolean;
  position: number;
};

/** Mesas con los datos de su zona. Una mesa cuya zona no llega se descarta. */
export function toBookingTables(zones: readonly ZoneRow[], tables: readonly TableRow[]): BookingTable[] {
  const byId = new Map(zones.map((z) => [z.id, z]));
  return tables.flatMap((t) => {
    const zone = byId.get(t.zone_id);
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
        onlineBookable: t.online_bookable,
        active: t.active,
        position: t.position,
      },
    ];
  });
}

export type SettingsRow = {
  default_duration_min: number;
  duration_rules: { min_party: number; max_party: number; duration_min: number }[];
  min_advance_min: number;
  max_advance_days: number;
  max_online_party: number;
  cancel_limit_hours: number;
  auto_confirm: boolean;
};

/** Sin fila guardada, los valores por defecto. */
export function toBookingSettings(row: SettingsRow | null): BookingSettings {
  if (!row) return DEFAULT_BOOKING_SETTINGS;
  return {
    defaultDurationMin: row.default_duration_min,
    durationRules: row.duration_rules.map((r) => ({ minParty: r.min_party, maxParty: r.max_party, durationMin: r.duration_min })),
    minAdvanceMin: row.min_advance_min,
    maxAdvanceDays: row.max_advance_days,
    maxOnlineParty: row.max_online_party,
    cancelLimitHours: row.cancel_limit_hours,
    autoConfirm: row.auto_confirm,
  };
}

export type ServiceRow = {
  id: string;
  name: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  last_booking_minute: number | null;
  slot_interval_min: number;
};

export function toServiceConfigs(rows: readonly ServiceRow[]): ServiceConfig[] {
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    weekday: s.weekday,
    startMinute: s.start_minute,
    endMinute: s.end_minute,
    lastBookingMinute: s.last_booking_minute,
    slotIntervalMin: s.slot_interval_min,
  }));
}

export type ExceptionRow = {
  date_from: string;
  date_to: string;
  kind: 'closed' | 'custom';
  custom_services: { name: string; start_minute: number; end_minute: number }[];
};

export function toExceptionConfigs(rows: readonly ExceptionRow[]): ExceptionConfig[] {
  return rows.map((e) => ({
    dateFrom: e.date_from,
    dateTo: e.date_to,
    kind: e.kind,
    customServices: e.custom_services.map((s) => ({ name: s.name, startMinute: s.start_minute, endMinute: s.end_minute })),
  }));
}
```

Create `src/lib/reservations/data.ts`:

```ts
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseServerClient } from '@/lib/actions/run';
import type { BookingTable } from './availability';
import type { ExceptionConfig, ServiceConfig } from './day';
import {
  parseBookingDay,
  toBookingSettings,
  toBookingTables,
  toExceptionConfigs,
  toServiceConfigs,
  type BookingDayData,
  type ExceptionRow,
  type ServiceRow,
  type SettingsRow,
  type TableRow,
  type ZoneRow,
} from './rows';
import type { BookingSettings } from './settings';
import { serviceDayWindow } from './time';

export type RestaurantTimeZone = 'Europe/Madrid' | 'Atlantic/Canary';

export type BookingConfig = {
  timezone: RestaurantTimeZone;
  zones: ZoneRow[];
  tables: BookingTable[];
  settings: BookingSettings;
  services: ServiceConfig[];
  exceptions: ExceptionConfig[];
};

/** Zonas, mesas (también las desactivadas), ajustes, servicios y excepciones, con la sesión del usuario (RLS). */
export async function loadBookingConfig(supabase: SupabaseServerClient, restaurantId: string): Promise<BookingConfig> {
  const [restaurant, zones, tables, settings, services, exceptions] = await Promise.all([
    supabase.from('restaurants').select('timezone').eq('id', restaurantId).single(),
    supabase.from('zones').select('id, name, position').eq('restaurant_id', restaurantId).order('position').order('name'),
    supabase
      .from('tables')
      .select('id, zone_id, name, min_capacity, max_capacity, online_bookable, active, position')
      .eq('restaurant_id', restaurantId)
      .order('position')
      .order('name'),
    supabase
      .from('booking_settings')
      .select('default_duration_min, duration_rules, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm')
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
    supabase
      .from('services')
      .select('id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min')
      .eq('restaurant_id', restaurantId)
      .order('weekday')
      .order('start_minute'),
    supabase.from('schedule_exceptions').select('date_from, date_to, kind, custom_services').eq('restaurant_id', restaurantId).order('date_from'),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`restaurants: ${restaurant.error?.message ?? 'sin datos'}`);
  for (const [table, res] of [
    ['zones', zones],
    ['tables', tables],
    ['booking_settings', settings],
    ['services', services],
    ['schedule_exceptions', exceptions],
  ] as const) {
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
  }
  const zoneRows = (zones.data ?? []) as ZoneRow[];
  return {
    timezone: (restaurant.data as { timezone: RestaurantTimeZone }).timezone,
    zones: zoneRows,
    tables: toBookingTables(zoneRows, (tables.data ?? []) as TableRow[]),
    settings: toBookingSettings((settings.data ?? null) as SettingsRow | null),
    services: toServiceConfigs((services.data ?? []) as ServiceRow[]),
    exceptions: toExceptionConfigs((exceptions.data ?? []) as ExceptionRow[]),
  };
}

export async function getBookingConfig(restaurantId: string): Promise<BookingConfig> {
  return loadBookingConfig(await createClient(), restaurantId);
}

/** Reservas que empiezan en el día de servicio `date` (de las 00:00 a las 06:00 del día siguiente) y lo que ocupa mesas. */
export async function getBookingDay(restaurantId: string, date: string, timeZone: string): Promise<BookingDayData> {
  const supabase = await createClient();
  const window = serviceDayWindow(date, timeZone);
  const { data, error } = await supabase.rpc('get_booking_day', {
    p_restaurant_id: restaurantId,
    p_from: new Date(window.from).toISOString(),
    p_to: new Date(window.to).toISOString(),
  });
  if (error) throw new Error(`get_booking_day: ${error.message}`);
  return parseBookingDay(data);
}

/** Inicio de una reserva del restaurante (para saber de qué día es), o null si no es suya. */
export async function getReservationStart(restaurantId: string, reservationId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reservations')
    .select('starts_at')
    .eq('id', reservationId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error) throw new Error(`reservations: ${error.message}`);
  return data ? Date.parse((data as { starts_at: string }).starts_at) : null;
}

/** Cuántas mesas tiene el restaurante (para el asistente de bienvenida). */
export async function countTables(restaurantId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId);
  if (error) throw new Error(`tables: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit && pnpm typecheck`
Expected: 7 pruebas nuevas en verde; `test:unit` → **401** (56 archivos); sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/customers.ts src/lib/reservations/customers.test.ts src/lib/reservations/rows.ts src/lib/reservations/rows.test.ts src/lib/reservations/data.ts
git commit -m "Reservas: avisos del cliente y lectura de la configuración y del día para el panel"
```

---

### Task 9: Validación de los formularios de reservas

**Files:**
- Create: `src/lib/reservations/validation.ts`
- Test: `src/lib/reservations/validation.test.ts`

**Interfaces:**
- Consumes: `formStrings`, `fieldErrorsFrom` de `@/lib/forms`; `MINUTES_PER_DAY`, `timeToMinutes` de `@/lib/schedule`; `isRealDate` de `@/lib/validation/schedule`; `uuidSchema`; `BOOKING_LIMITS`, `RESERVATION_STATUSES` (Task 3); `normalizePhoneE164` (Task 3); `overlappingRules`, `DurationRule` (Task 4).
- Produces: `isoDateSchema`; `zoneFormSchema` (`name`, `position`); `tableFormSchema` (→ `{ zoneId: string | null; name; minCapacity; maxCapacity; position; onlineBookable; active }`) y `TABLE_FORM_FIELDS`; `RULE_ROWS` (1…6), `readSettingsForm(fd)`, `bookingSettingsSchema` (→ `BookingSettings`; campos `defaultDuration`, `rule<n>_min|max|duration`, `minAdvanceMin`, `maxAdvanceDays`, `maxOnlineParty`, `cancelLimitHours`, `autoConfirm`); `serviceBookingSchema({ startMinute, endMinute })` (`lastBooking`, `slotInterval` → `{ lastBookingMinute: number | null; slotIntervalMin: 15 | 30 }`); `TABLE_MODES = ['auto', 'manual', 'none', 'keep']`, `type TableMode`; `readReservationForm(fd)`; `phoneReservationSchema` (→ `{ date; time: minuto; partySize; duration: number | null; tableMode; tableIds; notes; internalNotes; name; phone: E.164; email: string | null }`); `reservationEditSchema` (lo mismo sin cliente); `walkInSchema` (`partySize`, `tableIds`, `name`); `blockFormSchema` (→ `{ date; startMinute; endMinute; tableId: string | null; reason }`) y `BLOCK_FORM_FIELDS`; `statusSchema`.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/reservations/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '@/lib/forms';
import {
  blockFormSchema,
  bookingSettingsSchema,
  phoneReservationSchema,
  reservationEditSchema,
  serviceBookingSchema,
  tableFormSchema,
  walkInSchema,
  zoneFormSchema,
} from './validation';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

function errors(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown) {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  return fieldErrorsFrom(r.error as never);
}

describe('zonas y mesas', () => {
  it('zona con nombre y orden', () => {
    expect(zoneFormSchema.parse({ name: ' Terraza ', position: '2' })).toEqual({ name: 'Terraza', position: 2 });
    expect(errors(zoneFormSchema, { name: '', position: '-1' })).toEqual({
      name: 'Ponle nombre a la zona (por ejemplo, Terraza).',
      position: 'Pon un número del 0 al 999.',
    });
  });

  it('mesa: capacidades, casillas y zona opcional', () => {
    const table = { zoneId: '', name: ' T4 ', minCapacity: '2', maxCapacity: '4', position: '0', onlineBookable: 'on', active: '' };
    expect(tableFormSchema.parse(table)).toEqual({ zoneId: null, name: 'T4', minCapacity: 2, maxCapacity: 4, position: 0, onlineBookable: true, active: false });
    expect(errors(tableFormSchema, { ...table, minCapacity: '6' })).toEqual({ minCapacity: 'El mínimo no puede ser mayor que el máximo.' });
    expect(errors(tableFormSchema, { ...table, zoneId: 'x', maxCapacity: '51' })).toEqual({
      zoneId: 'Elige una zona.',
      maxCapacity: 'Entre 1 y 50 personas.',
    });
  });
});

describe('ajustes de reserva', () => {
  const base = {
    defaultDuration: '90',
    minAdvanceMin: '60',
    maxAdvanceDays: '60',
    maxOnlineParty: '8',
    cancelLimitHours: '2',
    autoConfirm: 'on',
  };

  it('tramos rellenos, filas vacías fuera', () => {
    expect(
      bookingSettingsSchema.parse({ ...base, rule1_min: '1', rule1_max: '2', rule1_duration: '75', rule2_min: '', rule2_max: '', rule2_duration: '', rule3_min: '7', rule3_max: '50', rule3_duration: '150' }),
    ).toEqual({
      defaultDurationMin: 90,
      durationRules: [
        { minParty: 1, maxParty: 2, durationMin: 75 },
        { minParty: 7, maxParty: 50, durationMin: 150 },
      ],
      minAdvanceMin: 60,
      maxAdvanceDays: 60,
      maxOnlineParty: 8,
      cancelLimitHours: 2,
      autoConfirm: true,
    });
  });

  it('errores junto a cada campo: duración, tramos al revés o solapados y reglas', () => {
    expect(errors(bookingSettingsSchema, { ...base, defaultDuration: '100', maxOnlineParty: '0' })).toEqual({
      defaultDuration: 'De 30 minutos a 6 horas, en pasos de 15 minutos.',
      maxOnlineParty: 'Entre 1 y 50 personas.',
    });
    expect(errors(bookingSettingsSchema, { ...base, rule1_min: '4', rule1_max: '2', rule1_duration: '90' })).toEqual({
      rule1_max: 'El máximo no puede ser menor que el mínimo.',
    });
    expect(errors(bookingSettingsSchema, { ...base, rule1_min: '1', rule1_max: '4', rule1_duration: '90', rule2_min: '4', rule2_max: '6', rule2_duration: '120' })).toEqual({
      rule2_min: 'Se solapa con el tramo 1.',
    });
    expect(errors(bookingSettingsSchema, { ...base, rule1_min: '1', rule1_max: '', rule1_duration: '90' })).toEqual({ rule1_max: 'Entre 1 y 50 personas.' });
  });
});

describe('última reserva e intervalo de un servicio', () => {
  const cena = serviceBookingSchema({ startMinute: 1200, endMinute: 1470 });

  it('vacía = por defecto; después de medianoche, del día siguiente', () => {
    expect(cena.parse({ lastBooking: '', slotInterval: '15' })).toEqual({ lastBookingMinute: null, slotIntervalMin: 15 });
    expect(cena.parse({ lastBooking: '23:30', slotInterval: '30' })).toEqual({ lastBookingMinute: 1410, slotIntervalMin: 30 });
    expect(cena.parse({ lastBooking: '00:15', slotInterval: '15' })).toEqual({ lastBookingMinute: 1455, slotIntervalMin: 15 });
  });

  it('tiene que ser antes del cierre; el intervalo, 15 o 30', () => {
    expect(errors(cena, { lastBooking: '00:30', slotInterval: '15' })).toEqual({ lastBooking: 'La última reserva tiene que ser antes del cierre del servicio.' });
    expect(errors(cena, { lastBooking: '9', slotInterval: '15' })).toEqual({ lastBooking: 'Escribe la hora así: 21:30.' });
    expect(errors(cena, { lastBooking: '', slotInterval: '20' })).toEqual({ slotInterval: 'Elige cada 15 o cada 30 minutos.' });
  });
});

describe('reservas', () => {
  const phone = {
    date: '2030-06-14',
    time: '21:00',
    partySize: '4',
    duration: '',
    tableMode: 'auto',
    tableIds: [],
    name: ' Ana García ',
    phone: '612 34 56 78',
    email: ' Ana@Example.com ',
    notes: '',
    internalNotes: ' Cliente de la casa ',
  };

  it('por teléfono: normaliza el teléfono y el email, hora en minutos y duración automática', () => {
    expect(phoneReservationSchema.parse(phone)).toEqual({
      date: '2030-06-14',
      time: 1260,
      partySize: 4,
      duration: null,
      tableMode: 'auto',
      tableIds: [],
      name: 'Ana García',
      phone: '+34612345678',
      email: 'ana@example.com',
      notes: null,
      internalNotes: 'Cliente de la casa',
    });
  });

  it('por teléfono: errores en castellano', () => {
    expect(
      errors(phoneReservationSchema, { ...phone, date: '2030-02-30', time: '25:00', partySize: '0', duration: '20', name: '', phone: '12', email: 'x@' }),
    ).toEqual({
      date: 'Esa fecha no existe.',
      time: 'Escribe la hora así: 21:30.',
      partySize: 'Entre 1 y 50 personas.',
      duration: 'De 15 minutos a 12 horas, en pasos de 15 minutos.',
      name: 'Escribe el nombre de quien reserva.',
      phone: 'Ese teléfono no parece correcto. Si es de fuera, empieza por + y el prefijo.',
      email: 'Ese email no parece correcto.',
    });
  });

  it('mesas: a mano hace falta al menos una, ids válidos y como mucho 10', () => {
    expect(errors(phoneReservationSchema, { ...phone, tableMode: 'manual' })).toEqual({ tableIds: 'Elige al menos una mesa.' });
    expect(errors(phoneReservationSchema, { ...phone, tableMode: 'manual', tableIds: ['x'] })).toEqual({ tableIds: 'Elige las mesas de la lista.' });
    expect(phoneReservationSchema.parse({ ...phone, tableMode: 'manual', tableIds: [T1, T2] }).tableIds).toEqual([T1, T2]);
    expect(errors(phoneReservationSchema, { ...phone, tableMode: 'keep', tableIds: [T1] })).toEqual({ tableMode: 'Elige una mesa o guárdala sin mesa.' });
  });

  it('cambiar una reserva: sin datos del cliente, con «dejar las mesas»', () => {
    const edit = reservationEditSchema.parse({ ...phone, duration: '120', tableMode: 'keep', tableIds: [T1] });
    expect(edit).toMatchObject({ time: 1260, duration: 120, tableMode: 'keep', tableIds: [T1] });
    expect(edit).not.toHaveProperty('phone');
  });

  it('walk-in: personas, al menos una mesa y nombre opcional', () => {
    expect(walkInSchema.parse({ partySize: '3', tableIds: [T1], name: '' })).toEqual({ partySize: 3, tableIds: [T1], name: null });
    expect(errors(walkInSchema, { partySize: '3', tableIds: [], name: '' })).toEqual({ tableIds: 'Elige al menos una mesa.' });
  });
});

describe('bloqueos', () => {
  const block = { date: '2030-06-14', start: '13:00', end: '16:00', allDay: '', tableId: '', reason: '' };

  it('una franja de un día, de una mesa o de todo el restaurante', () => {
    expect(blockFormSchema.parse(block)).toEqual({ date: '2030-06-14', startMinute: 780, endMinute: 960, tableId: null, reason: null });
    expect(blockFormSchema.parse({ ...block, start: '22:00', end: '01:00', tableId: T1, reason: ' Avería ' })).toEqual({
      date: '2030-06-14',
      startMinute: 1320,
      endMinute: 1500,
      tableId: T1,
      reason: 'Avería',
    });
    expect(blockFormSchema.parse({ ...block, start: '', end: '', allDay: 'on' })).toMatchObject({ startMinute: 0, endMinute: 1440 });
  });

  it('errores', () => {
    expect(errors(blockFormSchema, { ...block, end: '13:00' })).toEqual({ end: 'Tiene que acabar después de empezar.' });
    expect(errors(blockFormSchema, { ...block, start: 'x' })).toEqual({ start: 'Escribe la hora así: 21:30.' });
    expect(errors(blockFormSchema, { ...block, tableId: 'x' })).toEqual({ tableId: 'Elige una mesa de la lista.' });
  });
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/reservations/validation.test.ts`
Expected: FAIL: `Failed to resolve import "./validation"`.

- [ ] **Step 3: Implementación**

Create `src/lib/reservations/validation.ts`:

```ts
import { z } from 'zod';
import { formStrings } from '@/lib/forms';
import { MINUTES_PER_DAY, timeToMinutes } from '@/lib/schedule';
import { isRealDate } from '@/lib/validation/schedule';
import { uuidSchema } from '@/lib/validation/schemas';
import { BOOKING_LIMITS, RESERVATION_STATUSES } from './codes';
import { normalizePhoneE164 } from './phone';
import { overlappingRules, type DurationRule } from './settings';

const REQUIRED = 'Este campo es obligatorio.';
const BAD_TIME = 'Escribe la hora así: 21:30.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = (max: number, message: string) => z.string().trim().max(max, message);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Como mucho ${max} caracteres.`)
    .transform((v) => (v === '' ? null : v));
const intIn = (min: number, max: number, message: string) =>
  z
    .string({ error: REQUIRED })
    .trim()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message));
const checkbox = z.string().transform((v) => v === 'on');

export const isoDateSchema = z
  .string({ error: REQUIRED })
  .trim()
  .regex(ISO_DATE, { message: 'Elige una fecha.', abort: true })
  .refine(isRealDate, 'Esa fecha no existe.');

const timeSchema = z
  .string({ error: REQUIRED })
  .trim()
  .refine((v) => timeToMinutes(v) !== null, BAD_TIME)
  .transform((v) => timeToMinutes(v) as number);

const partySizeSchema = intIn(1, BOOKING_LIMITS.partySize, `Entre 1 y ${BOOKING_LIMITS.partySize} personas.`);

// Zonas y mesas ---------------------------------------------------------------------------------------------
const positionSchema = intIn(0, 999, 'Pon un número del 0 al 999.');

export const zoneFormSchema = z.object({
  name: trimmed(40, 'El nombre puede tener como mucho 40 caracteres.').min(1, 'Ponle nombre a la zona (por ejemplo, Terraza).'),
  position: positionSchema,
});

export const tableFormSchema = z
  .object({
    zoneId: z.string().trim(),
    name: trimmed(20, 'El nombre puede tener como mucho 20 caracteres.').min(1, 'Ponle nombre a la mesa (por ejemplo, T4).'),
    minCapacity: intIn(1, 50, 'Entre 1 y 50 personas.'),
    maxCapacity: intIn(1, 50, 'Entre 1 y 50 personas.'),
    position: positionSchema,
    onlineBookable: checkbox,
    active: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.zoneId !== '' && !uuidSchema.safeParse(v.zoneId).success) {
      ctx.addIssue({ code: 'custom', path: ['zoneId'], message: 'Elige una zona.' });
    }
    if (v.minCapacity > v.maxCapacity) {
      ctx.addIssue({ code: 'custom', path: ['minCapacity'], message: 'El mínimo no puede ser mayor que el máximo.' });
    }
  })
  .transform((v) => ({ ...v, zoneId: v.zoneId === '' ? null : v.zoneId }));

export const TABLE_FORM_FIELDS = ['zoneId', 'name', 'minCapacity', 'maxCapacity', 'position', 'onlineBookable', 'active'] as const;

// Ajustes de reserva -----------------------------------------------------------------------------------------
export const RULE_ROWS = [1, 2, 3, 4, 5, 6] as const;
const DURATION_MESSAGE = 'De 30 minutos a 6 horas, en pasos de 15 minutos.';
const durationSchema = intIn(30, 360, DURATION_MESSAGE).refine((v) => v % 15 === 0, DURATION_MESSAGE);

export function readSettingsForm(fd: FormData): Record<string, string> {
  const keys = [
    'defaultDuration',
    'minAdvanceMin',
    'maxAdvanceDays',
    'maxOnlineParty',
    'cancelLimitHours',
    'autoConfirm',
    ...RULE_ROWS.flatMap((n) => [`rule${n}_min`, `rule${n}_max`, `rule${n}_duration`]),
  ];
  return formStrings(fd, keys);
}

/** Ajustes: duración por defecto, hasta 6 tramos (filas vacías se ignoran) y las reglas de la reserva online. */
export const bookingSettingsSchema = z
  .record(z.string(), z.string())
  .transform((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const num = (key: string, schema: z.ZodType<number>): number | null => {
      const r = schema.safeParse(v[key] ?? '');
      if (!r.success) {
        issue(key, r.error.issues[0]?.message ?? REQUIRED);
        return null;
      }
      return r.data;
    };
    const defaultDuration = num('defaultDuration', durationSchema);
    const minAdvanceMin = num('minAdvanceMin', intIn(0, 10080, 'De 0 a 10080 minutos (una semana).'));
    const maxAdvanceDays = num('maxAdvanceDays', intIn(1, 365, 'De 1 a 365 días.'));
    const maxOnlineParty = num('maxOnlineParty', intIn(1, 50, 'Entre 1 y 50 personas.'));
    const cancelLimitHours = num('cancelLimitHours', intIn(0, 168, 'De 0 a 168 horas (una semana).'));
    const rules: (DurationRule & { row: number })[] = [];
    for (const n of RULE_ROWS) {
      const keys = [`rule${n}_min`, `rule${n}_max`, `rule${n}_duration`];
      if (keys.every((k) => (v[k] ?? '').trim() === '')) continue;
      const minParty = num(keys[0], partySizeSchema);
      const maxParty = num(keys[1], partySizeSchema);
      const durationMin = num(keys[2], durationSchema);
      if (minParty === null || maxParty === null || durationMin === null) continue;
      if (minParty > maxParty) {
        issue(keys[1], 'El máximo no puede ser menor que el mínimo.');
        continue;
      }
      rules.push({ minParty, maxParty, durationMin, row: n });
    }
    const clash = overlappingRules(rules);
    if (clash) issue(`rule${rules[clash[1]].row}_min`, `Se solapa con el tramo ${rules[clash[0]].row}.`);
    if (defaultDuration === null || minAdvanceMin === null || maxAdvanceDays === null || maxOnlineParty === null || cancelLimitHours === null || clash) {
      return z.NEVER;
    }
    return {
      defaultDurationMin: defaultDuration,
      durationRules: rules.map(({ minParty, maxParty, durationMin }) => ({ minParty, maxParty, durationMin })),
      minAdvanceMin,
      maxAdvanceDays,
      maxOnlineParty,
      cancelLimitHours,
      autoConfirm: v.autoConfirm === 'on',
    };
  });

// Servicios: última hora de reserva e intervalo -----------------------------------------------------------------
/**
 * Campos del Hito 4A de un servicio (ya validadas sus horas): la última reserva (vacía = una hora antes del cierre)
 * tiene que caer dentro del servicio; si es anterior al inicio, es de después de medianoche.
 */
export function serviceBookingSchema(range: { startMinute: number; endMinute: number }) {
  return z
    .object({ lastBooking: z.string().trim(), slotInterval: z.string().trim() })
    .transform((v, ctx) => {
      let lastBookingMinute: number | null = null;
      if (v.lastBooking !== '') {
        const m = timeToMinutes(v.lastBooking);
        if (m === null) {
          ctx.addIssue({ code: 'custom', path: ['lastBooking'], message: BAD_TIME });
          return z.NEVER;
        }
        const minute = m < range.startMinute ? m + MINUTES_PER_DAY : m;
        if (minute >= range.endMinute) {
          ctx.addIssue({ code: 'custom', path: ['lastBooking'], message: 'La última reserva tiene que ser antes del cierre del servicio.' });
          return z.NEVER;
        }
        lastBookingMinute = minute;
      }
      if (v.slotInterval !== '15' && v.slotInterval !== '30') {
        ctx.addIssue({ code: 'custom', path: ['slotInterval'], message: 'Elige cada 15 o cada 30 minutos.' });
        return z.NEVER;
      }
      return { lastBookingMinute, slotIntervalMin: Number(v.slotInterval) as 15 | 30 };
    });
}

// Reservas ------------------------------------------------------------------------------------------------------
export const TABLE_MODES = ['auto', 'manual', 'none', 'keep'] as const;
export type TableMode = (typeof TABLE_MODES)[number];

/** Lo que llega de los formularios de reserva (los campos que falten llegan como ''). */
export function readReservationForm(fd: FormData) {
  return {
    ...formStrings(fd, ['date', 'time', 'partySize', 'duration', 'tableMode', 'name', 'phone', 'email', 'notes', 'internalNotes']),
    tableIds: fd.getAll('tableIds').filter((v): v is string => typeof v === 'string'),
  };
}

const reservationBase = {
  date: isoDateSchema,
  time: timeSchema,
  partySize: partySizeSchema,
  duration: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 15 && Number(v) <= 720 && Number(v) % 15 === 0), 'De 15 minutos a 12 horas, en pasos de 15 minutos.')
    .transform((v) => (v === '' ? null : Number(v))),
  tableMode: z.enum(TABLE_MODES, { error: 'Elige una mesa o guárdala sin mesa.' }),
  tableIds: z.array(z.string()),
  notes: optionalText(BOOKING_LIMITS.notes),
  internalNotes: optionalText(BOOKING_LIMITS.notes),
};

function checkTables(v: { tableMode: TableMode; tableIds: string[] }, ctx: z.RefinementCtx) {
  const ids = [...new Set(v.tableIds)];
  if (!ids.every((id) => uuidSchema.safeParse(id).success)) {
    ctx.addIssue({ code: 'custom', path: ['tableIds'], message: 'Elige las mesas de la lista.' });
  } else if ((v.tableMode === 'manual' || v.tableMode === 'keep') && ids.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['tableIds'], message: 'Elige al menos una mesa.' });
  } else if (ids.length > BOOKING_LIMITS.tablesPerReservation) {
    ctx.addIssue({ code: 'custom', path: ['tableIds'], message: `Como mucho ${BOOKING_LIMITS.tablesPerReservation} mesas por reserva.` });
  }
}

/** Nueva reserva por teléfono: con el cliente (teléfono obligatorio, normalizado a E.164). */
export const phoneReservationSchema = z
  .object({
    ...reservationBase,
    name: trimmed(120, 'El nombre puede tener como mucho 120 caracteres.').min(1, 'Escribe el nombre de quien reserva.'),
    phone: z
      .string({ error: REQUIRED })
      .trim()
      .min(1, 'Escribe un teléfono de contacto.')
      .transform((v, ctx) => {
        const phone = normalizePhoneE164(v);
        if (!phone) {
          ctx.addIssue({ code: 'custom', message: 'Ese teléfono no parece correcto. Si es de fuera, empieza por + y el prefijo.' });
          return z.NEVER;
        }
        return phone;
      }),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v, ctx) => {
        if (v === '') return null;
        if (!z.email().safeParse(v).success) {
          ctx.addIssue({ code: 'custom', message: 'Ese email no parece correcto.' });
          return z.NEVER;
        }
        return v;
      }),
  })
  .superRefine(checkTables)
  .refine((v) => v.tableMode !== 'keep', { path: ['tableMode'], message: 'Elige una mesa o guárdala sin mesa.' });

/** Cambiar una reserva: hora, personas, duración, mesas y notas (el cliente no cambia aquí). */
export const reservationEditSchema = z.object(reservationBase).superRefine(checkTables);

/** Walk-in: personas, una o varias mesas libres y el nombre si lo dan. */
export const walkInSchema = z
  .object({
    partySize: partySizeSchema,
    tableIds: z.array(z.string()),
    name: optionalText(120),
  })
  .superRefine((v, ctx) => checkTables({ tableMode: 'manual', tableIds: v.tableIds }, ctx));

// Bloqueos ------------------------------------------------------------------------------------------------------
/** Bloqueo de una mesa o de todo el restaurante en una franja de un día (si acaba antes de empezar, al día siguiente). */
export const blockFormSchema = z
  .object({
    date: isoDateSchema,
    start: z.string().trim(),
    end: z.string().trim(),
    allDay: checkbox,
    tableId: z.string().trim(),
    reason: optionalText(BOOKING_LIMITS.blockReason),
  })
  .transform((v, ctx) => {
    if (v.tableId !== '' && !uuidSchema.safeParse(v.tableId).success) {
      ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Elige una mesa de la lista.' });
      return z.NEVER;
    }
    let startMinute = 0;
    let endMinute = MINUTES_PER_DAY;
    if (!v.allDay) {
      const s = timeToMinutes(v.start);
      const e = timeToMinutes(v.end);
      if (s === null) ctx.addIssue({ code: 'custom', path: ['start'], message: BAD_TIME });
      if (e === null) ctx.addIssue({ code: 'custom', path: ['end'], message: BAD_TIME });
      if (s === null || e === null) return z.NEVER;
      if (s === e) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'Tiene que acabar después de empezar.' });
        return z.NEVER;
      }
      startMinute = s;
      endMinute = e < s ? e + MINUTES_PER_DAY : e;
    }
    return { date: v.date, startMinute, endMinute, tableId: v.tableId === '' ? null : v.tableId, reason: v.reason };
  });

export const BLOCK_FORM_FIELDS = ['date', 'start', 'end', 'allDay', 'tableId', 'reason'] as const;

export const statusSchema = z.enum(RESERVATION_STATUSES);
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm vitest run --project unit src/lib/reservations && pnpm test:unit`
Expected: 13 pruebas nuevas en verde; `test:unit` → **414** (57 archivos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservations/validation.ts src/lib/reservations/validation.test.ts
git commit -m "Reservas: validación de zonas, mesas, ajustes, servicios, reservas, walk-ins y bloqueos"
```

---

### Task 10: Errores de BD, navegación, paso «Mesas» del asistente y acciones solo del panel

**Files:**
- Modify: `src/lib/db-errors.ts`, `src/lib/db-errors.test.ts`, `src/lib/panel-nav.ts`, `src/lib/panel-nav.test.ts`, `src/lib/onboarding.ts`, `src/lib/onboarding.test.ts`, `src/lib/actions/run.ts`, `src/app/panel/[restaurantId]/page.tsx`

**Interfaces:**
- Consumes: `countTables` (Task 8); códigos de error de las Tasks 1 y 2.
- Produces: `mapDbError` traduce `SLOT_TAKEN`/`reservation_tables_no_overlap`, `NO_TABLE_AVAILABLE`, `TABLE_TOO_SMALL`, `TABLE_BLOCKED`, `TABLE_INACTIVE`, `INVALID_TRANSITION`, `NOTHING_TO_UNDO`, `RESERVATION_CLOSED`, `ZONE_LIMIT`, `TABLE_LIMIT`, `TABLE_HAS_RESERVATIONS`, la FK de zona con mesas, `tables_name_key`, `zones_name_key`, `tables_capacity_check`, `services_last_booking_check`, `booking_settings_duration_rules_check`, `customers_phone_check` y `customers_email_check`; `panelNav` gana «Reservas» (`/reservas`, `reservations.manage`) después de «Inicio»; `OnboardingInput.tablesCount: number` y el paso `tables` («Mesas», `/reservas/ajustes#mesas`, no bloquea publicar); `runPanelAction(…, { publicData?: boolean })`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`.

- [ ] **Step 1: Pruebas (fallan)**

In `src/lib/db-errors.test.ts`, replace:

```ts
  ['new row for relation "dishes" violates check constraint "dishes_names_check"', 'Falta el nombre en castellano o algún texto es demasiado largo.'],
])
```

with:

```ts
  ['new row for relation "dishes" violates check constraint "dishes_names_check"', 'Falta el nombre en castellano o algún texto es demasiado largo.'],
  ['SLOT_TAKEN', 'Vaya, esa mesa se acaba de ocupar a esa hora. Elige otra o guárdala sin mesa.'],
  ['conflicting key value violates exclusion constraint "reservation_tables_no_overlap"', 'Vaya, esa mesa se acaba de ocupar a esa hora. Elige otra o guárdala sin mesa.'],
  ['NO_TABLE_AVAILABLE', 'No queda ninguna mesa libre para ese grupo a esa hora. Prueba otra hora, elige mesas a mano o guárdala sin mesa.'],
  ['TABLE_TOO_SMALL', 'En esas mesas no caben todos: añade otra mesa o elige una más grande.'],
  ['TABLE_BLOCKED', 'Esa mesa está bloqueada a esa hora.'],
  ['TABLE_INACTIVE', 'Esa mesa está desactivada. Elige otra.'],
  ['INVALID_TRANSITION', 'Ese cambio de estado ya no se puede hacer. Recarga para ver cómo está la reserva.'],
  ['NOTHING_TO_UNDO', 'No hay nada que deshacer en esta reserva.'],
  ['RESERVATION_CLOSED', 'Esta reserva ya está cerrada: no se puede cambiar.'],
  ['ZONE_LIMIT', 'Ya tienes 20 zonas. Borra alguna para crear otra.'],
  ['TABLE_LIMIT', 'Ya tienes 100 mesas. Borra las que no uses para crear otras.'],
  ['TABLE_HAS_RESERVATIONS', 'Esta mesa tiene reservas por delante. Desactívala en lugar de borrarla.'],
  ['update or delete on table "zones" violates foreign key constraint "tables_zone_id_restaurant_id_fkey" on table "tables"', 'Esta zona tiene mesas. Pásalas a otra zona o bórralas antes.'],
  ['duplicate key value violates unique constraint "tables_name_key"', 'Ya tienes una mesa con ese nombre.'],
  ['duplicate key value violates unique constraint "zones_name_key"', 'Ya tienes una zona con ese nombre.'],
  ['new row for relation "tables" violates check constraint "tables_capacity_check"', 'El mínimo de personas no puede ser mayor que el máximo.'],
  ['new row for relation "services" violates check constraint "services_last_booking_check"', 'La última reserva tiene que caer dentro del servicio.'],
  ['new row for relation "booking_settings" violates check constraint "booking_settings_duration_rules_check"', 'Revisa los tramos de duración: no pueden solaparse.'],
  ['new row for relation "customers" violates check constraint "customers_phone_check"', 'Ese teléfono no parece correcto.'],
  ['new row for relation "customers" violates check constraint "customers_email_check"', 'Ese email no parece correcto.'],
])
```

Replace `src/lib/panel-nav.test.ts` with:

```ts
import { expect, it } from 'vitest';
import { panelNav } from './panel-nav';

const id = '11111111-1111-1111-1111-111111111111';

it('el administrador ve Inicio, Reservas, Local, Menú, Horario y Equipo', () => {
  expect(panelNav(id, 'admin')).toEqual([
    { href: `/panel/${id}`, label: 'Inicio' },
    { href: `/panel/${id}/reservas`, label: 'Reservas' },
    { href: `/panel/${id}/local`, label: 'Local' },
    { href: `/panel/${id}/menu`, label: 'Menú' },
    { href: `/panel/${id}/horario`, label: 'Horario' },
    { href: `/panel/${id}/usuarios`, label: 'Equipo' },
  ]);
});

it('el encargado ve Reservas, Menú y Horario, pero no Local ni Equipo', () => {
  expect(panelNav(id, 'manager').map((i) => i.label)).toEqual(['Inicio', 'Reservas', 'Menú', 'Horario']);
});

it('sala ve Inicio, Reservas y Menú (para marcar agotados)', () => {
  expect(panelNav(id, 'staff').map((i) => i.label)).toEqual(['Inicio', 'Reservas', 'Menú']);
});
```

Replace `src/lib/onboarding.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { missingFieldLabels, missingFieldLinks, onboardingSteps, type OnboardingInput } from './onboarding';

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
  tablesCount: 0,
  enabledLocales: ['es'],
  descriptionLocales: [],
};

describe('onboardingSteps', () => {
  it('seis pasos en orden, ninguno hecho al empezar', () => {
    const steps = onboardingSteps(id, empty);
    expect(steps.map((s) => s.title)).toEqual(['Datos básicos', 'Logo y portada', 'Horario', 'Mesas', 'Idiomas', 'Publicar']);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[2].href).toBe(`/panel/${id}/horario`);
    expect(steps[3].href).toBe(`/panel/${id}/reservas/ajustes#mesas`);
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
      tablesCount: 6,
      enabledLocales: ['es', 'en'],
      descriptionLocales: ['es', 'en'],
      status: 'active',
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('Mesas se marca con la primera mesa y no hace falta para publicar', () => {
    const steps = onboardingSteps(id, { ...empty, tablesCount: 1 });
    expect(steps.find((s) => s.key === 'tables')?.done).toBe(true);
    expect(onboardingSteps(id, { ...empty, status: 'active' }).find((s) => s.key === 'publish')?.done).toBe(true);
  });

  it('Idiomas no está hecho si falta la descripción de algún idioma activo', () => {
    const steps = onboardingSteps(id, { ...empty, enabledLocales: ['es', 'en'], descriptionLocales: ['es'] });
    expect(steps.find((s) => s.key === 'languages')?.done).toBe(false);
  });
});

it('missingFieldLabels traduce los códigos de la BD', () => {
  expect(missingFieldLabels(['contact', 'tax_id', 'otro'])).toEqual(['Teléfono o email de contacto', 'CIF o NIF (datos fiscales)', 'otro']);
});

it('missingFieldLinks enlaza cada dato que falta a su sección del panel', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  expect(missingFieldLinks(id, ['address_line', 'contact', 'services', 'tax_id', 'otro'])).toEqual([
    { code: 'address_line', label: 'Calle y número', href: `/panel/${id}/local#contacto` },
    { code: 'contact', label: 'Teléfono o email de contacto', href: `/panel/${id}/local#contacto` },
    { code: 'services', label: 'Al menos un servicio en el horario', href: `/panel/${id}/horario` },
    { code: 'tax_id', label: 'CIF o NIF (datos fiscales)', href: `/panel/${id}/local#datos-fiscales` },
    { code: 'otro', label: 'otro', href: `/panel/${id}/local` },
  ]);
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/db-errors.test.ts src/lib/panel-nav.test.ts src/lib/onboarding.test.ts`
Expected: FAIL: los 20 códigos nuevos dan el mensaje genérico, falta «Reservas» en la navegación y el asistente tiene 5 pasos.

- [ ] **Step 3: Implementación**

In `src/lib/db-errors.ts`, replace the last rule and the closing of `RULES`:

```ts
  [/(dishes|menus|menu_sections)_names_check|menu_items_inline_names_check/, 'Falta el nombre en castellano o algún texto es demasiado largo.'],
];
```

with:

```ts
  [/(dishes|menus|menu_sections)_names_check|menu_items_inline_names_check/, 'Falta el nombre en castellano o algún texto es demasiado largo.'],
  // Hito 4A: reservas
  [/SLOT_TAKEN|reservation_tables_no_overlap/, 'Vaya, esa mesa se acaba de ocupar a esa hora. Elige otra o guárdala sin mesa.'],
  [/NO_TABLE_AVAILABLE/, 'No queda ninguna mesa libre para ese grupo a esa hora. Prueba otra hora, elige mesas a mano o guárdala sin mesa.'],
  [/TABLE_TOO_SMALL/, 'En esas mesas no caben todos: añade otra mesa o elige una más grande.'],
  [/TABLE_BLOCKED/, 'Esa mesa está bloqueada a esa hora.'],
  [/TABLE_INACTIVE/, 'Esa mesa está desactivada. Elige otra.'],
  [/INVALID_TRANSITION/, 'Ese cambio de estado ya no se puede hacer. Recarga para ver cómo está la reserva.'],
  [/NOTHING_TO_UNDO/, 'No hay nada que deshacer en esta reserva.'],
  [/RESERVATION_CLOSED/, 'Esta reserva ya está cerrada: no se puede cambiar.'],
  [/ZONE_LIMIT/, 'Ya tienes 20 zonas. Borra alguna para crear otra.'],
  [/TABLE_LIMIT/, 'Ya tienes 100 mesas. Borra las que no uses para crear otras.'],
  [/TABLE_HAS_RESERVATIONS/, 'Esta mesa tiene reservas por delante. Desactívala en lugar de borrarla.'],
  [/update or delete on table "zones"/, 'Esta zona tiene mesas. Pásalas a otra zona o bórralas antes.'],
  [/tables_name_key/, 'Ya tienes una mesa con ese nombre.'],
  [/zones_name_key/, 'Ya tienes una zona con ese nombre.'],
  [/tables_capacity_check/, 'El mínimo de personas no puede ser mayor que el máximo.'],
  [/services_last_booking_check/, 'La última reserva tiene que caer dentro del servicio.'],
  [/booking_settings_duration_rules_check/, 'Revisa los tramos de duración: no pueden solaparse.'],
  [/customers_phone_check/, 'Ese teléfono no parece correcto.'],
  [/customers_email_check/, 'Ese email no parece correcto.'],
];
```

Replace `src/lib/panel-nav.ts` with:

```ts
import { can, type Permission, type Role } from './permissions';

export type NavItem = { href: string; label: string };

// Cada hito añade aquí sus secciones (Local, Menú, Reservas, Clientes, Estadísticas).
const ITEMS: { path: string; label: string; permission: Permission | null }[] = [
  { path: '', label: 'Inicio', permission: null },
  { path: '/reservas', label: 'Reservas', permission: 'reservations.manage' },
  { path: '/local', label: 'Local', permission: 'restaurant.edit' },
  // Sala también entra: ahí marca los platos agotados.
  { path: '/menu', label: 'Menú', permission: 'menu.toggle_unavailable' },
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

Replace `src/lib/onboarding.ts` with:

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
  tablesCount: number;
  enabledLocales: string[];
  descriptionLocales: string[];
};

export type OnboardingStepKey = 'basics' | 'images' | 'schedule' | 'tables' | 'languages' | 'publish';
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
      key: 'tables',
      title: 'Mesas',
      hint: 'Crea tus mesas para llevar las reservas desde el panel. No hace falta para publicar.',
      href: `${base}/reservas/ajustes#mesas`,
      done: i.tablesCount > 0,
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

/** Sección del panel donde se rellena cada dato que falta (ruta relativa a /panel/<id>). */
const MISSING_FIELD_SECTIONS: Record<string, string> = {
  address_line: '/local#contacto',
  postal_code: '/local#contacto',
  city: '/local#contacto',
  contact: '/local#contacto',
  services: '/horario',
  legal_name: '/local#datos-fiscales',
  tax_id: '/local#datos-fiscales',
};

export type MissingFieldLink = { code: string; label: string; href: string };

/** Lo que falta para publicar, cada dato con el enlace a su sección. */
export function missingFieldLinks(restaurantId: string, codes: string[]): MissingFieldLink[] {
  return codes.map((code) => ({
    code,
    label: MISSING_FIELD_LABELS[code] ?? code,
    href: `/panel/${restaurantId}${MISSING_FIELD_SECTIONS[code] ?? '/local'}`,
  }));
}
```

Replace `src/lib/actions/run.ts` with:

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
export function refreshRestaurant(_restaurantId: string, slug: string, allPublic = false): void {
  updateTag(publicRestaurantTag(slug));
  if (allPublic) updateTag(PUBLIC_ALL_TAG);
  revalidatePath('/panel/[restaurantId]', 'layout');
}

/**
 * Esqueleto de las acciones del panel: comprueba permiso (no en modo soporte ni con el restaurante desactivado),
 * ejecuta fn con la sesión del usuario (RLS) y, si va bien, refresca.
 * publicData: false → lo que cambia no sale en la web (reservas, mesas, ajustes): solo se refresca el panel.
 */
export async function runPanelAction(
  restaurantId: string,
  permission: Permission,
  fn: (supabase: SupabaseServerClient, ctx: PanelContext) => Promise<FormState>,
  opts: { allPublic?: boolean; publicData?: boolean } = {},
): Promise<FormState> {
  if (!uuidSchema.safeParse(restaurantId).success) return { error: mapDbError('FORBIDDEN') };
  try {
    const ctx = await requirePermission(restaurantId, permission);
    const supabase = await createClient();
    const result = await fn(supabase, ctx);
    if (!result.error && !result.fieldErrors) {
      if (opts.publicData === false) revalidatePath('/panel/[restaurantId]', 'layout');
      else refreshRestaurant(restaurantId, ctx.restaurant.slug, opts.allPublic);
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    const mapped = mapDbError(e instanceof Error ? e.message : undefined);
    if (mapped === mapDbError(undefined)) console.error('[panel-action]', e);
    return { error: mapped };
  }
}

/** Para acciones de formulario sin estado (botones Quitar, Subir/Bajar): si algo falla, lo recoge error.tsx. */
export function throwIfError(result: FormState): void {
  if (result.error) throw new Error(result.error);
}
```

Replace `src/app/panel/[restaurantId]/page.tsx` with (pasa `tablesCount` al asistente y enlaza a las reservas de hoy):

```tsx
import Link from 'next/link';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { PublishCard } from '@/components/onboarding/PublishCard';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { getMissingFields, getRestaurantLocal, getRestaurantSchedule } from '@/lib/local/data';
import { missingFieldLinks, onboardingSteps, type MissingFieldLink } from '@/lib/onboarding';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { countTables } from '@/lib/reservations/data';

export default async function PanelHome({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId);
  const { status, slug } = ctx.restaurant;
  const canEdit = can(ctx.role, 'restaurant.edit');

  let setup: { steps: ReturnType<typeof onboardingSteps>; missing: MissingFieldLink[] } | null = null;
  if (status === 'setup' && canEdit) {
    const [{ profile, descriptions }, { services }, missing, tablesCount] = await Promise.all([
      getRestaurantLocal(restaurantId),
      getRestaurantSchedule(restaurantId),
      getMissingFields(restaurantId),
      countTables(restaurantId),
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
        tablesCount,
        enabledLocales: profile.enabledLocales,
        descriptionLocales: Object.keys(descriptions),
      }),
      missing: missingFieldLinks(restaurantId, missing),
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
          Entras como <strong>{ROLE_LABELS[ctx.role]}</strong>.{' '}
          <Link href={`/panel/${restaurantId}/reservas`} className="font-bold text-navy hover:underline">
            Ver las reservas de hoy
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: `test:unit` → **435** (57 archivos); sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db-errors.ts src/lib/db-errors.test.ts src/lib/panel-nav.ts src/lib/panel-nav.test.ts src/lib/onboarding.ts src/lib/onboarding.test.ts src/lib/actions/run.ts "src/app/panel/[restaurantId]/page.tsx"
git commit -m "Reservas: mensajes de error, sección Reservas, paso Mesas del asistente y acciones que solo refrescan el panel"
```

---

### Task 11: Server actions de reservas

**Files:**
- Create: `src/lib/actions/reservations.ts`
- Test: `src/lib/actions/reservations.test.ts`

**Interfaces:**
- Consumes: `runPanelAction(…, { publicData: false })` (Task 10); `requirePermission`; `loadBookingConfig`, `type BookingConfig` (Task 8); `resolveMinute`, `servicesForDate` (Task 5); `zonedTimeToUtc` (Task 4); `durationFor` (Task 4); `normalizePhoneE164` (Task 3); `customerWarnings`, `type CustomerWarning` (Task 8); `phoneReservationSchema`, `reservationEditSchema`, `walkInSchema`, `statusSchema`, `readReservationForm`, `type TableMode` (Task 9); funciones de BD de la Task 2.
- Produces (todas `'use server'`):
  - `createPhoneReservation(prev: FormState, fd: FormData): Promise<FormState>` → `redirect('/panel/<id>/reservas?fecha=<fecha>&aviso=creada')`.
  - `updateReservation(prev, fd)` (campo `reservationId`) → `redirect('/panel/<id>/reservas/<reservationId>?aviso=guardada')`.
  - `createWalkIn(prev, fd)` (`partySize`, `tableIds[]`, `name`) → `redirect('/panel/<id>/reservas?aviso=walk-in')`.
  - `changeReservationStatus(restaurantId, reservationId, status: string): Promise<FormState>`, `undoReservationStatus(restaurantId, reservationId): Promise<FormState>`.
  - `type CustomerLookup = { customer: { name; email; warnings: CustomerWarning[] } | null; error?: string }`, `lookupCustomer(restaurantId, phone): Promise<CustomerLookup>`.
  - Campos de formulario: `restaurantId`, `reservationId`, `date`, `time`, `partySize`, `duration`, `tableMode` (`auto` → `p_table_ids: null`; `manual`/`keep` → las mesas sin repetir; `none` → `p_force: true`), `tableIds`, `name`, `phone`, `email`, `notes`, `internalNotes`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` y `unstable_rethrow.md`.

- [ ] **Step 1: Pruebas (fallan)**

Create `src/lib/actions/reservations.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapDbError } from '@/lib/db-errors';
import type { BookingConfig } from '@/lib/reservations/data';
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/reservations/settings';

const R = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';

const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(
  async () => ({ data: { id: ID, table_ids: [T1] }, error: null }),
);
const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url), unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('./run', () => ({
  runPanelAction: vi.fn(async (_r: string, _p: string, fn: (supabase: unknown) => unknown) => fn({ rpc })),
}));
const config: BookingConfig = {
  timezone: 'Europe/Madrid',
  zones: [],
  tables: [],
  settings: { ...DEFAULT_BOOKING_SETTINGS, durationRules: [{ minParty: 1, maxParty: 2, durationMin: 60 }] },
  services: [{ name: 'Cena', weekday: 5, startMinute: 1230, endMinute: 1470, lastBookingMinute: null, slotIntervalMin: 15 }],
  exceptions: [],
};
vi.mock('@/lib/reservations/data', () => ({ loadBookingConfig: vi.fn(async () => config) }));

const { changeReservationStatus, createPhoneReservation, undoReservationStatus, updateReservation } = await import('./reservations');

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}

const phoneForm = {
  restaurantId: R,
  date: '2030-06-14',
  time: '21:00',
  partySize: '2',
  duration: '',
  tableMode: 'auto',
  name: 'Ana',
  phone: '612345678',
  email: '',
  notes: '',
  internalNotes: '',
};

beforeEach(() => {
  rpc.mockClear();
  redirect.mockClear();
});

describe('createPhoneReservation', () => {
  it('mesa propuesta: sin mesas ni forzar; teléfono en E.164; vuelve al día', async () => {
    await createPhoneReservation({}, form(phoneForm));
    expect(rpc).toHaveBeenCalledWith('create_panel_reservation', {
      p_restaurant_id: R,
      p_starts_at: '2030-06-14T19:00:00.000Z',
      p_duration_min: null,
      p_party_size: 2,
      p_table_ids: null,
      p_force: false,
      p_customer_name: 'Ana',
      p_customer_phone: '+34612345678',
      p_customer_email: null,
      p_notes: null,
      p_internal_notes: null,
    });
    expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas?fecha=2030-06-14&aviso=creada`);
  });

  it('mesas elegidas, forzar sin mesa y la madrugada de la cena', async () => {
    await createPhoneReservation({}, form({ ...phoneForm, tableMode: 'manual', tableIds: [T1, T1] }));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_table_ids: [T1], p_force: false });
    await createPhoneReservation({}, form({ ...phoneForm, tableMode: 'none', time: '00:15' }));
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_table_ids: null, p_force: true, p_starts_at: '2030-06-14T22:15:00.000Z' });
  });

  it('si la BD dice que la mesa se ha ocupado, no redirige y lo explica', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'SLOT_TAKEN' } });
    expect(await createPhoneReservation({}, form(phoneForm))).toEqual({ error: mapDbError('SLOT_TAKEN') });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('errores de campo sin llegar a la BD', async () => {
    const result = await createPhoneReservation({}, form({ ...phoneForm, phone: '12' }));
    expect(result.fieldErrors?.phone).toMatch(/teléfono/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

it('updateReservation: duración vacía = la del tramo; «dejar las mesas» manda las actuales', async () => {
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1] }));
  expect(rpc).toHaveBeenCalledWith('update_panel_reservation', expect.objectContaining({ p_reservation_id: ID, p_duration_min: 60, p_table_ids: [T1], p_force: false }));
  expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas/${ID}?aviso=guardada`);
});

describe('estados', () => {
  it('un estado que no existe (tampoco los heredados) no llega a la BD', async () => {
    for (const status of ['toString', 'seated2', '']) {
      expect(await changeReservationStatus(R, ID, status)).toEqual({ error: mapDbError('INVALID_INPUT') });
    }
    expect(await changeReservationStatus(R, 'no-es-uuid', 'seated')).toEqual({ error: mapDbError('INVALID_INPUT') });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cambia y deshace con el restaurante y la reserva', async () => {
    expect(await changeReservationStatus(R, ID, 'seated')).toEqual({ success: 'Hecho: En mesa.' });
    expect(rpc).toHaveBeenCalledWith('set_reservation_status', { p_restaurant_id: R, p_reservation_id: ID, p_status: 'seated' });
    rpc.mockResolvedValueOnce({ data: 'confirmed', error: null });
    expect(await undoReservationStatus(R, ID)).toEqual({ success: 'Deshecho: vuelve a «Confirmada».' });
  });
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `pnpm vitest run --project unit src/lib/actions/reservations.test.ts`
Expected: FAIL: `Failed to resolve import "./reservations"`.

- [ ] **Step 3: Implementación**

Create `src/lib/actions/reservations.ts`:

```ts
'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { STATUS_LABELS_ES } from '@/lib/reservations/codes';
import { customerWarnings, type CustomerWarning } from '@/lib/reservations/customers';
import { loadBookingConfig, type BookingConfig } from '@/lib/reservations/data';
import { resolveMinute, servicesForDate } from '@/lib/reservations/day';
import { normalizePhoneE164 } from '@/lib/reservations/phone';
import { durationFor } from '@/lib/reservations/settings';
import { zonedTimeToUtc } from '@/lib/reservations/time';
import { phoneReservationSchema, readReservationForm, reservationEditSchema, statusSchema, walkInSchema, type TableMode } from '@/lib/reservations/validation';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction } from './run';

// Las reservas no salen en la web pública: solo se refresca el panel.
const PANEL_ONLY = { publicData: false };
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidSchema.safeParse(value).success;

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

/** Fecha y hora del formulario → instante (la madrugada de una cena que pasa de medianoche es de esa noche). */
function startsAtFor(config: BookingConfig, date: string, minute: number): string {
  const services = servicesForDate(date, config.services, config.exceptions);
  return new Date(zonedTimeToUtc(date, resolveMinute(minute, services), config.timezone)).toISOString();
}

/** Modo de mesa del formulario → argumentos de la BD: la propuesta (null), las elegidas o forzar sin mesa. */
function tableArgs(mode: TableMode, tableIds: string[]): { p_table_ids: string[] | null; p_force: boolean } {
  if (mode === 'none') return { p_table_ids: null, p_force: true };
  if (mode === 'auto') return { p_table_ids: null, p_force: false };
  return { p_table_ids: [...new Set(tableIds)], p_force: false };
}

function createdId(data: unknown): string {
  const id = (data as { id?: unknown } | null)?.id;
  return isUuid(id) ? id : '';
}

/** Nueva reserva por teléfono: nace confirmada. Si va bien, vuelve a la vista del día. */
export async function createPhoneReservation(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = phoneReservationSchema.safeParse(readReservationForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const created = { id: '' };
  const result = await runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const config = await loadBookingConfig(supabase, restaurantId);
      const { data, error } = await supabase.rpc('create_panel_reservation', {
        p_restaurant_id: restaurantId,
        p_starts_at: startsAtFor(config, d.date, d.time),
        p_duration_min: d.duration,
        p_party_size: d.partySize,
        ...tableArgs(d.tableMode, d.tableIds),
        p_customer_name: d.name,
        p_customer_phone: d.phone,
        p_customer_email: d.email,
        p_notes: d.notes,
        p_internal_notes: d.internalNotes,
      });
      if (error) return { error: mapDbError(error.message) };
      created.id = createdId(data);
      return created.id ? { success: 'Reserva guardada.' } : { error: mapDbError(undefined) };
    },
    PANEL_ONLY,
  );
  if (created.id) redirect(`/panel/${restaurantId}/reservas?fecha=${d.date}&aviso=creada`);
  return result;
}

/** Cambia hora, personas, duración, mesas y notas. Duración vacía = la de su tramo. */
export async function updateReservation(_prev: FormState, fd: FormData): Promise<FormState> {
  const reservationId = field(fd, 'reservationId');
  if (!isUuid(reservationId)) return { error: mapDbError(undefined) };
  const parsed = reservationEditSchema.safeParse(readReservationForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const saved = { ok: false };
  const result = await runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const config = await loadBookingConfig(supabase, restaurantId);
      const { error } = await supabase.rpc('update_panel_reservation', {
        p_restaurant_id: restaurantId,
        p_reservation_id: reservationId,
        p_starts_at: startsAtFor(config, d.date, d.time),
        p_duration_min: d.duration ?? durationFor(d.partySize, config.settings),
        p_party_size: d.partySize,
        ...tableArgs(d.tableMode, d.tableIds),
        p_notes: d.notes,
        p_internal_notes: d.internalNotes,
      });
      if (error) return { error: mapDbError(error.message) };
      saved.ok = true;
      return { success: 'Cambios guardados.' };
    },
    PANEL_ONLY,
  );
  if (saved.ok) redirect(`/panel/${restaurantId}/reservas/${reservationId}?aviso=guardada`);
  return result;
}

/** Walk-in: se sienta ya en la mesa o mesas elegidas. */
export async function createWalkIn(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = walkInSchema.safeParse({
    partySize: field(fd, 'partySize'),
    tableIds: fd.getAll('tableIds').filter((v): v is string => typeof v === 'string'),
    name: field(fd, 'name'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const created = { id: '' };
  const result = await runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { data, error } = await supabase.rpc('create_walk_in', {
        p_restaurant_id: restaurantId,
        p_party_size: d.partySize,
        p_table_ids: [...new Set(d.tableIds)],
        p_duration_min: null,
        p_customer_name: d.name,
      });
      if (error) return { error: mapDbError(error.message) };
      created.id = createdId(data);
      return created.id ? { success: 'Sentados.' } : { error: mapDbError(undefined) };
    },
    PANEL_ONLY,
  );
  if (created.id) redirect(`/panel/${restaurantId}/reservas?aviso=walk-in`);
  return result;
}

/** Botones de estado (Confirmar, Sentar, Finalizar, No ha venido, Cancelar…). */
export async function changeReservationStatus(restaurantId: string, reservationId: string, status: string): Promise<FormState> {
  const parsed = statusSchema.safeParse(status);
  if (!isUuid(reservationId) || !parsed.success) return { error: mapDbError('INVALID_INPUT') };
  return runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { error } = await supabase.rpc('set_reservation_status', {
        p_restaurant_id: restaurantId,
        p_reservation_id: reservationId,
        p_status: parsed.data,
      });
      return error ? { error: mapDbError(error.message) } : { success: `Hecho: ${STATUS_LABELS_ES[parsed.data]}.` };
    },
    PANEL_ONLY,
  );
}

/** «Deshacer»: vuelve al estado anterior si la mesa sigue libre. */
export async function undoReservationStatus(restaurantId: string, reservationId: string): Promise<FormState> {
  if (!isUuid(reservationId)) return { error: mapDbError('INVALID_INPUT') };
  return runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { data, error } = await supabase.rpc('undo_reservation_status', { p_restaurant_id: restaurantId, p_reservation_id: reservationId });
      if (error) return { error: mapDbError(error.message) };
      const back = statusSchema.safeParse(data);
      return { success: back.success ? `Deshecho: vuelve a «${STATUS_LABELS_ES[back.data]}».` : 'Deshecho.' };
    },
    PANEL_ONLY,
  );
}

export type CustomerLookup = { customer: { name: string; email: string | null; warnings: CustomerWarning[] } | null; error?: string };

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tags: string[];
  visits_count: number;
  no_show_count: number;
  cancel_count: number;
};

/** Busca al cliente por su teléfono (normalizado) para rellenar el nombre y enseñar sus avisos. */
export async function lookupCustomer(restaurantId: string, phone: string): Promise<CustomerLookup> {
  const e164 = typeof phone === 'string' ? normalizePhoneE164(phone) : null;
  if (!isUuid(restaurantId) || !e164) return { customer: null };
  try {
    await requirePermission(restaurantId, 'reservations.manage');
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, email, tags, visits_count, no_show_count, cancel_count')
      .eq('restaurant_id', restaurantId)
      .eq('phone', e164)
      .maybeSingle();
    if (error) {
      console.error('[reservas] lookupCustomer', error.message);
      return { customer: null, error: mapDbError(undefined) };
    }
    const c = data as CustomerRow | null;
    if (!c) return { customer: null };
    const tags = (['vip', 'regular', 'problem'] as const).filter((t) => c.tags.includes(t));
    return {
      customer: {
        name: c.name,
        email: c.email,
        warnings: customerWarnings({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          tags,
          visitsCount: c.visits_count,
          noShowCount: c.no_show_count,
          cancelCount: c.cancel_count,
        }),
      },
    };
  } catch (e) {
    unstable_rethrow(e);
    const mapped = mapDbError(e instanceof Error ? e.message : undefined);
    if (mapped === mapDbError(undefined)) console.error('[reservas] lookupCustomer', e);
    return { customer: null, error: mapped };
  }
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: 7 pruebas nuevas en verde; `test:unit` → **442** (58 archivos); sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/reservations.ts src/lib/actions/reservations.test.ts
git commit -m "Reservas: acciones de alta por teléfono, cambios, walk-in, estados, deshacer y búsqueda del cliente"
```

---

### Task 12: Server actions de zonas, mesas, ajustes y bloqueos

**Files:**
- Create: `src/lib/actions/booking-settings.ts`, `src/lib/actions/blocks.ts`

**Interfaces:**
- Consumes: `runPanelAction`, `throwIfError` (Task 10); `confirmSchema` de `@/lib/menu/validation`; `zoneFormSchema`, `tableFormSchema`, `TABLE_FORM_FIELDS`, `bookingSettingsSchema`, `readSettingsForm`, `blockFormSchema`, `BLOCK_FORM_FIELDS` (Task 9); `zonedTimeToUtc` (Task 4).
- Produces (`'use server'`, permiso `settings.booking`, `{ publicData: false }`): `createZone(prev, fd)` (`name`, `position`), `updateZone(prev, fd)` (+ `zoneId`), `deleteZone(prev, fd)` (+ `confirm`), `createTable(prev, fd)` (campos `TABLE_FORM_FIELDS`; sin zonas crea «Sala»; con zonas exige una), `updateTable(prev, fd)` (+ `tableId`), `deleteTable(prev, fd)` (+ `confirm`), `saveBookingSettings(prev, fd)` (crea la fila al guardar por primera vez, sin upsert), `createBlock(prev, fd)` (campos `BLOCK_FORM_FIELDS`), `deleteBlock(fd): Promise<void>` (`blockId`).

- [ ] **Step 1: Acciones de zonas, mesas y ajustes**

Create `src/lib/actions/booking-settings.ts`:

```ts
'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { confirmSchema } from '@/lib/menu/validation';
import { bookingSettingsSchema, readSettingsForm, TABLE_FORM_FIELDS, tableFormSchema, zoneFormSchema } from '@/lib/reservations/validation';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, type SupabaseServerClient } from './run';

// Nada de esto sale en la web pública: solo se refresca el panel.
const PANEL_ONLY = { publicData: false };
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidSchema.safeParse(value).success;

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

type Table = 'zones' | 'tables';

/** UPDATE o DELETE de una fila del restaurante con la sesión del usuario; 0 filas → sin permiso. */
async function changeOne(
  supabase: SupabaseServerClient,
  table: Table,
  id: string,
  restaurantId: string,
  values: Record<string, unknown> | null,
  success: string,
): Promise<FormState> {
  const query = values ? supabase.from(table).update(values) : supabase.from(table).delete();
  const { data, error } = await query.eq('id', id).eq('restaurant_id', restaurantId).select('id');
  if (error) return { error: mapDbError(error.message) };
  if (!data?.length) return { error: mapDbError('FORBIDDEN') };
  return { success };
}

// Zonas -----------------------------------------------------------------------------------------------------
export async function createZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = zoneFormSchema.safeParse(formStrings(fd, ['name', 'position']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const { error } = await supabase.from('zones').insert({ restaurant_id: restaurantId, ...parsed.data });
      return error ? { error: mapDbError(error.message) } : { success: 'Zona creada.' };
    },
    PANEL_ONLY,
  );
}

export async function updateZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const zoneId = field(fd, 'zoneId');
  if (!isUuid(zoneId)) return { error: mapDbError(undefined) };
  const parsed = zoneFormSchema.safeParse(formStrings(fd, ['name', 'position']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'zones', zoneId, restaurantId, parsed.data, 'Zona guardada.'), PANEL_ONLY);
}

export async function deleteZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const zoneId = field(fd, 'zoneId');
  if (!isUuid(zoneId)) return { error: mapDbError(undefined) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'zones', zoneId, restaurantId, null, 'Zona borrada.'), PANEL_ONLY);
}

// Mesas -----------------------------------------------------------------------------------------------------
/** La zona elegida (del restaurante) o, si el restaurante aún no tiene ninguna, «Sala», que se crea al momento. */
async function zoneForNewTable(
  supabase: SupabaseServerClient,
  restaurantId: string,
  zoneId: string | null,
): Promise<{ id: string } | { error: FormState }> {
  if (zoneId) return { id: zoneId };
  const { data, error } = await supabase.from('zones').select('id').eq('restaurant_id', restaurantId).limit(1);
  if (error) return { error: { error: mapDbError(error.message) } };
  if (data?.length) return { error: { fieldErrors: { zoneId: 'Elige una zona.' } } };
  const created = await supabase.from('zones').insert({ restaurant_id: restaurantId, name: 'Sala', position: 0 }).select('id').single();
  if (created.error) return { error: { error: mapDbError(created.error.message) } };
  return { id: (created.data as { id: string }).id };
}

export async function createTable(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = tableFormSchema.safeParse(formStrings(fd, TABLE_FORM_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const t = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const zone = await zoneForNewTable(supabase, restaurantId, t.zoneId);
      if ('error' in zone) return zone.error;
      const { error } = await supabase.from('tables').insert({
        restaurant_id: restaurantId,
        zone_id: zone.id,
        name: t.name,
        min_capacity: t.minCapacity,
        max_capacity: t.maxCapacity,
        position: t.position,
        online_bookable: t.onlineBookable,
        active: t.active,
      });
      return error ? { error: mapDbError(error.message) } : { success: `Mesa ${t.name} creada.` };
    },
    PANEL_ONLY,
  );
}

export async function updateTable(_prev: FormState, fd: FormData): Promise<FormState> {
  const tableId = field(fd, 'tableId');
  if (!isUuid(tableId)) return { error: mapDbError(undefined) };
  const parsed = tableFormSchema.safeParse(formStrings(fd, TABLE_FORM_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const t = parsed.data;
  if (!t.zoneId) return { fieldErrors: { zoneId: 'Elige una zona.' } };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    (supabase) =>
      changeOne(
        supabase,
        'tables',
        tableId,
        restaurantId,
        {
          zone_id: t.zoneId,
          name: t.name,
          min_capacity: t.minCapacity,
          max_capacity: t.maxCapacity,
          position: t.position,
          online_bookable: t.onlineBookable,
          active: t.active,
        },
        'Mesa guardada.',
      ),
    PANEL_ONLY,
  );
}

export async function deleteTable(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const tableId = field(fd, 'tableId');
  if (!isUuid(tableId)) return { error: mapDbError(undefined) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'tables', tableId, restaurantId, null, 'Mesa borrada.'), PANEL_ONLY);
}

// Duración y reglas -----------------------------------------------------------------------------------------
export async function saveBookingSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = bookingSettingsSchema.safeParse(readSettingsForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const s = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const values = {
    default_duration_min: s.defaultDurationMin,
    duration_rules: s.durationRules.map((r) => ({ min_party: r.minParty, max_party: r.maxParty, duration_min: r.durationMin })),
    min_advance_min: s.minAdvanceMin,
    max_advance_days: s.maxAdvanceDays,
    max_online_party: s.maxOnlineParty,
    cancel_limit_hours: s.cancelLimitHours,
    auto_confirm: s.autoConfirm,
  };
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      // La fila se crea al guardar por primera vez (sin upsert: restaurant_id no se actualiza nunca).
      const updated = await supabase.from('booking_settings').update(values).eq('restaurant_id', restaurantId).select('restaurant_id');
      if (updated.error) return { error: mapDbError(updated.error.message) };
      if (!updated.data?.length) {
        const { error } = await supabase.from('booking_settings').insert({ restaurant_id: restaurantId, ...values });
        if (error) return { error: mapDbError(error.message) };
      }
      return { success: 'Ajustes guardados.' };
    },
    PANEL_ONLY,
  );
}
```

- [ ] **Step 2: Acciones de bloqueos**

Create `src/lib/actions/blocks.ts`:

```ts
'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { zonedTimeToUtc } from '@/lib/reservations/time';
import { BLOCK_FORM_FIELDS, blockFormSchema } from '@/lib/reservations/validation';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError } from './run';

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

/** Bloquea una mesa (o todo el restaurante) en una franja, con las horas del reloj del restaurante. */
export async function createBlock(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = blockFormSchema.safeParse(formStrings(fd, BLOCK_FORM_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const b = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const { data, error: tzError } = await supabase.from('restaurants').select('timezone').eq('id', restaurantId).single();
      if (tzError || !data) return { error: mapDbError(tzError?.message) };
      const tz = (data as { timezone: string }).timezone;
      // La mesa tiene que ser de este restaurante: lo garantiza la clave foránea compuesta (table_id, restaurant_id).
      const { error } = await supabase.from('blocks').insert({
        restaurant_id: restaurantId,
        table_id: b.tableId,
        starts_at: new Date(zonedTimeToUtc(b.date, b.startMinute, tz)).toISOString(),
        ends_at: new Date(zonedTimeToUtc(b.date, b.endMinute, tz)).toISOString(),
        reason: b.reason,
      });
      return error ? { error: mapDbError(error.message) } : { success: 'Bloqueo guardado.' };
    },
    { publicData: false },
  );
}

export async function deleteBlock(fd: FormData): Promise<void> {
  const blockId = field(fd, 'blockId');
  if (!uuidSchema.safeParse(blockId).success) return;
  const restaurantId = field(fd, 'restaurantId');
  const result = await runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const { data, error } = await supabase.from('blocks').delete().eq('id', blockId).eq('restaurant_id', restaurantId).select('id');
      if (error) return { error: mapDbError(error.message) };
      return data?.length ? { success: 'Bloqueo quitado.' } : { error: mapDbError('FORBIDDEN') };
    },
    { publicData: false },
  );
  throwIfError(result);
}
```

- [ ] **Step 3: Comprobar tipos y lint**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sin errores; 442 pruebas unitarias en verde. (Las reglas las prueban la BD — Task 1 — y la validación — Task 9; estas acciones solo las encadenan, con `.eq('restaurant_id', …)` en todo UPDATE/DELETE.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/booking-settings.ts src/lib/actions/blocks.ts
git commit -m "Reservas: acciones de zonas, mesas (con «Sala» por defecto), ajustes y bloqueos"
```

---

### Task 13: Horario: última hora de reserva e intervalo de cada servicio

**Files:**
- Modify: `src/lib/local/data.ts`, `src/lib/actions/schedule.ts`, `src/components/schedule/ServiceRow.tsx`, `src/app/panel/[restaurantId]/horario/page.tsx`

**Interfaces:**
- Consumes: `serviceBookingSchema` (Task 9); `effectiveLastBooking` (Task 5); columnas `last_booking_minute` y `slot_interval_min` (Task 1).
- Produces: `type ScheduleService = ServiceSlot & { id; lastBookingMinute: number | null; slotIntervalMin: number }` en `@/lib/local/data` (`RestaurantSchedule.services: ScheduleService[]`); `addServices` y `updateService` leen `lastBooking` y `slotInterval`; `SLOT_INTERVAL_OPTIONS` exportado desde `ServiceRow.tsx`.

- [ ] **Step 1: Servicios con los campos nuevos**

In `src/lib/local/data.ts`, replace:

```ts
export type RestaurantSchedule = {
  timezone: string;
  services: (ServiceSlot & { id: string })[];
```

with:

```ts
/** Servicio con la última hora de reserva (null = una hora antes del cierre) y el intervalo (Hito 4A). */
export type ScheduleService = ServiceSlot & { id: string; lastBookingMinute: number | null; slotIntervalMin: number };

export type RestaurantSchedule = {
  timezone: string;
  services: ScheduleService[];
```

replace (in `getRestaurantSchedule`):

```ts
      .select('id, name, weekday, start_minute, end_minute')
```

with:

```ts
      .select('id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min')
```

and replace:

```ts
    services: ((services.data ?? []) as { id: string; name: string; weekday: number; start_minute: number; end_minute: number }[]).map(
      (s) => ({ id: s.id, name: s.name, weekday: s.weekday, startMinute: s.start_minute, endMinute: s.end_minute }),
    ),
```

with:

```ts
    services: (
      (services.data ?? []) as {
        id: string;
        name: string;
        weekday: number;
        start_minute: number;
        end_minute: number;
        last_booking_minute: number | null;
        slot_interval_min: number;
      }[]
    ).map((s) => ({
      id: s.id,
      name: s.name,
      weekday: s.weekday,
      startMinute: s.start_minute,
      endMinute: s.end_minute,
      lastBookingMinute: s.last_booking_minute,
      slotIntervalMin: s.slot_interval_min,
    })),
```

- [ ] **Step 2: Las acciones del horario guardan los dos campos**

In `src/lib/actions/schedule.ts`:

1. Add `import { serviceBookingSchema } from '@/lib/reservations/validation';` before the `@/lib/schedule` import.
2. Replace:

```ts
export async function addServices(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = newServicesSchema.safeParse({ ...formStrings(fd, ['name', 'start', 'end']), weekdays: fd.getAll('weekdays') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { name, weekdays, startMinute, endMinute } = parsed.data;
```

with:

```ts
/** Última hora de reserva e intervalo (Hito 4A), una vez validadas las horas del servicio. */
function parseBooking(fd: FormData, range: { startMinute: number; endMinute: number }) {
  return serviceBookingSchema(range).safeParse(formStrings(fd, ['lastBooking', 'slotInterval']));
}

export async function addServices(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = newServicesSchema.safeParse({ ...formStrings(fd, ['name', 'start', 'end']), weekdays: fd.getAll('weekdays') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { name, weekdays, startMinute, endMinute } = parsed.data;
  const booking = parseBooking(fd, parsed.data);
  if (!booking.success) return { fieldErrors: fieldErrorsFrom(booking.error) };
```

3. In the `insert` of `addServices`, replace:

```ts
        start_minute: startMinute,
        end_minute: endMinute,
      })),
```

with:

```ts
        start_minute: startMinute,
        end_minute: endMinute,
        last_booking_minute: booking.data.lastBookingMinute,
        slot_interval_min: booking.data.slotIntervalMin,
      })),
```

4. In `updateService`, replace:

```ts
  const parsed = serviceSchema.safeParse(formStrings(fd, ['name', 'start', 'end']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
```

with:

```ts
  const parsed = serviceSchema.safeParse(formStrings(fd, ['name', 'start', 'end']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const booking = parseBooking(fd, parsed.data);
  if (!booking.success) return { fieldErrors: fieldErrorsFrom(booking.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
```

and replace:

```ts
      .update({ name: parsed.data.name, start_minute: parsed.data.startMinute, end_minute: parsed.data.endMinute })
```

with:

```ts
      .update({
        name: parsed.data.name,
        start_minute: parsed.data.startMinute,
        end_minute: parsed.data.endMinute,
        last_booking_minute: booking.data.lastBookingMinute,
        slot_interval_min: booking.data.slotIntervalMin,
      })
```

- [ ] **Step 3: Fila de servicio**

Replace `src/components/schedule/ServiceRow.tsx` with:

```tsx
import { ActionForm, FormField, FormSelect } from '@/components/forms/ActionForm';
import { deleteService, updateService } from '@/lib/actions/schedule';
import type { ScheduleService } from '@/lib/local/data';
import { effectiveLastBooking } from '@/lib/reservations/day';
import { formatRange, isWeekday, minutesToTime, WEEKDAY_LABELS_ES } from '@/lib/schedule';

export const SLOT_INTERVAL_OPTIONS = [
  { value: '15', label: 'Cada 15 min' },
  { value: '30', label: 'Cada 30 min' },
];

/** '· última reserva 23:30 · cada 30 min' (la última, también cuando es la de por defecto). */
function bookingSummary(service: ScheduleService): string {
  const last = effectiveLastBooking(service.startMinute, service.endMinute, service.lastBookingMinute);
  return `última reserva ${minutesToTime(last)} · cada ${service.slotIntervalMin} min`;
}

export function ServiceRow({
  restaurantId,
  service,
  readOnly,
}: {
  restaurantId: string;
  service: ScheduleService;
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <li className="py-1">
        <strong>{service.name}</strong> · {formatRange(service.startMinute, service.endMinute)} · {bookingSummary(service)}
      </li>
    );
  }
  const day = isWeekday(service.weekday) ? ` del ${WEEKDAY_LABELS_ES[service.weekday].toLowerCase()}` : '';
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
          <FormField
            id={`last-${service.id}`}
            label="Última reserva"
            name="lastBooking"
            type="time"
            defaultValue={service.lastBookingMinute === null ? '' : minutesToTime(service.lastBookingMinute)}
            hint={service.lastBookingMinute === null ? `Vacío: ${minutesToTime(effectiveLastBooking(service.startMinute, service.endMinute, null))}` : undefined}
          />
          <FormSelect
            id={`interval-${service.id}`}
            label="Horas de reserva"
            name="slotInterval"
            defaultValue={String(service.slotIntervalMin)}
            options={SLOT_INTERVAL_OPTIONS}
          />
        </ActionForm>
      </div>
      <form action={deleteService}>
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="serviceId" value={service.id} />
        <button
          type="submit"
          aria-label={`Quitar ${service.name}${day}`}
          className="px-2 py-3 text-sm font-bold text-red-700 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          Quitar
        </button>
      </form>
    </li>
  );
}
```

- [ ] **Step 4: Página del horario**

In `src/app/panel/[restaurantId]/horario/page.tsx`:

1. Replace `import { ServiceRow } from '@/components/schedule/ServiceRow';` with `import { ServiceRow, SLOT_INTERVAL_OPTIONS } from '@/components/schedule/ServiceRow';`.
2. Replace the intro paragraph:

```tsx
        <p className="mt-1 text-muted">Tus servicios de cada semana y los días que cierras o abres distinto. Sale tal cual en tu web.</p>
```

with:

```tsx
        <p className="mt-1 text-muted">
          Tus servicios de cada semana y los días que cierras o abres distinto. Sale tal cual en tu web. La última reserva y cada
          cuánto se reserva son para el panel de reservas.
        </p>
```

3. In the «Añadir un servicio» form, replace:

```tsx
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Empieza" name="start" type="time" required />
              <FormField label="Acaba" name="end" type="time" required />
            </div>
            <FormCheckboxGroup
```

with:

```tsx
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Empieza" name="start" type="time" required />
              <FormField label="Acaba" name="end" type="time" required />
              <FormField label="Última reserva (opcional)" name="lastBooking" type="time" hint="Si la dejas vacía, una hora antes de acabar." />
              <FormSelect label="Horas de reserva" name="slotInterval" defaultValue="15" options={SLOT_INTERVAL_OPTIONS} />
            </div>
            <FormCheckboxGroup
```

- [ ] **Step 5: Comprobar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: sin errores; **620** pruebas en verde (442 unitarias + 178 de BD).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local/data.ts src/lib/actions/schedule.ts src/components/schedule/ServiceRow.tsx "src/app/panel/[restaurantId]/horario/page.tsx"
git commit -m "Horario: última hora de reserva e intervalo de 15 o 30 minutos en cada servicio"
```

---

### Task 14: Componentes comunes de reservas y tiempo real

**Files:**
- Create: `src/lib/supabase/browser.ts`, `src/components/reservations/RealtimeRefresh.tsx`, `src/components/reservations/ReservationStatusBadge.tsx`, `src/components/reservations/CustomerWarnings.tsx`, `src/components/reservations/ReservationsNav.tsx`, `src/components/reservations/DayPicker.tsx`
- Test: `src/components/reservations/ReservationsNav.test.tsx`

**Interfaces:**
- Consumes: `createBrowserClient` de `@supabase/ssr` 0.12.7 (Realtime toma el token de la sesión: `SupabaseClient` llama a `realtime.setAuth` con cada cambio de sesión); `STATUS_LABELS_ES`, `STATUS_STYLES` (Task 3); `CustomerWarning` (Task 8); `addDays`, `formatDayEs` (Task 4); `buttonClass`, `inputClass`.
- Produces: `browserClient()`; `<RealtimeRefresh restaurantId>` (cliente); `<ReservationStatusBadge status>`; `<CustomerWarnings warnings>`; `type ReservationsSection = 'dia' | 'cuadricula' | 'bloqueos' | 'ajustes'`, `<ReservationsNav restaurantId current date? canConfigure>`; `<DayPicker path date today keep?>` (el `<h1>` de la página con la fecha, anterior/hoy/siguiente y un formulario GET con `fecha`).

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` (`router.refresh()`). API de canal (realtime-js 2.119.2): `supabase.channel(nombre).on('postgres_changes', { event: 'INSERT' | 'UPDATE' | 'DELETE', schema: 'public', table, filter? }, cb).subscribe((status) => …)` con `status` en `SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR`, y `supabase.removeChannel(channel)` al desmontar.

- [ ] **Step 1: Prueba (falla)**

Create `src/components/reservations/ReservationsNav.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CustomerWarnings } from './CustomerWarnings';
import { ReservationsNav } from './ReservationsNav';
import { ReservationStatusBadge } from './ReservationStatusBadge';

const R = '11111111-1111-4111-8111-111111111111';

it('Sala ve Día y Cuadrícula; quien configura, también Bloqueos y Ajustes; la actual lleva aria-current', () => {
  const staff = renderToStaticMarkup(<ReservationsNav restaurantId={R} current="cuadricula" date="2030-06-14" canConfigure={false} />);
  expect(staff).toContain(`href="/panel/${R}/reservas/cuadricula?fecha=2030-06-14"`);
  expect(staff).not.toContain('Ajustes');
  expect(staff).toMatch(/aria-current="page"[^>]*>Cuadrícula/);
  const manager = renderToStaticMarkup(<ReservationsNav restaurantId={R} current="dia" canConfigure />);
  expect(manager).toContain('Bloqueos');
  expect(manager).toContain(`href="/panel/${R}/reservas/ajustes"`);
});

it('el estado se ve con texto (no solo color) y los avisos importantes dicen «Atención»', () => {
  expect(renderToStaticMarkup(<ReservationStatusBadge status="no_show" />)).toContain('No vino');
  const html = renderToStaticMarkup(<CustomerWarnings warnings={[{ text: '2 no-shows', tone: 'warning' }, { text: 'VIP', tone: 'info' }]} />);
  expect(html).toContain('<span class="sr-only">Atención: </span>2 no-shows');
  expect(html).toContain('VIP');
  expect(renderToStaticMarkup(<CustomerWarnings warnings={[]} />)).toBe('');
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `pnpm vitest run --project unit src/components/reservations`
Expected: FAIL: `Failed to resolve import "./CustomerWarnings"`.

- [ ] **Step 3: Cliente del navegador y tiempo real**

Create `src/lib/supabase/browser.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente del navegador con la sesión del usuario (cookies), para Supabase Realtime: los cambios llegan filtrados por
 * las RLS de quien mira. Las NEXT_PUBLIC_* se incrustan al compilar. Es único por pestaña (isSingleton).
 */
export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
```

Create `src/components/reservations/RealtimeRefresh.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

type LiveState = 'connecting' | 'live' | 'offline';

const TEXT: Record<LiveState, string> = {
  connecting: 'Conectando para ver los cambios en directo…',
  live: 'En directo: los cambios de otros dispositivos salen solos.',
  offline: 'Sin conexión en directo. Recarga la página para ver los cambios de otros dispositivos.',
};

/**
 * Escucha los cambios de reservas, mesas de reserva y bloqueos del restaurante (Supabase Realtime, con las RLS del
 * usuario) y refresca la página. Los borrados no se pueden filtrar por restaurante (con RLS solo traen la clave):
 * cualquier borrado refresca.
 */
export function RealtimeRefresh({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    const supabase = browserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const filter = `restaurant_id=eq.${restaurantId}`;
    const channel = supabase.channel(`reservas:${restaurantId}`);
    for (const table of ['reservations', 'reservation_tables', 'blocks']) {
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, refresh);
    }
    for (const table of ['reservation_tables', 'blocks']) {
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, refresh);
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') setState('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setState('offline');
    });
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [restaurantId, router]);

  return (
    <p role="status" className="text-sm text-muted">
      <span aria-hidden="true" className={`mr-2 inline-block size-2 rounded-full ${state === 'live' ? 'bg-navy' : state === 'offline' ? 'bg-red-700' : 'bg-ink/30'}`} />
      {TEXT[state]}
    </p>
  );
}
```

- [ ] **Step 4: Estado, avisos, subnavegación y selector de día**

Create `src/components/reservations/ReservationStatusBadge.tsx`:

```tsx
import { STATUS_LABELS_ES, STATUS_STYLES, type ReservationStatus } from '@/lib/reservations/codes';

/** Estado con color y texto (nunca solo color). */
export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className={`inline-flex rounded-full border-2 px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[status]}`}>{STATUS_LABELS_ES[status]}</span>
  );
}
```

Create `src/components/reservations/CustomerWarnings.tsx`:

```tsx
import type { CustomerWarning } from '@/lib/reservations/customers';

/** Avisos del cliente en la reserva: los importantes, en rojo y con «Atención:» para los lectores de pantalla. */
export function CustomerWarnings({ warnings }: { warnings: CustomerWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul aria-label="Avisos del cliente" className="flex flex-wrap gap-1.5">
      {warnings.map((w) => (
        <li
          key={w.text}
          className={`rounded-[6px] px-2 py-0.5 text-xs font-bold ${w.tone === 'warning' ? 'bg-red-50 text-red-800' : 'bg-peach-soft text-ink'}`}
        >
          {w.tone === 'warning' && <span className="sr-only">Atención: </span>}
          {w.text}
        </li>
      ))}
    </ul>
  );
}
```

Create `src/components/reservations/ReservationsNav.tsx`:

```tsx
import Link from 'next/link';

export type ReservationsSection = 'dia' | 'cuadricula' | 'bloqueos' | 'ajustes';

/** Subsecciones de «Reservas». Bloqueos y Ajustes, solo para quien configura (Administrador y Encargado). */
export function ReservationsNav({
  restaurantId,
  current,
  date,
  canConfigure,
}: {
  restaurantId: string;
  current: ReservationsSection;
  date?: string;
  canConfigure: boolean;
}) {
  const base = `/panel/${restaurantId}/reservas`;
  const q = date ? `?fecha=${date}` : '';
  const items: { key: ReservationsSection; label: string; href: string }[] = [
    { key: 'dia', label: 'Día', href: `${base}${q}` },
    { key: 'cuadricula', label: 'Cuadrícula', href: `${base}/cuadricula${q}` },
    ...(canConfigure
      ? [
          { key: 'bloqueos' as const, label: 'Bloqueos', href: `${base}/bloqueos${q}` },
          { key: 'ajustes' as const, label: 'Ajustes', href: `${base}/ajustes` },
        ]
      : []),
  ];
  return (
    <nav aria-label="Reservas" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
          className={
            'rounded-[6px] border-2 px-4 py-2 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy ' +
            (item.key === current ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white text-ink hover:bg-peach-soft')
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

Create `src/components/reservations/DayPicker.tsx`:

```tsx
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { addDays, formatDayEs } from '@/lib/reservations/time';

/** Día que se ve: anterior, hoy, siguiente y un calendario (formulario GET, funciona sin JavaScript). */
export function DayPicker({ path, date, today, keep = {} }: { path: string; date: string; today: string; keep?: Record<string, string> }) {
  const href = (d: string) => `${path}?${new URLSearchParams({ ...keep, fecha: d }).toString()}`;
  const small = buttonClass('secondary', 'px-3 py-2 text-sm');
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-extrabold tracking-tight">
        {formatDayEs(date)}
        {date === today && <span className="ml-2 align-middle text-base font-bold text-muted">(hoy)</span>}
      </h1>
      <div className="flex flex-wrap items-end gap-2">
        <Link href={href(addDays(date, -1))} className={small}>
          <span aria-hidden="true">←</span> Día anterior
        </Link>
        {date !== today && (
          <Link href={href(today)} className={small}>
            Hoy
          </Link>
        )}
        <Link href={href(addDays(date, 1))} className={small}>
          Día siguiente <span aria-hidden="true">→</span>
        </Link>
        <form method="get" action={path} className="flex items-end gap-2">
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label className="flex flex-col gap-1 text-sm font-bold">
            Ir a la fecha
            <input type="date" name="fecha" defaultValue={date} required className={`${inputClass} py-1.5`} />
          </label>
          <button type="submit" className={small}>
            Ver
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Comprobar**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: `test:unit` → **444** (59 archivos); sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/browser.ts src/components/reservations/RealtimeRefresh.tsx src/components/reservations/ReservationStatusBadge.tsx src/components/reservations/CustomerWarnings.tsx src/components/reservations/ReservationsNav.tsx src/components/reservations/ReservationsNav.test.tsx src/components/reservations/DayPicker.tsx
git commit -m "Reservas: tiempo real con Supabase Realtime, estado con texto, avisos, subnavegación y selector de día"
```

---

### Task 15: Página de ajustes: zonas, mesas, duración y reglas

**Files:**
- Create: `src/components/reservations/TableSettings.tsx`, `src/components/reservations/BookingSettingsForm.tsx`, `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`

**Interfaces:**
- Consumes: acciones de la Task 12; `ActionForm`, `FormField`, `FormSelect`, `FormCheckbox`; `ConfirmDeleteForm`; `getBookingConfig` (Task 8); `compareTablesForDisplay` (Task 6); `BOOKING_LIMITS` (Task 3); `DURATION_OPTIONS`, `formatDuration` (Task 4); `RULE_ROWS` (Task 9); `ReservationsNav` (Task 14); `requirePanelAccess(…, 'settings.booking')`.
- Produces: `<ZoneEditor>`, `<NewZoneForm>`, `<TableEditor>`, `<NewTableForm>`, `<BookingSettingsForm restaurantId settings readOnly>`; la página `/panel/[id]/reservas/ajustes` con las anclas `#zonas`, `#mesas` (la del asistente) y `#duracion`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.

- [ ] **Step 1: Editores de zonas y mesas**

Create `src/components/reservations/TableSettings.tsx`:

```tsx
import { ActionForm, FormCheckbox, FormField, FormSelect } from '@/components/forms/ActionForm';
import { ConfirmDeleteForm } from '@/components/menu/ConfirmDeleteForm';
import { createTable, createZone, deleteTable, deleteZone, updateTable, updateZone } from '@/lib/actions/booking-settings';
import type { BookingTable } from '@/lib/reservations/availability';
import type { ZoneRow } from '@/lib/reservations/rows';

export function ZoneEditor({ restaurantId, zone, tableCount, readOnly }: { restaurantId: string; zone: ZoneRow; tableCount: number; readOnly: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-b border-ink/10 py-3">
      <ActionForm action={updateZone} hidden={{ restaurantId, zoneId: zone.id }} inline readOnly={readOnly} submitLabel="Guardar">
        <FormField id={`zone-name-${zone.id}`} label="Zona" name="name" defaultValue={zone.name} maxLength={40} required />
        <FormField id={`zone-pos-${zone.id}`} label="Orden" name="position" type="number" min={0} max={999} defaultValue={String(zone.position)} />
      </ActionForm>
      {!readOnly &&
        (tableCount > 0 ? (
          <p className="text-sm text-muted">
            {tableCount === 1 ? '1 mesa' : `${tableCount} mesas`}. Para borrar la zona, pásalas antes a otra zona o bórralas.
          </p>
        ) : (
          <ConfirmDeleteForm action={deleteZone} hidden={{ restaurantId, zoneId: zone.id }} confirmLabel={`Sí, borrar la zona «${zone.name}»`} submitLabel="Borrar zona" />
        ))}
    </li>
  );
}

export function NewZoneForm({ restaurantId }: { restaurantId: string }) {
  return (
    <ActionForm action={createZone} hidden={{ restaurantId }} inline submitLabel="Añadir zona" pendingLabel="Añadiendo…">
      <FormField id="new-zone-name" label="Nueva zona" name="name" maxLength={40} placeholder="Terraza" required />
      <FormField id="new-zone-pos" label="Orden" name="position" type="number" min={0} max={999} defaultValue="0" />
    </ActionForm>
  );
}

function TableFields({ prefix, zones, table }: { prefix: string; zones: ZoneRow[]; table?: BookingTable }) {
  return (
    <>
      {zones.length > 0 ? (
        <FormSelect
          id={`${prefix}-zone`}
          label="Zona"
          name="zoneId"
          defaultValue={table?.zoneId ?? zones[0].id}
          options={zones.map((z) => ({ value: z.id, label: z.name }))}
        />
      ) : (
        <input type="hidden" name="zoneId" value="" />
      )}
      <FormField id={`${prefix}-name`} label="Mesa" name="name" defaultValue={table?.name} maxLength={20} placeholder="T4" required />
      <FormField id={`${prefix}-min`} label="Mín. personas" name="minCapacity" type="number" min={1} max={50} defaultValue={String(table?.minCapacity ?? 1)} required />
      <FormField id={`${prefix}-max`} label="Máx. personas" name="maxCapacity" type="number" min={1} max={50} defaultValue={String(table?.maxCapacity ?? 4)} required />
      <FormField id={`${prefix}-pos`} label="Orden" name="position" type="number" min={0} max={999} defaultValue={String(table?.position ?? 0)} />
      <FormCheckbox name="onlineBookable" label="Se puede reservar online" defaultChecked={table?.onlineBookable ?? true} />
      <FormCheckbox name="active" label="Activa" defaultChecked={table?.active ?? true} />
    </>
  );
}

export function TableEditor({ restaurantId, zones, table, readOnly }: { restaurantId: string; zones: ZoneRow[]; table: BookingTable; readOnly: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-b border-ink/10 py-3">
      <ActionForm action={updateTable} hidden={{ restaurantId, tableId: table.id }} inline readOnly={readOnly} submitLabel="Guardar">
        <TableFields prefix={`table-${table.id}`} zones={zones} table={table} />
      </ActionForm>
      {!readOnly && (
        <details>
          <summary className="cursor-pointer text-sm font-bold text-red-700">Borrar {table.name}</summary>
          <div className="mt-2">
            <ConfirmDeleteForm
              action={deleteTable}
              hidden={{ restaurantId, tableId: table.id }}
              confirmLabel={`Sí, borrar la mesa ${table.name}. Si tiene reservas por delante, desactívala en su lugar.`}
              submitLabel="Borrar mesa"
            />
          </div>
        </details>
      )}
    </li>
  );
}

export function NewTableForm({ restaurantId, zones }: { restaurantId: string; zones: ZoneRow[] }) {
  return (
    <ActionForm action={createTable} hidden={{ restaurantId }} inline submitLabel="Añadir mesa" pendingLabel="Añadiendo…">
      <TableFields prefix="new-table" zones={zones} />
      {zones.length === 0 && <p className="basis-full text-sm text-muted">Como aún no tienes zonas, la pondremos en «Sala».</p>}
    </ActionForm>
  );
}
```

- [ ] **Step 2: Duración y reglas**

Create `src/components/reservations/BookingSettingsForm.tsx`:

```tsx
import { ActionForm, FormCheckbox, FormField, FormSelect } from '@/components/forms/ActionForm';
import { saveBookingSettings } from '@/lib/actions/booking-settings';
import { DURATION_OPTIONS, formatDuration, type BookingSettings } from '@/lib/reservations/settings';
import { RULE_ROWS } from '@/lib/reservations/validation';

const durations = DURATION_OPTIONS.map((m) => ({ value: String(m), label: formatDuration(m) }));

/** Duración por defecto, tramos por tamaño de grupo y reglas de la reserva online (se aplican en el Hito 4B). */
export function BookingSettingsForm({ restaurantId, settings, readOnly }: { restaurantId: string; settings: BookingSettings; readOnly: boolean }) {
  return (
    <ActionForm action={saveBookingSettings} hidden={{ restaurantId }} readOnly={readOnly} submitLabel="Guardar ajustes">
      <FormSelect label="Duración de una reserva" name="defaultDuration" defaultValue={String(settings.defaultDurationMin)} options={durations} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold">Duración según el tamaño del grupo (opcional)</legend>
        <p className="text-sm text-muted">Deja vacías las filas que no uses. Un grupo que no entra en ningún tramo usa la duración de arriba.</p>
        {RULE_ROWS.map((n) => {
          const rule = settings.durationRules[n - 1];
          return (
            <div key={n} className="grid grid-cols-3 gap-3">
              <FormField id={`rule${n}_min`} label={`Tramo ${n}: de`} name={`rule${n}_min`} type="number" min={1} max={50} defaultValue={rule ? String(rule.minParty) : ''} />
              <FormField id={`rule${n}_max`} label="a (personas)" name={`rule${n}_max`} type="number" min={1} max={50} defaultValue={rule ? String(rule.maxParty) : ''} />
              <FormSelect
                id={`rule${n}_duration`}
                label="Duración"
                name={`rule${n}_duration`}
                defaultValue={rule ? String(rule.durationMin) : ''}
                options={[{ value: '', label: '—' }, ...durations]}
              />
            </div>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold">Reserva online</legend>
        <p className="text-sm text-muted">Las guardamos ya; se aplicarán cuando actives la reserva desde tu web.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Antelación mínima (minutos)" name="minAdvanceMin" type="number" min={0} max={10080} defaultValue={String(settings.minAdvanceMin)} />
          <FormField label="Hasta cuántos días antes" name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={String(settings.maxAdvanceDays)} />
          <FormField label="Máximo de personas online" name="maxOnlineParty" type="number" min={1} max={50} defaultValue={String(settings.maxOnlineParty)} />
          <FormField label="Cancelar hasta (horas antes)" name="cancelLimitHours" type="number" min={0} max={168} defaultValue={String(settings.cancelLimitHours)} />
        </div>
        <FormCheckbox name="autoConfirm" label="Confirmar las reservas online sin revisarlas" defaultChecked={settings.autoConfirm} />
      </fieldset>
    </ActionForm>
  );
}
```

- [ ] **Step 3: Página**

Create `src/app/panel/[restaurantId]/reservas/ajustes/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { BookingSettingsForm } from '@/components/reservations/BookingSettingsForm';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { NewTableForm, NewZoneForm, TableEditor, ZoneEditor } from '@/components/reservations/TableSettings';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { compareTablesForDisplay } from '@/lib/reservations/availability';
import { BOOKING_LIMITS } from '@/lib/reservations/codes';
import { getBookingConfig } from '@/lib/reservations/data';

export const metadata: Metadata = { title: 'Ajustes de reservas' };

export default async function BookingSettingsPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'settings.booking');
  const config = await getBookingConfig(restaurantId);
  const readOnly = ctx.readOnly;
  const tables = [...config.tables].sort(compareTablesForDisplay);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="ajustes" canConfigure />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Ajustes de reservas</h1>
        <p className="mt-1 text-muted">Tus zonas y mesas, cuánto dura una reserva y las reglas de la reserva online. El horario está en «Horario».</p>
      </header>

      <SectionCard id="zonas" title="Zonas" intro={`Sala, terraza, reservado… Como mucho ${BOOKING_LIMITS.zones}. Se ordenan de menor a mayor.`}>
        {config.zones.length === 0 ? (
          <p className="text-sm text-muted">Aún no tienes zonas. Si creas una mesa sin zona, la pondremos en «Sala».</p>
        ) : (
          <ul>
            {config.zones.map((z) => (
              <ZoneEditor key={z.id} restaurantId={restaurantId} zone={z} tableCount={tables.filter((t) => t.zoneId === z.id).length} readOnly={readOnly} />
            ))}
          </ul>
        )}
        {!readOnly && config.zones.length < BOOKING_LIMITS.zones && <NewZoneForm restaurantId={restaurantId} />}
      </SectionCard>

      <SectionCard
        id="mesas"
        title="Mesas"
        intro={`Como mucho ${BOOKING_LIMITS.tables}. Una mesa con reservas por delante no se borra: desactívala y no saldrá para reservas nuevas.`}
      >
        {tables.length === 0 ? (
          <p className="text-sm text-muted">Aún no tienes mesas. Crea la primera aquí abajo.</p>
        ) : (
          <ul>
            {tables.map((t) => (
              <TableEditor key={t.id} restaurantId={restaurantId} zones={config.zones} table={t} readOnly={readOnly} />
            ))}
          </ul>
        )}
        {!readOnly && tables.length < BOOKING_LIMITS.tables && <NewTableForm restaurantId={restaurantId} zones={config.zones} />}
      </SectionCard>

      <SectionCard id="duracion" title="Duración y reglas">
        <BookingSettingsForm restaurantId={restaurantId} settings={config.settings} readOnly={readOnly} />
      </SectionCard>
    </div>
  );
}
```

- [ ] **Step 4: Comprobar**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; el build lista `ƒ /panel/[restaurantId]/reservas/ajustes`.

- [ ] **Step 5: Commit**

```bash
git add src/components/reservations/TableSettings.tsx src/components/reservations/BookingSettingsForm.tsx "src/app/panel/[restaurantId]/reservas/ajustes"
git commit -m "Reservas → Ajustes: zonas, mesas, duración por tramos y reglas de la reserva online"
```

---

### Task 16: Botones de estado con deshacer

**Files:**
- Create: `src/components/reservations/ReservationActions.tsx`

**Interfaces:**
- Consumes: `changeReservationStatus`, `undoReservationStatus` (Task 11); `nextActions`, `canUndo`, `undoLabel` (Task 3); `STATUS_LABELS_ES`, `STATUS_STYLES` (Task 3); `GENERIC_ERROR` de `@/lib/menu/sortable`; `buttonClass`.
- Produces: `<ReservationActions restaurantId reservationId status previousStatus who readOnly?>` (cliente): estado optimista con `useOptimistic`, botones de la transición (los del estado confirmado por el servidor) con `aria-label` «<botón>: <quién>», `aria-disabled` mientras se guarda (sin doble envío), región `aria-live` siempre montada y, al acabar, foco a «Deshacer» (si lo hay) o al estado (`tabIndex={-1}`).

Lee antes: la documentación de React 19 de `useOptimistic` y `useTransition` (en `node_modules/react` no hay docs: sigue el patrón de `src/components/menu/UnavailableSwitch.tsx`).

- [ ] **Step 1: Componente**

Create `src/components/reservations/ReservationActions.tsx`:

```tsx
'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { changeReservationStatus, undoReservationStatus } from '@/lib/actions/reservations';
import { GENERIC_ERROR } from '@/lib/menu/sortable';
import { STATUS_LABELS_ES, STATUS_STYLES, type ReservationStatus } from '@/lib/reservations/codes';
import { canUndo, nextActions, undoLabel } from '@/lib/reservations/transitions';

const TONES = { primary: 'primary', secondary: 'secondary', danger: 'danger' } as const;

/**
 * Estado de una reserva y sus botones (Confirmar, Sentar, Finalizar, No ha venido, Cancelar… y Deshacer).
 * El estado cambia al momento (optimista) y, si falla, vuelve al confirmado por el servidor. Mientras se guarda, los
 * botones quedan aria-disabled (sin perder el foco) y no se envía dos veces. Al acabar, el foco va a «Deshacer» o al
 * estado, y el resultado se anuncia en una región aria-live que siempre está.
 */
export function ReservationActions({
  restaurantId,
  reservationId,
  status,
  previousStatus,
  who,
  readOnly = false,
}: {
  restaurantId: string;
  reservationId: string;
  status: ReservationStatus;
  previousStatus: ReservationStatus | null;
  /** Para los nombres accesibles: 'García, 21:00'. */
  who: string;
  readOnly?: boolean;
}) {
  const [shown, setShown] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const busy = useRef(false);
  const moveFocus = useRef(false);
  const statusRef = useRef<HTMLSpanElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending || !moveFocus.current) return;
    moveFocus.current = false;
    (undoRef.current ?? statusRef.current)?.focus();
  }, [pending, status]);

  function run(next: ReservationStatus | null) {
    if (busy.current || readOnly) return;
    busy.current = true;
    setMessage({ text: '', error: false });
    startTransition(async () => {
      if (next) setShown(next);
      let result: { error?: string; success?: string };
      try {
        result = next
          ? await changeReservationStatus(restaurantId, reservationId, next)
          : await undoReservationStatus(restaurantId, reservationId);
      } catch {
        result = { error: GENERIC_ERROR };
      }
      busy.current = false;
      if (result.error) {
        setMessage({ text: result.error, error: true });
      } else {
        moveFocus.current = true;
        setMessage({ text: `${who}: ${result.success ?? 'Hecho.'}`, error: false });
      }
    });
  }

  const actions = readOnly ? [] : nextActions(status);
  const undo = !readOnly && canUndo(status, previousStatus);
  const disabledProps = pending ? { 'aria-disabled': true as const } : {};

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          ref={statusRef}
          tabIndex={-1}
          aria-busy={pending}
          className={`inline-flex rounded-full border-2 px-2.5 py-0.5 text-xs font-bold outline-offset-2 focus-visible:outline-3 focus-visible:outline-navy ${STATUS_STYLES[shown]}`}
        >
          <span className="sr-only">Estado: </span>
          {STATUS_LABELS_ES[shown]}
        </span>
        {actions.map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => run(a.to)}
            aria-label={`${a.label}: ${who}`}
            {...disabledProps}
            className={buttonClass(TONES[a.tone], 'px-3 py-1.5 text-sm aria-disabled:cursor-wait aria-disabled:opacity-60')}
          >
            {a.label}
          </button>
        ))}
        {undo && (
          <button
            ref={undoRef}
            type="button"
            onClick={() => run(null)}
            aria-label={`${undoLabel(status)}: ${who}`}
            {...disabledProps}
            className={buttonClass('ghost', 'px-2 py-1.5 text-sm aria-disabled:cursor-wait aria-disabled:opacity-60')}
          >
            {undoLabel(status)}
          </button>
        )}
      </div>
      <p aria-live="polite" className={`text-sm font-medium ${message.error ? 'text-red-700' : 'text-muted'}`}>
        {message.text}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Comprobar**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sin errores; 444 pruebas unitarias en verde.

- [ ] **Step 3: Commit**

```bash
git add src/components/reservations/ReservationActions.tsx
git commit -m "Reservas: botones de estado optimistas con deshacer, foco estable y anuncio en aria-live"
```

---

### Task 17: Vista del día

**Files:**
- Create: `src/components/reservations/ReservationItem.tsx`, `src/app/panel/[restaurantId]/reservas/page.tsx`

**Interfaces:**
- Consumes: `ReservationActions` (Task 16); `CustomerWarnings`, `DayPicker`, `RealtimeRefresh`, `ReservationsNav` (Task 14); `getBookingConfig`, `getBookingDay` (Task 8); `groupByService`, `servicesForDate`, `summarize` (Task 5); `addDays`, `dateParam`, `formatTime`, `serviceDayWindow` (Task 4); `isActiveStatus`, `SOURCE_LABELS_ES` (Task 3); `customerWarnings` (Task 8); `formatPhoneDisplay` (Task 3); `todayInTimeZone`, `formatRange` de `@/lib/schedule`.
- Produces: `reservationName(r): string` («Sin nombre» en un walk-in sin datos), `tablesText(tableIds, tableNames): string` («T4 + T5» o «Sin mesa»), `<ReservationItem restaurantId reservation tableNames timeZone readOnly>`; la página `/panel/[id]/reservas?fecha=AAAA-MM-DD&aviso=creada|walk-in`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` es una promesa).

- [ ] **Step 1: Una reserva en la lista**

Create `src/components/reservations/ReservationItem.tsx`:

```tsx
import Link from 'next/link';
import { CustomerWarnings } from '@/components/reservations/CustomerWarnings';
import { ReservationActions } from '@/components/reservations/ReservationActions';
import { SOURCE_LABELS_ES } from '@/lib/reservations/codes';
import { customerWarnings } from '@/lib/reservations/customers';
import { formatPhoneDisplay } from '@/lib/reservations/phone';
import type { PanelReservation } from '@/lib/reservations/rows';
import { formatTime } from '@/lib/reservations/time';

/** Nombre que se enseña: el del cliente o, en un walk-in sin datos, «Sin nombre». */
export function reservationName(r: Pick<PanelReservation, 'customer'>): string {
  return r.customer?.name ?? 'Sin nombre';
}

/** 'T4 + T5' o 'Sin mesa'. */
export function tablesText(tableIds: readonly string[], tableNames: ReadonlyMap<string, string>): string {
  return tableIds.length === 0 ? 'Sin mesa' : tableIds.map((id) => tableNames.get(id) ?? '¿?').join(' + ');
}

/** Una reserva en la lista del día: hora, nombre, personas, mesas, notas, avisos del cliente y estado con sus botones. */
export function ReservationItem({
  restaurantId,
  reservation: r,
  tableNames,
  timeZone,
  readOnly,
}: {
  restaurantId: string;
  reservation: PanelReservation;
  tableNames: ReadonlyMap<string, string>;
  timeZone: string;
  readOnly: boolean;
}) {
  const time = formatTime(r.startMs, timeZone);
  const name = reservationName(r);
  return (
    <li className="flex flex-col gap-3 rounded-[6px] border-2 border-ink/10 bg-white p-3 sm:flex-row sm:items-start">
      <p className="w-16 shrink-0 text-xl font-extrabold tabular-nums">{time}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-bold">
          <Link
            href={`/panel/${restaurantId}/reservas/${r.id}`}
            className="text-navy hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            {name}
          </Link>{' '}
          · {r.partySize} {r.partySize === 1 ? 'persona' : 'personas'} · {tablesText(r.tableIds, tableNames)}
        </p>
        <p className="text-sm text-muted">
          {SOURCE_LABELS_ES[r.source]}
          {r.customer?.phone && ` · ${formatPhoneDisplay(r.customer.phone)}`}
        </p>
        {r.notes && (
          <p className="text-sm">
            <span className="font-bold">Nota del cliente:</span> {r.notes}
          </p>
        )}
        {r.internalNotes && (
          <p className="text-sm">
            <span className="font-bold">Nota interna:</span> {r.internalNotes}
          </p>
        )}
        {r.customer && <CustomerWarnings warnings={customerWarnings(r.customer)} />}
      </div>
      <div className="sm:max-w-sm">
        <ReservationActions
          restaurantId={restaurantId}
          reservationId={r.id}
          status={r.status}
          previousStatus={r.previousStatus}
          who={`${name}, ${time}`}
          readOnly={readOnly}
        />
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Página del día**

Create `src/app/panel/[restaurantId]/reservas/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { DayPicker } from '@/components/reservations/DayPicker';
import { RealtimeRefresh } from '@/components/reservations/RealtimeRefresh';
import { ReservationItem } from '@/components/reservations/ReservationItem';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { buttonClass } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { isActiveStatus } from '@/lib/reservations/codes';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { groupByService, servicesForDate, summarize } from '@/lib/reservations/day';
import type { PanelReservation } from '@/lib/reservations/rows';
import { addDays, dateParam, formatTime, serviceDayWindow } from '@/lib/reservations/time';
import { formatRange, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Reservas' };

const NOTICES: Record<string, string> = {
  creada: 'Reserva guardada.',
  'walk-in': 'Walk-in sentado.',
};

function SummaryLine({ items }: { items: PanelReservation[] }) {
  const s = summarize(items);
  return (
    <p className="text-sm text-muted">
      {s.reservations === 1 ? '1 reserva' : `${s.reservations} reservas`} · {s.covers === 1 ? '1 persona' : `${s.covers} personas`}
      {s.pending > 0 && ` · ${s.pending === 1 ? '1 pendiente' : `${s.pending} pendientes`}`}
    </p>
  );
}

export default async function ReservationsDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const today = todayInTimeZone(tz);
  const date = dateParam(sp.fecha, today);
  const day = await getBookingDay(restaurantId, date, tz);
  const services = servicesForDate(date, config.services, config.exceptions);
  const { groups, outside } = groupByService(
    day.reservations,
    date,
    tz,
    services,
    servicesForDate(addDays(date, -1), config.services, config.exceptions),
  );
  const ofTheDay = [...groups.flatMap((g) => g.items), ...outside];
  const unassigned = ofTheDay.filter((r) => isActiveStatus(r.status) && r.tableIds.length === 0);
  const withTable = (items: PanelReservation[]) => items.filter((r) => !unassigned.includes(r));
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
  const canConfigure = can(ctx.role, 'settings.booking');
  const readOnly = ctx.readOnly;
  const notice = typeof sp.aviso === 'string' && Object.hasOwn(NOTICES, sp.aviso) ? NOTICES[sp.aviso] : null;
  const base = `/panel/${restaurantId}/reservas`;
  const item = (r: PanelReservation) => (
    <ReservationItem key={r.id} restaurantId={restaurantId} reservation={r} tableNames={tableNames} timeZone={tz} readOnly={readOnly} />
  );
  const window = serviceDayWindow(date, tz);
  const dayBlocks = day.blocks.filter((b) => b.startMs < window.to && b.endMs > window.from);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={date} canConfigure={canConfigure} />
      <header className="flex flex-col gap-3">
        <DayPicker path={base} date={date} today={today} />
        {!readOnly && (
          <div className="flex flex-wrap gap-3">
            <Link href={`${base}/nueva?fecha=${date}`} className={buttonClass('primary')}>
              Nueva reserva
            </Link>
            <Link href={`${base}/walk-in`} className={buttonClass('secondary')}>
              Walk-in (sin reserva)
            </Link>
          </div>
        )}
        <RealtimeRefresh restaurantId={restaurantId} />
      </header>

      {notice && <Notice tone="success">{notice}</Notice>}

      {config.tables.length === 0 && (
        <Notice tone="info">
          Aún no tienes mesas.{' '}
          {canConfigure ? (
            <Link href={`${base}/ajustes#mesas`} className="font-bold text-navy underline">
              Crea tus mesas
            </Link>
          ) : (
            'Pide a tu encargado que cree las mesas'
          )}{' '}
          para asignarlas a las reservas.
        </Notice>
      )}

      {unassigned.length > 0 && (
        <SectionCard title="Sin mesa asignada" intro="Reservas guardadas sin mesa. Ábrelas para darles una cuando haya hueco.">
          <ul className="flex flex-col gap-3">{unassigned.map(item)}</ul>
        </SectionCard>
      )}

      {groups.length === 0 && (
        <Notice tone="info">
          Este día no tienes servicios en el horario. Puedes guardar reservas igualmente: salen en «Fuera de horario».
        </Notice>
      )}

      {groups.map((g) => (
        <SectionCard key={g.service.key} title={`${g.service.name} · ${formatRange(g.service.startMinute, g.service.endMinute)}`}>
          <SummaryLine items={g.items} />
          {withTable(g.items).length === 0 ? (
            <p className="text-sm text-muted">No hay reservas con mesa en este servicio.</p>
          ) : (
            <ul className="flex flex-col gap-3">{withTable(g.items).map(item)}</ul>
          )}
        </SectionCard>
      ))}

      {outside.length > 0 && (
        <SectionCard title="Fuera de horario" intro="Reservas a una hora en la que no hay ningún servicio.">
          <SummaryLine items={outside} />
          <ul className="flex flex-col gap-3">{withTable(outside).map(item)}</ul>
        </SectionCard>
      )}

      {dayBlocks.length > 0 && (
        <SectionCard title="Bloqueos">
          <ul className="flex flex-col gap-1 text-sm">
            {dayBlocks.map((b) => (
              <li key={b.id}>
                <strong>{b.tableId ? (tableNames.get(b.tableId) ?? 'Mesa') : 'Todo el restaurante'}</strong> · {formatTime(b.startMs, tz)}–
                {formatTime(b.endMs, tz)}
                {b.reason && ` · ${b.reason}`}
              </li>
            ))}
          </ul>
          {canConfigure && (
            <Link href={`${base}/bloqueos?fecha=${date}`} className="text-sm font-bold text-navy hover:underline">
              Gestionar bloqueos
            </Link>
          )}
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Comprobar**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; el build lista `ƒ /panel/[restaurantId]/reservas`.

- [ ] **Step 4: Commit**

```bash
git add src/components/reservations/ReservationItem.tsx "src/app/panel/[restaurantId]/reservas/page.tsx"
git commit -m "Reservas: vista del día por servicio con resumen, sin mesa asignada, fuera de horario y bloqueos"
```

---

### Task 18: Nueva reserva por teléfono y ficha de la reserva

**Files:**
- Create: `src/components/reservations/TableCheckboxes.tsx`, `src/components/reservations/ReservationForm.tsx`, `src/app/panel/[restaurantId]/reservas/nueva/page.tsx`, `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`

**Interfaces:**
- Consumes: `createPhoneReservation`, `updateReservation`, `lookupCustomer` (Task 11); `freeTables`, `getAvailableSlots`, `proposeTable`, `capacityOf` (Task 6); `resolveMinute`, `servicesForDate`, `slotMinutes`, `serviceDateOf` (Task 5); `DURATION_OPTIONS`, `durationFor`, `formatDuration` (Task 4); `zonedTimeToUtc`, `dateParam`, `formatDayEs`, `formatTime` (Task 4); `getBookingConfig`, `getBookingDay`, `getReservationStart` (Task 8); `ActionForm`, `FormField`, `FormSelect`, `FormTextArea`, `useActionForm`; `ReservationActions` (Task 16); `reservationName`, `tablesText` (Task 17); `CustomerWarnings`, `ReservationsNav` (Task 14).
- Produces: `<TableCheckboxes name? legend free all selected onChange partySize error?>`; `type ReservationFormInitial = { time; partySize; durationMin: number | null; tableMode; tableIds; notes; internalNotes }`; `<ReservationForm mode="create"|"edit" restaurantId reservationId? date path timeZone services tables occupancy blocks settings initial>`; páginas `/reservas/nueva?fecha&hora&mesa&personas` y `/reservas/[reservationId]?fecha&aviso=guardada`.

Lee antes: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` (`router.replace(href, { scroll: false })`, `router.refresh()`) y `not-found.md`.

- [ ] **Step 1: Mesas a mano**

Create `src/components/reservations/TableCheckboxes.tsx`:

```tsx
'use client';

import { capacityOf, type BookingTable } from '@/lib/reservations/availability';

/**
 * Mesas para elegir a mano (una o varias): las libres a esa hora y, si ya estaban elegidas, también las que no lo
 * están (avisando). Dice si entre todas caben las personas.
 */
export function TableCheckboxes({
  name = 'tableIds',
  legend,
  free,
  all,
  selected,
  onChange,
  partySize,
  error,
}: {
  name?: string;
  legend: string;
  free: readonly BookingTable[];
  all: readonly BookingTable[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  partySize: number;
  error?: string;
}) {
  const freeIds = new Set(free.map((t) => t.id));
  const extra = all.filter((t) => selected.includes(t.id) && !freeIds.has(t.id));
  const options = [...free, ...extra];
  const chosen = all.filter((t) => selected.includes(t.id));
  const capacity = capacityOf(chosen);
  const errId = `f-${name}-err`;
  const sumId = `f-${name}-sum`;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${errId} ${sumId}` : sumId}>
      <legend className="mb-1 text-sm font-bold">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted">No hay ninguna mesa libre a esa hora.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.map((t) => (
            <li key={t.id}>
              <label className="flex items-center gap-2 rounded-[6px] border-2 border-ink/10 px-3 py-2 focus-within:border-navy">
                <input
                  type="checkbox"
                  name={name}
                  value={t.id}
                  checked={selected.includes(t.id)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id))}
                  className="size-4 accent-navy"
                />
                <span>
                  <span className="font-bold">{t.name}</span> · {t.zoneName} · {t.minCapacity}–{t.maxCapacity} personas
                  {!freeIds.has(t.id) && <span className="font-bold text-red-700"> · ocupada o bloqueada a esa hora</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p id={sumId} className={`text-sm ${chosen.length > 0 && capacity < partySize ? 'font-bold text-red-700' : 'text-muted'}`}>
        {chosen.length === 0 ? 'Ninguna mesa elegida.' : `Sitio para ${capacity} de ${partySize} ${partySize === 1 ? 'persona' : 'personas'}.`}
      </p>
      {error && (
        <p id={errId} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 2: Formulario de reserva**

Create `src/components/reservations/ReservationForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ActionForm, FormField, FormSelect, FormTextArea, useActionForm } from '@/components/forms/ActionForm';
import { CustomerWarnings } from '@/components/reservations/CustomerWarnings';
import { TableCheckboxes } from '@/components/reservations/TableCheckboxes';
import { Notice } from '@/components/ui/Notice';
import { createPhoneReservation, lookupCustomer, updateReservation } from '@/lib/actions/reservations';
import { GENERIC_ERROR } from '@/lib/menu/sortable';
import { freeTables, getAvailableSlots, proposeTable, type BlockSpan, type BookingTable, type Occupancy } from '@/lib/reservations/availability';
import type { CustomerWarning } from '@/lib/reservations/customers';
import { resolveMinute, type DayService } from '@/lib/reservations/day';
import { DURATION_OPTIONS, durationFor, formatDuration, type BookingSettings } from '@/lib/reservations/settings';
import { zonedTimeToUtc } from '@/lib/reservations/time';
import type { TableMode } from '@/lib/reservations/validation';
import { minutesToTime, timeToMinutes } from '@/lib/schedule';

export type ReservationFormInitial = {
  time: string;
  partySize: number;
  durationMin: number | null;
  tableMode: TableMode;
  tableIds: string[];
  notes: string;
  internalNotes: string;
};

type Props = {
  mode: 'create' | 'edit';
  restaurantId: string;
  reservationId?: string;
  /** La fecha de los datos que trae la página (servicios, ocupación y bloqueos). */
  date: string;
  /** URL de la página, para volver a pedir los datos al cambiar de fecha. */
  path: string;
  timeZone: string;
  services: DayService[];
  tables: BookingTable[];
  occupancy: Occupancy[];
  blocks: BlockSpan[];
  settings: Pick<BookingSettings, 'defaultDurationMin' | 'durationRules'>;
  initial: ReservationFormInitial;
};

const smallChip =
  'rounded-[6px] border-2 px-2.5 py-1 text-sm font-bold tabular-nums focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy';

/** Si la BD rechaza (p. ej., la mesa se acaba de ocupar), se vuelven a pedir los datos para proponer otra. */
function RefreshOnError() {
  const { state } = useActionForm();
  const router = useRouter();
  useEffect(() => {
    if (state.error) router.refresh();
  }, [state, router]);
  return null;
}

/**
 * Nueva reserva por teléfono o cambio de una reserva. Calcula al momento (módulo puro) las horas con hueco y la
 * mesa más pequeña que sirve; la BD lo vuelve a comprobar al guardar. Si no hay hueco, ofrece guardarla sin mesa.
 */
export function ReservationForm(props: Props) {
  const { mode, restaurantId, timeZone, services, tables, occupancy, blocks, settings, initial } = props;
  const router = useRouter();
  const [date, setDate] = useState(props.date);
  const [time, setTime] = useState(initial.time);
  const [party, setParty] = useState(String(initial.partySize));
  const [duration, setDuration] = useState(initial.durationMin === null ? '' : String(initial.durationMin));
  const [tableMode, setTableMode] = useState<TableMode>(initial.tableMode);
  const [tableIds, setTableIds] = useState<string[]>(initial.tableIds);
  const [name, setName] = useState('');
  const [lookup, setLookup] = useState<{ text: string; warnings: CustomerWarning[] }>({ text: '', warnings: [] });
  const [looking, startLookup] = useTransition();

  const partySize = /^\d+$/.test(party) ? Number(party) : 0;
  const rawMinute = timeToMinutes(time);
  const ready = date === props.date && partySize >= 1 && partySize <= 50 && rawMinute !== null;
  const autoDuration = durationFor(Math.max(partySize, 1), settings);
  const durationMin = duration === '' ? autoDuration : Number(duration);
  const ignore = props.reservationId;
  let proposal: BookingTable | null = null;
  let free: BookingTable[] = [];
  if (ready) {
    const startMs = zonedTimeToUtc(date, resolveMinute(rawMinute, services), timeZone);
    const endMs = startMs + durationMin * 60_000;
    proposal = proposeTable(tables, partySize, startMs, endMs, occupancy, blocks, { ignoreReservationId: ignore });
    free = freeTables(tables, startMs, endMs, occupancy, blocks, ignore);
  }
  const slots = ready
    ? getAvailableSlots({ date, timeZone, services, partySize, durationMin, tables, occupancy, blocks, ignoreReservationId: ignore })
    : [];
  const noRoom = ready && tableMode === 'auto' && !proposal;
  const sentMode: TableMode = noRoom ? 'none' : tableMode;
  const currentNames = tables.filter((t) => initial.tableIds.includes(t.id)).map((t) => t.name);
  const durationOptions = [...new Set([...DURATION_OPTIONS, ...(initial.durationMin ? [initial.durationMin] : [])])].sort((a, b) => a - b);

  function changeDate(value: string) {
    setDate(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value !== props.date) {
      router.replace(`${props.path}?${new URLSearchParams({ fecha: value }).toString()}`, { scroll: false });
    }
  }

  function findCustomer(phone: string) {
    if (mode !== 'create' || phone.trim().length < 6) return;
    startLookup(async () => {
      try {
        const result = await lookupCustomer(restaurantId, phone);
        if (result.error) setLookup({ text: result.error, warnings: [] });
        else if (!result.customer) setLookup({ text: 'Cliente nuevo: se guardará su ficha con esta reserva.', warnings: [] });
        else {
          const found = result.customer;
          setName((current) => (current.trim() === '' ? found.name : current));
          setLookup({ text: `Cliente encontrado: ${found.name}.`, warnings: found.warnings });
        }
      } catch {
        setLookup({ text: GENERIC_ERROR, warnings: [] });
      }
    });
  }

  const modes: { value: TableMode; label: string }[] = [
    ...(mode === 'edit' && initial.tableIds.length > 0 ? [{ value: 'keep' as const, label: `Dejar ${currentNames.join(' + ')}` }] : []),
    { value: 'auto', label: ready ? (proposal ? `La que proponemos: ${proposal.name} (${proposal.zoneName}, ${proposal.minCapacity}–${proposal.maxCapacity})` : 'La que proponemos: no queda ninguna libre') : 'La que proponemos' },
    { value: 'manual', label: 'Elegir una o varias a mano' },
    { value: 'none', label: 'Sin mesa (forzar)' },
  ];

  return (
    <ActionForm
      action={mode === 'create' ? createPhoneReservation : updateReservation}
      hidden={{ restaurantId, ...(props.reservationId ? { reservationId: props.reservationId } : {}) }}
      submitLabel={mode === 'edit' ? 'Guardar cambios' : noRoom || tableMode === 'none' ? 'Guardar sin mesa' : 'Guardar reserva'}
    >
      <RefreshOnError />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Personas" name="partySize" type="number" inputMode="numeric" min={1} max={50} value={party} onChange={(e) => setParty(e.target.value)} required />
        <FormField label="Fecha" name="date" type="date" value={date} onChange={(e) => changeDate(e.target.value)} required />
        <FormField label="Hora" name="time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>

      {date !== props.date ? (
        <p className="text-sm text-muted" role="status">
          Cargando los huecos de ese día…
        </p>
      ) : services.length === 0 ? (
        <p className="text-sm text-muted">Ese día no hay servicios en el horario: escribe la hora a mano.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {services.map((s) => {
            const own = slots.filter((x) => x.serviceKey === s.key);
            return (
              <div key={s.key} className="flex flex-col gap-1.5">
                <p className="text-sm font-bold">
                  {s.name} <span className="font-normal text-muted">· toca una hora (en gris, sin mesa libre para {partySize || '…'})</span>
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {own.map((x) => {
                    const label = minutesToTime(x.minute);
                    const selected = rawMinute !== null && resolveMinute(rawMinute, services) === x.minute;
                    return (
                      <li key={x.minute}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setTime(label)}
                          className={
                            smallChip +
                            (selected ? ' border-ink bg-ink text-white' : x.table ? ' border-navy bg-white text-navy' : ' border-ink/15 bg-paper text-muted')
                          }
                        >
                          {label}
                          <span className="sr-only">{x.table ? ', con mesa libre' : ', sin mesa libre'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <FormSelect
        label="Duración"
        name="duration"
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        options={[{ value: '', label: `La de su tamaño de grupo (${formatDuration(autoDuration)})` }, ...durationOptions.map((m) => ({ value: String(m), label: formatDuration(m) }))]}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">Mesa</legend>
        {modes.map((m) => (
          <label key={m.value} className="flex items-start gap-2">
            <input type="radio" name="tableModeChoice" value={m.value} checked={tableMode === m.value} onChange={() => setTableMode(m.value)} className="mt-1 size-4 accent-navy" />
            <span>{m.label}</span>
          </label>
        ))}
        <input type="hidden" name="tableMode" value={sentMode} />
        {tableMode === 'keep' && initial.tableIds.map((id) => <input key={id} type="hidden" name="tableIds" value={id} />)}
      </fieldset>
      {noRoom && (
        <Notice tone="info">
          No hay hueco: ninguna mesa libre para {partySize} a las {time}. Puedes elegir mesas a mano, cambiar la hora o guardarla sin mesa (saldrá en «Sin mesa
          asignada»).
        </Notice>
      )}
      {tableMode === 'manual' && <ManualTables free={free} all={tables} selected={tableIds} onChange={setTableIds} partySize={partySize} />}

      {mode === 'create' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Teléfono"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            hint="Sin prefijo es de España; si es de fuera, empieza por + y el prefijo."
            onBlur={(e) => findCustomer(e.target.value)}
            required
          />
          <FormField label="Nombre" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
          <FormField label="Email (opcional)" name="email" type="email" autoComplete="off" />
        </div>
      )}
      {mode === 'create' && (
        <div aria-live="polite" aria-busy={looking} className="flex flex-col gap-1 text-sm">
          {lookup.text && <p>{lookup.text}</p>}
          <CustomerWarnings warnings={lookup.warnings} />
        </div>
      )}

      <FormTextArea label="Notas del cliente (opcional)" name="notes" defaultValue={initial.notes} maxLength={500} rows={2} />
      <FormTextArea label="Nota interna (opcional, solo la ve el equipo)" name="internalNotes" defaultValue={initial.internalNotes} maxLength={500} rows={2} />
    </ActionForm>
  );
}

function ManualTables(props: { free: BookingTable[]; all: BookingTable[]; selected: string[]; onChange: (ids: string[]) => void; partySize: number }) {
  const { state } = useActionForm();
  return <TableCheckboxes legend="Mesas" {...props} error={state.fieldErrors?.tableIds} />;
}
```

- [ ] **Step 3: Página «Nueva reserva»**

Create `src/app/panel/[restaurantId]/reservas/nueva/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { ReservationForm } from '@/components/reservations/ReservationForm';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { servicesForDate, slotMinutes } from '@/lib/reservations/day';
import { dateParam, formatDayEs } from '@/lib/reservations/time';
import { minutesToTime, timeToMinutes, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Nueva reserva' };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default async function NewReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  const config = await getBookingConfig(restaurantId);
  const date = dateParam(sp.fecha, todayInTimeZone(config.timezone));
  const day = await getBookingDay(restaurantId, date, config.timezone);
  const services = servicesForDate(date, config.services, config.exceptions);
  const base = `/panel/${restaurantId}/reservas`;

  // Desde la cuadrícula llegan la hora y la mesa del hueco; si no, la primera hora del día y la mesa propuesta.
  const hora = one(sp.hora);
  const firstSlot = services[0] ? slotMinutes(services[0])[0] : null;
  const time = timeToMinutes(hora) !== null ? hora : firstSlot !== null ? minutesToTime(firstSlot) : '21:00';
  const personas = Number(one(sp.personas));
  const partySize = Number.isInteger(personas) && personas >= 1 && personas <= 50 ? personas : 2;
  const mesa = one(sp.mesa);
  const table = config.tables.find((t) => t.id === mesa && t.active);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={date} canConfigure={can(ctx.role, 'settings.booking')} />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Nueva reserva</h1>
        <p className="mt-1 text-muted">
          Por teléfono o en persona. Te proponemos la mesa más pequeña que sirve.{' '}
          <Link href={`${base}?fecha=${date}`} className="font-bold text-navy hover:underline">
            Volver al {formatDayEs(date)}
          </Link>
        </p>
      </header>
      {ctx.readOnly ? (
        <Notice tone="info">En modo soporte no se pueden crear reservas.</Notice>
      ) : (
        <SectionCard title="Datos de la reserva">
          <ReservationForm
            mode="create"
            restaurantId={restaurantId}
            date={date}
            path={`${base}/nueva`}
            timeZone={config.timezone}
            services={services}
            tables={config.tables}
            occupancy={day.occupancy}
            blocks={day.blocks}
            settings={config.settings}
            initial={{
              time,
              partySize,
              durationMin: null,
              tableMode: table ? 'manual' : 'auto',
              tableIds: table ? [table.id] : [],
              notes: '',
              internalNotes: '',
            }}
          />
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ficha de la reserva**

Create `src/app/panel/[restaurantId]/reservas/[reservationId]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerWarnings } from '@/components/reservations/CustomerWarnings';
import { ReservationActions } from '@/components/reservations/ReservationActions';
import { ReservationForm } from '@/components/reservations/ReservationForm';
import { reservationName, tablesText } from '@/components/reservations/ReservationItem';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { isActiveStatus, SOURCE_LABELS_ES } from '@/lib/reservations/codes';
import { customerWarnings } from '@/lib/reservations/customers';
import { getBookingConfig, getBookingDay, getReservationStart } from '@/lib/reservations/data';
import { serviceDateOf, servicesForDate } from '@/lib/reservations/day';
import { formatPhoneDisplay } from '@/lib/reservations/phone';
import { dateParam, formatDayEs, formatTime } from '@/lib/reservations/time';
import { uuidSchema } from '@/lib/validation/schemas';

export const metadata: Metadata = { title: 'Reserva' };

export default async function ReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string; reservationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId, reservationId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  if (!uuidSchema.safeParse(reservationId).success) notFound();
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const start = await getReservationStart(restaurantId, reservationId);
  if (start === null) notFound();
  const ownDate = serviceDateOf(start, tz, config.services, config.exceptions);
  // ?fecha=: al cambiarla en el formulario, se piden los huecos de ese otro día.
  const date = dateParam(sp.fecha, ownDate);
  const [own, other] = await Promise.all([
    getBookingDay(restaurantId, ownDate, tz),
    date === ownDate ? null : getBookingDay(restaurantId, date, tz),
  ]);
  const r = own.reservations.find((x) => x.id === reservationId);
  if (!r) notFound();
  const day = other ?? own;
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
  const name = reservationName(r);
  const time = formatTime(r.startMs, tz);
  const base = `/panel/${restaurantId}/reservas`;
  const editable = isActiveStatus(r.status) && !ctx.readOnly;

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={ownDate} canConfigure={can(ctx.role, 'settings.booking')} />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight">{name}</h1>
        <p className="text-muted">
          {formatDayEs(ownDate)} · {time}–{formatTime(r.endMs, tz)} · {r.partySize} {r.partySize === 1 ? 'persona' : 'personas'} ·{' '}
          {tablesText(r.tableIds, tableNames)} · {SOURCE_LABELS_ES[r.source]}
        </p>
        <Link href={`${base}?fecha=${ownDate}`} className="font-bold text-navy hover:underline">
          Volver al día
        </Link>
      </header>
      {sp.aviso === 'guardada' && <Notice tone="success">Cambios guardados.</Notice>}

      <SectionCard title="Estado">
        <ReservationActions
          restaurantId={restaurantId}
          reservationId={r.id}
          status={r.status}
          previousStatus={r.previousStatus}
          who={`${name}, ${time}`}
          readOnly={ctx.readOnly}
        />
      </SectionCard>

      {r.customer && (
        <SectionCard title="Cliente">
          <p>
            <strong>{r.customer.name}</strong>
            {r.customer.phone && ` · ${formatPhoneDisplay(r.customer.phone)}`}
            {r.customer.email && ` · ${r.customer.email}`}
          </p>
          <CustomerWarnings warnings={customerWarnings(r.customer)} />
        </SectionCard>
      )}

      {editable ? (
        <SectionCard title="Cambiar la reserva" intro="Hora, personas, duración, mesas y notas. Si cambias la hora o las mesas, comprobamos que sigan libres.">
          <ReservationForm
            mode="edit"
            restaurantId={restaurantId}
            reservationId={r.id}
            date={date}
            path={`${base}/${r.id}`}
            timeZone={tz}
            services={servicesForDate(date, config.services, config.exceptions)}
            tables={config.tables}
            occupancy={day.occupancy}
            blocks={day.blocks}
            settings={config.settings}
            initial={{
              time,
              partySize: r.partySize,
              durationMin: Math.round((r.endMs - r.startMs) / 60_000),
              tableMode: r.tableIds.length > 0 ? 'keep' : 'none',
              tableIds: r.tableIds,
              notes: r.notes ?? '',
              internalNotes: r.internalNotes ?? '',
            }}
          />
        </SectionCard>
      ) : (
        (r.notes || r.internalNotes) && (
          <SectionCard title="Notas">
            {r.notes && <p>Del cliente: {r.notes}</p>}
            {r.internalNotes && <p>Interna: {r.internalNotes}</p>}
          </SectionCard>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 5: Comprobar**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; el build lista `ƒ /panel/[restaurantId]/reservas/nueva` y `ƒ /panel/[restaurantId]/reservas/[reservationId]`.

- [ ] **Step 6: Commit**

```bash
git add src/components/reservations/TableCheckboxes.tsx src/components/reservations/ReservationForm.tsx "src/app/panel/[restaurantId]/reservas/nueva" "src/app/panel/[restaurantId]/reservas/[reservationId]"
git commit -m "Reservas: nueva reserva por teléfono con mesa propuesta, varias mesas o sin mesa, y ficha con cambios"
```

---

### Task 19: Walk-in

**Files:**
- Create: `src/components/reservations/WalkInForm.tsx`, `src/app/panel/[restaurantId]/reservas/walk-in/page.tsx`

**Interfaces:**
- Consumes: `createWalkIn` (Task 11); `freeTables`, `proposeTable` (Task 6); `durationFor`, `formatDuration` (Task 4); `TableCheckboxes` (Task 18); `getBookingConfig`, `getBookingDay` (Task 8); `formatTime` (Task 4); `ReservationsNav` (Task 14).
- Produces: `<WalkInForm restaurantId nowMs tables occupancy blocks settings>` (la mesa propuesta para ahora ya marcada; campos `partySize`, `tableIds`, `name`); la página `/panel/[id]/reservas/walk-in`. `nowMs` lo calcula el servidor fuera del componente (`react-hooks/purity`).

- [ ] **Step 1: Formulario**

Create `src/components/reservations/WalkInForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ActionForm, FormField, useActionForm } from '@/components/forms/ActionForm';
import { TableCheckboxes } from '@/components/reservations/TableCheckboxes';
import { createWalkIn } from '@/lib/actions/reservations';
import { freeTables, proposeTable, type BlockSpan, type BookingTable, type Occupancy } from '@/lib/reservations/availability';
import { durationFor, formatDuration, type BookingSettings } from '@/lib/reservations/settings';

/** Walk-in en un clic: personas, mesa libre ahora (la propuesta ya marcada) y nombre si lo dan. */
export function WalkInForm({
  restaurantId,
  nowMs,
  tables,
  occupancy,
  blocks,
  settings,
}: {
  restaurantId: string;
  /** La hora de la página: el servidor la manda para que todos los cálculos usen la misma. */
  nowMs: number;
  tables: BookingTable[];
  occupancy: Occupancy[];
  blocks: BlockSpan[];
  settings: Pick<BookingSettings, 'defaultDurationMin' | 'durationRules'>;
}) {
  const [party, setParty] = useState('2');
  const [picked, setPicked] = useState<string[] | null>(null);
  const partySize = /^\d+$/.test(party) ? Number(party) : 0;
  const duration = durationFor(Math.max(partySize, 1), settings);
  const endMs = nowMs + duration * 60_000;
  const free = freeTables(tables, nowMs, endMs, occupancy, blocks);
  const proposal = partySize > 0 ? proposeTable(tables, partySize, nowMs, endMs, occupancy, blocks) : null;
  const selected = picked ?? (proposal ? [proposal.id] : []);

  return (
    <ActionForm action={createWalkIn} hidden={{ restaurantId }} submitLabel="Sentar ahora" pendingLabel="Sentando…">
      <FormField
        label="Personas"
        name="partySize"
        type="number"
        inputMode="numeric"
        min={1}
        max={50}
        value={party}
        onChange={(e) => setParty(e.target.value)}
        hint={`Ocupan la mesa unos ${formatDuration(duration)}.`}
        required
      />
      <WalkInTables free={free} all={tables} selected={selected} onChange={setPicked} partySize={partySize} />
      <FormField label="Nombre (opcional)" name="name" maxLength={120} autoComplete="off" />
    </ActionForm>
  );
}

function WalkInTables(props: { free: BookingTable[]; all: BookingTable[]; selected: string[]; onChange: (ids: string[]) => void; partySize: number }) {
  const { state } = useActionForm();
  return <TableCheckboxes legend="Mesa (libres ahora; ya marcamos la más pequeña que sirve)" {...props} error={state.fieldErrors?.tableIds} />;
}
```

- [ ] **Step 2: Página**

Create `src/app/panel/[restaurantId]/reservas/walk-in/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { WalkInForm } from '@/components/reservations/WalkInForm';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { formatTime } from '@/lib/reservations/time';
import { todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Walk-in' };

/** Ahora, redondeado al minuto (como la BD, que sienta el walk-in con date_trunc('minute', now())). */
function nowToTheMinute(): number {
  return Math.floor(new Date().getTime() / 60_000) * 60_000;
}

export default async function WalkInPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  const config = await getBookingConfig(restaurantId);
  const today = todayInTimeZone(config.timezone);
  const day = await getBookingDay(restaurantId, today, config.timezone);
  const now = nowToTheMinute();

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={today} canConfigure={can(ctx.role, 'settings.booking')} />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Walk-in</h1>
        <p className="mt-1 text-muted">
          Gente que llega sin reserva: se sientan ya ({formatTime(now, config.timezone)}).{' '}
          <Link href={`/panel/${restaurantId}/reservas`} className="font-bold text-navy hover:underline">
            Volver a hoy
          </Link>
        </p>
      </header>
      {ctx.readOnly ? (
        <Notice tone="info">En modo soporte no se pueden sentar walk-ins.</Notice>
      ) : config.tables.length === 0 ? (
        <Notice tone="info">Aún no tienes mesas: créalas en Reservas → Ajustes.</Notice>
      ) : (
        <SectionCard title="¿Cuántos son?">
          <WalkInForm
            restaurantId={restaurantId}
            nowMs={now}
            tables={config.tables}
            occupancy={day.occupancy}
            blocks={day.blocks}
            settings={config.settings}
          />
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Comprobar**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; el build lista `ƒ /panel/[restaurantId]/reservas/walk-in`.

- [ ] **Step 4: Commit**

```bash
git add src/components/reservations/WalkInForm.tsx "src/app/panel/[restaurantId]/reservas/walk-in"
git commit -m "Reservas: walk-in en un clic con la mesa libre más pequeña ya marcada"
```

---

### Task 20: Cuadrícula mesas × horas

**Files:**
- Create: `src/components/reservations/ReservationGrid.tsx`, `src/app/panel/[restaurantId]/reservas/cuadricula/page.tsx`

**Interfaces:**
- Consumes: `buildGrid`, `moveFocus`, `segmentAt`, `freeCellLabel`, `reservationBarLabel`, `reservationBarText`, `blockLabel`, tipos `GridLayout`, `GridPos`, `GridReservation`, `GridSegment` (Task 7); `compareTablesForDisplay`, `BookingTable`, `BlockSpan` (Task 6); `servicesForDate` (Task 5); `dateParam`, `formatTime` (Task 4); `getBookingConfig`, `getBookingDay` (Task 8); `reservationName` (Task 17); `DayPicker`, `RealtimeRefresh`, `ReservationsNav` (Task 14).
- Produces: `<ReservationGrid restaurantId date timeZone layout tables reservations blocks readOnly label>` (cliente; `role="grid"`, filas `role="row"` con la columna de la mesa fija, un único `tabIndex={0}`); la página `/panel/[id]/reservas/cuadricula?fecha&servicio=<minuto de inicio>`. Cada hueco enlaza a `/reservas/nueva?fecha&hora&mesa`; cada barra, a `/reservas/<id>`.

- [ ] **Step 1: Componente**

Create `src/components/reservations/ReservationGrid.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { BlockSpan, BookingTable } from '@/lib/reservations/availability';
import {
  blockLabel,
  freeCellLabel,
  moveFocus,
  reservationBarLabel,
  reservationBarText,
  segmentAt,
  type GridLayout,
  type GridPos,
  type GridReservation,
  type GridSegment,
} from '@/lib/reservations/grid';
import { formatTime } from '@/lib/reservations/time';
import { minutesToTime } from '@/lib/schedule';

const BAR: Partial<Record<GridReservation['status'], string>> = {
  pending: 'border-orange-dark bg-peach-soft text-ink',
  confirmed: 'border-navy bg-on-navy-soft text-navy-dark',
  seated: 'border-ink bg-ink text-white',
};
const STRIPES: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(10,19,48,0.18) 0 6px, transparent 6px 12px)',
};
const focusRing = 'focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-navy';

/**
 * Cuadrícula mesas × horas de un servicio (filas = mesas por zona, columnas = cada 15 min). Un solo punto de
 * tabulación (role="grid"): con las flechas se va de tramo en tramo; Intro abre la reserva o una nueva en el hueco.
 * En el móvil se desplaza en horizontal; la columna de las mesas se queda fija.
 */
export function ReservationGrid({
  restaurantId,
  date,
  timeZone,
  layout,
  tables,
  reservations,
  blocks,
  readOnly,
  label,
}: {
  restaurantId: string;
  date: string;
  timeZone: string;
  layout: GridLayout;
  tables: BookingTable[];
  reservations: GridReservation[];
  blocks: BlockSpan[];
  readOnly: boolean;
  label: string;
}) {
  const [pos, setPos] = useState<GridPos>({ row: 0, col: 0 });
  const refs = useRef(new Map<string, HTMLElement>());
  const moved = useRef(false);
  const n = layout.columns.length;
  const template: CSSProperties = { gridTemplateColumns: `7.5rem repeat(${n}, minmax(2.75rem, 1fr))` };
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const resById = new Map(reservations.map((r) => [r.id, r]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const focusedSeg = layout.rows[pos.row] ? segmentAt(layout.rows[pos.row], pos.col) : null;
  const range = (startMs: number, endMs: number) => `${formatTime(startMs, timeZone)}–${formatTime(endMs, timeZone)}`;

  useEffect(() => {
    if (!moved.current || !focusedSeg) return;
    moved.current = false;
    refs.current.get(`${pos.row}:${focusedSeg.col}`)?.focus();
  }, [pos, focusedSeg]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = moveFocus(layout, pos, e.key);
    if (!next) return;
    e.preventDefault();
    moved.current = true;
    setPos(next);
  }

  function cell(rowIndex: number, seg: GridSegment) {
    const row = layout.rows[rowIndex];
    const table = tableById.get(row.tableId);
    const tableName = table?.name ?? 'Mesa';
    const key = `${rowIndex}:${seg.col}`;
    const isFocus = focusedSeg !== null && pos.row === rowIndex && focusedSeg.col === seg.col;
    const common = {
      ref: (el: HTMLElement | null) => {
        if (el) refs.current.set(key, el);
        else refs.current.delete(key);
      },
      tabIndex: isFocus ? 0 : -1,
      onFocus: () => setPos({ row: rowIndex, col: isFocus ? pos.col : seg.col }),
    };
    const place: CSSProperties = { gridColumn: `${seg.col + 2} / span ${seg.span}` };

    if (seg.kind === 'free') {
      const text = freeCellLabel(tableName, seg.minute);
      return (
        <div key={key} role="gridcell" style={place} className="border-l border-ink/10 p-0.5">
          {readOnly ? (
            <span {...common} aria-label={`${tableName}, ${minutesToTime(seg.minute)}, libre`} className={`block h-11 rounded-[4px] ${focusRing}`} />
          ) : (
            <Link
              {...common}
              href={`/panel/${restaurantId}/reservas/nueva?${new URLSearchParams({ fecha: date, hora: minutesToTime(seg.minute), mesa: row.tableId }).toString()}`}
              aria-label={text}
              title={text}
              className={`flex h-11 items-center justify-center rounded-[4px] text-transparent hover:bg-peach-soft hover:text-ink focus-visible:text-ink ${focusRing}`}
            >
              <span aria-hidden="true">+</span>
            </Link>
          )}
        </div>
      );
    }
    if (seg.kind === 'reservation') {
      const r = resById.get(seg.reservationId);
      if (!r) return null;
      return (
        <div key={key} role="gridcell" aria-colspan={seg.span} style={place} className="p-0.5">
          <Link
            {...common}
            href={`/panel/${restaurantId}/reservas/${r.id}`}
            aria-label={reservationBarLabel(r, tableName, range(r.startMs, r.endMs))}
            className={`flex h-11 items-center truncate rounded-[4px] border-2 px-2 text-sm font-bold ${BAR[r.status] ?? ''} ${focusRing}`}
          >
            {reservationBarText(r)}
          </Link>
        </div>
      );
    }
    const b = blockById.get(seg.blockId);
    return (
      <div
        key={key}
        role="gridcell"
        aria-colspan={seg.span}
        style={place}
        className="p-0.5"
      >
        <span
          {...common}
          role="img"
          aria-label={blockLabel(tableName, b ? range(b.startMs, b.endMs) : '', b?.reason ?? null)}
          style={STRIPES}
          className={`flex h-11 items-center truncate rounded-[4px] border-2 border-ink/20 px-2 text-xs font-bold text-muted ${focusRing}`}
        >
          <span aria-hidden="true">{b?.reason ?? 'Bloqueada'}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[6px] border-2 border-ink/10 bg-white">
      <div role="grid" aria-label={label} aria-rowcount={layout.rows.length + 1} aria-colcount={n + 1} onKeyDown={onKeyDown} className="min-w-max">
        <div role="row" style={template} className="grid border-b-2 border-ink/10 text-xs font-bold text-muted">
          <div role="columnheader" className="sticky left-0 z-10 bg-white px-2 py-2">
            Mesa
          </div>
          {layout.columns.map((m) => (
            <div key={m} role="columnheader" className="border-l border-ink/10 px-1 py-2 tabular-nums">
              {m % 60 === 0 ? minutesToTime(m) : <span className="sr-only">{minutesToTime(m)}</span>}
            </div>
          ))}
        </div>
        {layout.rows.map((row, i) => {
          const table = tableById.get(row.tableId);
          return (
            <div key={row.tableId} role="row" style={template} className="grid border-b border-ink/10">
              <div role="rowheader" className="sticky left-0 z-10 flex flex-col justify-center bg-white px-2 py-1">
                <span className="font-bold">{table?.name}</span>
                <span className="text-xs text-muted">
                  {table?.zoneName} · {table?.minCapacity}–{table?.maxCapacity}
                  {table && !table.active && ' · desactivada'}
                </span>
              </div>
              {row.segments.map((seg) => cell(i, seg))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Página**

Create `src/app/panel/[restaurantId]/reservas/cuadricula/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { DayPicker } from '@/components/reservations/DayPicker';
import { RealtimeRefresh } from '@/components/reservations/RealtimeRefresh';
import { ReservationGrid } from '@/components/reservations/ReservationGrid';
import { reservationName } from '@/components/reservations/ReservationItem';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { Notice } from '@/components/ui/Notice';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { compareTablesForDisplay } from '@/lib/reservations/availability';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { servicesForDate } from '@/lib/reservations/day';
import { buildGrid } from '@/lib/reservations/grid';
import { dateParam } from '@/lib/reservations/time';
import { formatRange, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Cuadrícula de reservas' };

export default async function GridPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const today = todayInTimeZone(tz);
  const date = dateParam(sp.fecha, today);
  const services = servicesForDate(date, config.services, config.exceptions);
  const service = services.find((s) => s.key === sp.servicio) ?? services[0] ?? null;
  const day = await getBookingDay(restaurantId, date, tz);
  const tables = [...config.tables].sort(compareTablesForDisplay);
  const reservations = day.reservations.map((r) => ({
    id: r.id,
    startMs: r.startMs,
    endMs: r.endMs,
    tableIds: r.tableIds,
    status: r.status,
    name: reservationName(r),
    partySize: r.partySize,
  }));
  const path = `/panel/${restaurantId}/reservas/cuadricula`;

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="cuadricula" date={date} canConfigure={can(ctx.role, 'settings.booking')} />
      <header className="flex flex-col gap-3">
        <DayPicker path={path} date={date} today={today} keep={service ? { servicio: service.key } : {}} />
        {services.length > 1 && (
          <nav aria-label="Servicio" className="flex flex-wrap gap-2">
            {services.map((s) => (
              <Link
                key={s.key}
                href={`${path}?fecha=${date}&servicio=${s.key}`}
                aria-current={s.key === service?.key ? 'page' : undefined}
                className={`rounded-[6px] border-2 px-3 py-1.5 text-sm font-bold ${s.key === service?.key ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white hover:bg-peach-soft'}`}
              >
                {s.name} · {formatRange(s.startMinute, s.endMinute)}
              </Link>
            ))}
          </nav>
        )}
        <RealtimeRefresh restaurantId={restaurantId} />
        <p className="text-sm text-muted">
          Toca un hueco para crear una reserva en esa mesa y hora, o una barra para abrir la reserva. Con el teclado: flechas para moverte e Intro
          para abrir. Las reservas sin mesa están en la vista del día.
        </p>
      </header>
      {tables.length === 0 ? (
        <Notice tone="info">Aún no tienes mesas: créalas en Reservas → Ajustes.</Notice>
      ) : !service ? (
        <Notice tone="info">Este día no tienes servicios en el horario.</Notice>
      ) : (
        <ReservationGrid
          restaurantId={restaurantId}
          date={date}
          timeZone={tz}
          layout={buildGrid({ date, timeZone: tz, service, tables, reservations, blocks: day.blocks })}
          tables={tables}
          reservations={reservations}
          blocks={day.blocks}
          readOnly={ctx.readOnly}
          label={`Mesas y horas de ${service.name}, ${formatRange(service.startMinute, service.endMinute)}`}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Comprobar**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; el build lista `ƒ /panel/[restaurantId]/reservas/cuadricula`.

- [ ] **Step 4: Commit**

```bash
git add src/components/reservations/ReservationGrid.tsx "src/app/panel/[restaurantId]/reservas/cuadricula"
git commit -m "Reservas: cuadrícula mesas × horas con barras, bloqueos rayados, huecos que abren una reserva y teclado"
```

---

### Task 21: Bloqueos

**Files:**
- Create: `src/app/panel/[restaurantId]/reservas/bloqueos/page.tsx`

**Interfaces:**
- Consumes: `createBlock`, `deleteBlock` (Task 12); `getBookingConfig`, `getBookingDay` (Task 8); `compareTablesForDisplay` (Task 6); `dateParam`, `formatDayEs`, `formatTime`, `localParts`, `serviceDayWindow` (Task 4); `DayPicker`, `ReservationsNav` (Task 14); `ActionForm`, `FormCheckbox`, `FormField`, `FormSelect`; `requirePanelAccess(…, 'settings.booking')`.
- Produces: la página `/panel/[id]/reservas/bloqueos?fecha` (lista del día con «Quitar» y formulario «Nuevo bloqueo» con `tableId`, `date`, `start`, `end`, `allDay`, `reason`).

- [ ] **Step 1: Página**

Create `src/app/panel/[restaurantId]/reservas/bloqueos/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ActionForm, FormCheckbox, FormField, FormSelect } from '@/components/forms/ActionForm';
import { DayPicker } from '@/components/reservations/DayPicker';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { SectionCard } from '@/components/ui/SectionCard';
import { createBlock, deleteBlock } from '@/lib/actions/blocks';
import { requirePanelAccess } from '@/lib/auth/guards';
import { compareTablesForDisplay } from '@/lib/reservations/availability';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { dateParam, formatDayEs, formatTime, localParts, serviceDayWindow } from '@/lib/reservations/time';
import { formatDateEs, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Bloqueos' };

export default async function BlocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'settings.booking');
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const today = todayInTimeZone(tz);
  const date = dateParam(sp.fecha, today);
  const day = await getBookingDay(restaurantId, date, tz);
  const window = serviceDayWindow(date, tz);
  const blocks = day.blocks.filter((b) => b.startMs < window.to && b.endMs > window.from);
  const tables = [...config.tables].filter((t) => t.active).sort(compareTablesForDisplay);
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
  const when = (ms: number) => {
    const p = localParts(ms, tz);
    return p.date === date ? formatTime(ms, tz) : `${formatDateEs(p.date)} ${formatTime(ms, tz)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="bloqueos" date={date} canConfigure />
      <header className="flex flex-col gap-2">
        <DayPicker path={`/panel/${restaurantId}/reservas/bloqueos`} date={date} today={today} />
        <p className="text-muted">Una mesa (o todo el restaurante) que no se puede reservar durante un rato: una avería, un evento privado…</p>
      </header>

      <SectionCard title={`Bloqueos del ${formatDayEs(date)}`}>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted">No hay ningún bloqueo este día.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocks.map((b) => {
              const what = b.tableId ? (tableNames.get(b.tableId) ?? 'Mesa') : 'Todo el restaurante';
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border-2 border-ink/10 px-3 py-2">
                  <span>
                    <strong>{what}</strong> · {when(b.startMs)}–{when(b.endMs)}
                    {b.reason && ` · ${b.reason}`}
                  </span>
                  {!ctx.readOnly && (
                    <form action={deleteBlock}>
                      <input type="hidden" name="restaurantId" value={restaurantId} />
                      <input type="hidden" name="blockId" value={b.id} />
                      <button
                        type="submit"
                        aria-label={`Quitar el bloqueo de ${what}, ${when(b.startMs)}`}
                        className="px-2 py-1 text-sm font-bold text-red-700 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      >
                        Quitar
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {!ctx.readOnly && (
        <SectionCard title="Nuevo bloqueo" intro="Si acaba antes de empezar, acaba al día siguiente (por ejemplo, de 22:00 a 01:00).">
          <ActionForm action={createBlock} hidden={{ restaurantId }} submitLabel="Bloquear" pendingLabel="Guardando…">
            <FormSelect
              label="Qué se bloquea"
              name="tableId"
              defaultValue=""
              options={[{ value: '', label: 'Todo el restaurante' }, ...tables.map((t) => ({ value: t.id, label: `${t.name} (${t.zoneName})` }))]}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Fecha" name="date" type="date" defaultValue={date} required />
              <FormField label="Desde" name="start" type="time" defaultValue="13:00" />
              <FormField label="Hasta" name="end" type="time" defaultValue="16:00" />
            </div>
            <FormCheckbox name="allDay" label="Todo el día (de 00:00 a 24:00)" />
            <FormField label="Motivo (opcional)" name="reason" maxLength={140} placeholder="Evento privado" />
          </ActionForm>
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Comprobar**

Run: `pnpm typecheck && pnpm lint && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores; el build lista `ƒ /panel/[restaurantId]/reservas/bloqueos`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/panel/[restaurantId]/reservas/bloqueos"
git commit -m "Reservas: bloqueos de una mesa o de todo el restaurante"
```

---

### Task 22: Guía de puesta en marcha y verificación final

**Files:**
- Modify: `docs/setup.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: guía al día para el controlador (migraciones en orden, «primero migraciones, luego código», Realtime, avisos esperados) y la lista de comprobación manual de abajo.

- [ ] **Step 1: Migraciones, Realtime y avisos en `docs/setup.md` §1**

In `docs/setup.md`, after the line that ends with `Aplica las 4 migraciones del Hito 3 **antes** de desplegar el código (son aditivas y compatibles con el código del Hito 2).`, add:

```markdown
   - Hito 4A: `20261127000100_reservas.sql` y `20261127000200_reservas_funciones.sql`. No tocan datos existentes: añaden zonas, mesas, ajustes de reserva, clientes, reservas, mesas de cada reserva y bloqueos (con su RLS), dos columnas en `services` (`last_booking_minute`, vacía, y `slot_interval_min`, 15 por defecto) y las funciones del panel de reservas. **Aplícalas antes de desplegar el código del Hito 4A**: el código nuevo lee esas columnas y tablas; el del Hito 3 sigue funcionando con ellas.
   - **Tiempo real:** `20261127000100_reservas.sql` añade `reservations`, `reservation_tables` y `blocks` a la publicación `supabase_realtime` (si existe, como en todo proyecto de Supabase). Compruébalo en Database → Publications → `supabase_realtime`: tienen que salir esas tres tablas. Si no, actívalas ahí a mano. Los cambios llegan filtrados por las RLS de cada usuario.
```

and, in the `authenticated` bullet of the expected advisors, replace:

```markdown
`publish_restaurant`, `set_dish_unavailable`, `set_menu_unavailable_mode`, `get_public_menu`, `list_public_menus`).
```

with:

```markdown
`publish_restaurant`, `set_dish_unavailable`, `set_menu_unavailable_mode`, `get_public_menu`, `list_public_menus`, `create_panel_reservation`, `create_walk_in`, `update_panel_reservation`, `set_reservation_status`, `undo_reservation_status`).
```

- [ ] **Step 2: Nota de Vercel**

At the end of «## 5. Vercel» (after point 6), add:

```markdown
7. No hay variables nuevas en el Hito 4A. El tiempo real del panel de reservas usa `NEXT_PUBLIC_SUPABASE_URL` y la *publishable key* con la sesión del usuario (nunca la clave secreta). Orden de publicación: **primero las migraciones del Hito 4A en Supabase, después el despliegue**.
```

- [ ] **Step 3: Verificación completa**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:db && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy pnpm build`
Expected: sin errores de lint ni de tipos; `test:unit` → **444** pruebas en verde (59 archivos); `test:db` → **178** pruebas en verde (12 archivos); el build lista `/panel/[restaurantId]/reservas`, `/reservas/[reservationId]`, `/reservas/ajustes`, `/reservas/bloqueos`, `/reservas/cuadricula`, `/reservas/nueva` y `/reservas/walk-in`. `git status` limpio salvo este paso.

- [ ] **Step 4: Commit**

```bash
git add docs/setup.md
git commit -m "Guía: migraciones del Hito 4A antes del código, tiempo real y avisos esperados"
```

- [ ] **Step 5: Entregar al controlador**

Migraciones que hay que aplicar en Supabase, **en este orden y antes de desplegar** (ninguna de las ya aplicadas se toca):

1. `supabase/migrations/20261127000100_reservas.sql`
2. `supabase/migrations/20261127000200_reservas_funciones.sql`

Después: comprobar la publicación `supabase_realtime` (tres tablas), `get_advisors` (security) y comparar con la lista de avisos esperados de `docs/setup.md`; desplegar; y pasar al usuario la lista de comprobación de abajo.

---

## Comprobación manual del Hito 4A (para el usuario, tras desplegar)

No hay prueba e2e en este hito (no hay claves de Supabase en el entorno de desarrollo). Prueba esto con una tablet (o portátil) y un móvil, idealmente a la vez:

1. **Horario.** En «Horario», pon a la cena «Última reserva» 23:00 y «Cada 30 min»; deja la comida sin última reserva (sale «Vacío: 15:00» si acaba a las 16:00). Una última reserva después del cierre da error junto al campo.
2. **Ajustes.** En «Reservas → Ajustes», sin zonas, crea la mesa «T1» (2–2): aparece la zona «Sala». Crea «Terraza» y mesas T2 (2–4), T3 (2–4), T4 (5–8). Intenta otra «t1» (error: ya existe) y una de mínimo 6 y máximo 4 (error). Pon un tramo de 1 a 2 personas con 1 h 15 min y otro solapado (error «Se solapa con el tramo 1»). En el panel de Inicio, el asistente marca «Mesas».
3. **Reserva por teléfono.** «Nueva reserva»: 2 personas, hoy, toca una hora: propone T1 (la más pequeña). Escribe un teléfono nuevo, nombre y una nota; guarda: vuelve al día con «Reserva guardada.» en su servicio. Vuelve a crear otra con el mismo teléfono: al salir del campo dice «Cliente encontrado» y rellena el nombre.
4. **Sin hueco y forzar.** Ocupa todas las mesas a una hora (o bloquea todo el restaurante). Al pedir esa hora sale «No hay hueco…» y el botón «Guardar sin mesa»: se guarda y sale en «Sin mesa asignada». Ábrela y dale mesa con «La que proponemos» a otra hora.
5. **Grupo con varias mesas.** 10 personas, «Elegir una o varias a mano»: marca T4 y T2 (sale «Sitio para 12 de 10»); con solo T2, al guardar: «En esas mesas no caben todos…».
6. **Walk-in.** «Walk-in (sin reserva)»: 3 personas, ya viene marcada la mesa más pequeña libre; «Sentar ahora»: sale «En mesa» con la hora actual.
7. **Estados y deshacer.** En una reserva confirmada: «Sentar» → «Finalizar» → «Deshacer «Finalizada»» (vuelve a «En mesa»). En otra: «No ha venido» → «Deshacer «No vino»». Cancelar → otra reserva ocupa esa mesa → «Deshacer» dice que la mesa se ha ocupado. Con el teclado: tras pulsar un botón, el foco queda en «Deshacer» y el lector de pantalla lee el resultado. Al abrir de nuevo la reserva del cliente con un no-show, sale el aviso «1 no-show».
8. **Bloqueos.** En «Reservas → Bloqueos», bloquea T2 de 13:00 a 16:00 con motivo «Avería» y todo el restaurante una noche. En la cuadrícula salen rayados; al reservar T2 a las 14:00: «Esa mesa está bloqueada a esa hora.» Quita el bloqueo.
9. **Cuadrícula en tablet y en móvil.** En «Cuadrícula», cambia de servicio y de día. Toca un hueco: abre «Nueva reserva» con esa mesa y hora. Toca una barra: abre la ficha. En el móvil se desplaza en horizontal y la columna de mesas se queda fija. Con el teclado: Tab entra en la cuadrícula, flechas para moverse, Intro abre.
10. **Tiempo real (dos dispositivos).** Con la vista del día abierta en la tablet, crea una reserva desde el móvil: aparece sola en la tablet en uno o dos segundos (arriba pone «En directo»). Haz lo mismo con un cambio de estado y con quitar un bloqueo.
11. **Medianoche.** Con una cena de 20:30 a 00:30, reserva a las 00:15: sale en la cena de ese día (no en el día siguiente) y en la cuadrícula al final.
12. **Canarias.** Si puedes, con un restaurante en `Atlantic/Canary`, reserva a las 21:00: en la lista sale 21:00 (no 22:00).
13. **Permisos.** Como Sala: ve «Reservas» (día, cuadrícula, nueva, walk-in, estados) pero no «Bloqueos» ni «Ajustes» (si abre `/panel/<id>/reservas/ajustes`, 404). Como FByte en modo soporte: todo se ve, sin botones de guardar ni de estado.

---

## Autorrevisión del plan

- **Cobertura de las decisiones del hito:** 1 entrega 4A sola (nada del 4B: ver Global Constraints) · 2 panel pensado para tablet, lista del día en el móvil y cuadrícula con desplazamiento horizontal (Tasks 17, 20) · 3 doble comprobación: módulo puro (Task 6), función con advisory lock por restaurante y fecha (Task 2) y exclusión `btree_gist` (Task 1), con prueba de concurrencia (Task 2) · 4 configuración para Administrador y Encargado: zonas y mesas, última hora e intervalo, duración y tramos, reglas online guardadas (Tasks 1, 12, 13, 15) · 5 ficha mínima de cliente por teléfono o email, contadores y avisos en la reserva (Tasks 1, 2, 8, 17, 18) · 6 vista del día por servicio, cuadrícula, teléfono con mesa propuesta/elegidas/forzar, walk-in, estados, bloqueos, tiempo real y «Finalizar» manual (Tasks 14–21) · 7 forzar = sin mesa, en «Sin mesa asignada», nunca encima de otra (Tasks 2, 17) · 8 zonas 1–40, `position`, máx. 20, «Sala» al crear la primera mesa (Tasks 1, 12) · 9 mesas con zona, nombre único 1–20, capacidades 1–50, `online_bookable`, `active`, `position`, máx. 100, no se borran con reservas futuras (Tasks 1, 12, 15) · 10 `last_booking_minute` (por defecto `end − 60` sin bajar del inicio) y `slot_interval_min` 15/30, mismos valores por defecto en días especiales (Tasks 1, 5, 13) · 11 `booking_settings` con valores por defecto si no existe, 90 min (30–360, múltiplo de 15), hasta 6 tramos sin solaparse y reglas online (Tasks 1, 4, 9, 12, 15) · 12 clientes con E.164 (`libphonenumber-js`, ES por defecto), email en minúsculas, notas, etiquetas, consentimiento, contadores, únicos por restaurante con índices parciales (Tasks 1, 3) · 13 reservas con cliente (opcional solo en walk-in), 1–50, estados, orígenes, notas, `locale`, `created_by`, columnas del 4B vacías; del panel nacen `confirmed` o `seated` (Tasks 1, 2) · 14 `reservation_tables` con horas y `active` copiadas por trigger y exclusión cuando está activa (Task 1) · 15 bloqueos de mesa o restaurante con motivo ≤ 140, de Administrador y Encargado (Tasks 1, 12, 21) · 16 servicio por hora de inicio, medianoche para el día en que empieza, «Fuera de horario» (Tasks 5, 17) · 17 duración del tramo o por defecto, cambiable a mano (Tasks 2, 4, 18) · 18 transiciones permitidas y deshacer con nueva comprobación de mesa (Tasks 2, 3, 16) · 19 contadores por trigger que suman y restan (Task 1, probado en la Task 2) · 20 funciones con `has_role`, `search_path = ''` y advisory lock; códigos traducidos en `db-errors.ts`; varias mesas por suma de capacidades (Tasks 2, 10) · 21 permisos `reservations.manage` y `settings.booking`, nada para anon (Tasks 1, 2, 10, 11, 12, páginas) · 22 navegación «Reservas» con Cuadrícula y Ajustes, horario con los dos campos (Tasks 10, 13, 14) · 23 vista del día con fecha (hoy, ←/→, calendario), resumen, lista con estado en color y texto y avisos, «Sin mesa asignada» y «Fuera de horario» (Tasks 14, 17) · 24 cuadrícula por zonas, columnas cada 15 min, barras, bloqueos rayados, huecos y barras que abren, teclado y nombres accesibles (Tasks 7, 20) · 25 nueva reserva por teléfono con búsqueda de cliente, propuesta de la más pequeña, otra(s) a mano y «Guardar sin mesa» (Tasks 11, 18) · 26 walk-in con personas, mesa libre ahora y nombre opcional, `seated` con la hora actual (Tasks 2, 19) · 27 Realtime `postgres_changes` sobre las tres tablas, filtrado y con RLS, refresco de la página; publicación solo si existe (Tasks 1, 14) · 28 paso «Mesas» del asistente que no bloquea publicar (Task 10) · 29 pruebas unitarias de disponibilidad (servicios, excepciones, última hora, intervalo, tramos, solapes, bloqueos, mesa más pequeña, varias mesas, medianoche, cambio de hora, Canarias), transiciones, teléfonos y validaciones (Tasks 3–9) · 30 pruebas de BD de permisos por rol, otro restaurante, anon, exclusión, concurrencia con `SLOT_TAKEN`, forzar, contadores y deshacer (Tasks 1, 2) · 31 sin e2e, con comprobación manual (arriba).
- **Spec:** §5 «Horarios y mesas» y «Reservas» (con lo que cambian las decisiones: minutos en lugar de horas, `previous_status`, sin `email_status` ni `email_log`, que son del 4B) · §6.1 configuración · §6.2 algoritmo (`getAvailableSlots`, con antelación y `onlineOnly` listos para el 4B) · §6.4 panel (salvo el aviso por email, 4B) · §8.1 ficha mínima (la pantalla de clientes es del Hito 5) · §12 errores junto al campo y en la voz de FByte; «hora recién ocupada» en el panel dice qué hacer (las horas alternativas son del 4B) · §13 pruebas unitarias y de BD; e2e en la comprobación manual.
- **Placeholders:** ninguno; todo paso con código lleva el archivo completo o el fragmento exacto que cambia. El código de las Tasks 1–22 se ha comprobado aplicándolo en una copia del repositorio: 178 pruebas de BD y 444 unitarias en verde (622), `typecheck`, `lint` y `build` sin errores.
- **Consistencia de nombres:** los códigos de error de las funciones y restricciones (Tasks 1–2) son los de `db-errors.ts` (Task 10) · las claves JSON de `get_booking_day` (Task 2) son las que lee `parseBookingDay` (Task 8) · `compareTables` (Task 6) sigue el `order by` de `pick_reservation_table` y `durationFor` (Task 4) el de `reservation_duration` (Task 2) · `nextActions`/`canTransition` (Task 3) coinciden con `reservation_transition_ok` (lo prueba `transitions.test.ts`) · los modos de mesa (`auto` → `p_table_ids` nulo, `manual`/`keep` → ids, `none` → `p_force`) son los mismos en `validation.ts`, `reservations.ts` y `ReservationForm.tsx` · los campos de formulario (`date`, `time`, `partySize`, `duration`, `tableMode`, `tableIds`, `name`, `phone`, `email`, `notes`, `internalNotes`, `lastBooking`, `slotInterval`, `rule<n>_*`, `tableId`, `allDay`, `reason`, `zoneId`, `minCapacity`, `maxCapacity`, `onlineBookable`, `active`, `position`, `confirm`) coinciden en validación, acciones y formularios · `?fecha=`, `?hora=`, `?mesa=`, `?servicio=` y `?aviso=` se escriben y se leen con los mismos nombres (Tasks 11, 17–21).
