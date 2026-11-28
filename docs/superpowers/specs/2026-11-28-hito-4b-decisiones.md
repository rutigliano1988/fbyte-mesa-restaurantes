# Mesa — Hito 4B (Reserva online, emails y tareas automáticas): decisiones de diseño

- **Fecha:** 28/11/2026
- **Completa:** `docs/superpowers/specs/2026-11-24-plataforma-restaurantes-design.md` (§4, §6.2, §6.3, §10, §11, §12, §13) y los documentos de decisiones de los Hitos 2, 3 y 4A. Si hay contradicción, manda este documento.
- **Estado de partida:** Hito 4A en `main` (930fdeb), desplegado y probado a mano por el usuario. **Todas** las migraciones de `supabase/migrations/` ya están aplicadas en Supabase: no se editan; todo cambio de BD va en migraciones nuevas (`20261128…`).

## Decisiones confirmadas por el usuario
1. **Enlace del comensal:** ver, **modificar** (día, hora y personas, con nueva comprobación de hueco) y cancelar, siempre antes del límite de cancelación del restaurante.
2. **Tarea horaria con `pg_cron` de Supabase** (Vercel Hobby solo permite tareas diarias). La BD hace el trabajo de datos y llama a la app para enviar los emails, con una clave guardada en Supabase Vault.
3. **Remitente:** `reservas@fbytesolutions.com`, con el nombre visible «<Restaurante> vía Mesa» y `reply-to` al email del restaurante. Las invitaciones siguen saliendo de `no-responder@`.
4. **Turnstile:** el widget lo crea Claude con el conector de Cloudflare al publicar, y las claves se guardan directamente en Vercel sin mostrarse. En desarrollo y pruebas se usan las claves de prueba de Cloudflare.
5. **Datos obligatorios online:** nombre, email y teléfono (por defecto +34, admite extranjeros). Notas opcionales.
6. **Reservas por teléfono:** casilla «Enviar confirmación por email», marcada por defecto si hay email y desmarcable. Con ella, el cliente recibe lo mismo que en una reserva online (enlace, recordatorio y avisos de cambios).
7. **Cierre automático:** una reserva `seated` pasa a `completed` 2 h después de su `ends_at` (cuenta como visita).
8. **Avisos al restaurante:** campo «Email para avisos de reservas» en Reservas → Ajustes (si está vacío, el email del local), con interruptor para apagarlos.
9. **Emails con cola en la BD** (enfoque A): cada email se anota en `email_outbox` en la misma transacción que cambia la reserva; la app lo envía justo después de responder y la tarea horaria reintenta lo pendiente.

## Decisiones técnicas

### Seguridad del flujo público
10. **El navegador no llama a nada nuevo de Supabase.** Todas las funciones nuevas del flujo público (disponibilidad, crear, ver, modificar y cancelar con token, límite de intentos) son `SECURITY DEFINER` con `search_path = ''`, **concedidas solo a `service_role`** (revocadas a `public`, `anon` y `authenticated`). La app las llama desde el servidor con `createAdminClient()` después de validar Turnstile y el límite de intentos. Así no se puede saltar Turnstile llamando a PostgREST con la clave pública.
11. **Token del enlace:** `token = base64url(HMAC-SHA256(MANAGE_TOKEN_SECRET, 'reservation:' + id))` (43 caracteres). La BD guarda solo `manage_token_hash = hex(sha256(token))` (columna ya creada en el 4A, única). La app puede regenerar el enlace para cualquier email posterior a partir del id; nadie puede sacarlo de la BD. Cambiar `MANAGE_TOKEN_SECRET` invalida todos los enlaces (se documenta). Para poder calcular la huella antes de insertar, **la app genera el id** (`crypto.randomUUID()`) de las reservas online y de las telefónicas con aviso por email.
12. **Turnstile** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`): solo en el alta online. Se valida en el servidor (`siteverify`) antes de tocar la BD. En producción, sin claves, el alta se rechaza con un mensaje claro (nunca se deja pasar). Ver, modificar y cancelar con el token no llevan Turnstile (el token ya es secreto), pero sí límite de intentos.
13. **Límite de intentos** en la BD (compartido entre instancias): tabla `rate_limits(key, window_start, hits)` y función `hit_rate_limit(key, max_hits, window_seconds) returns boolean`. La clave es `<acción>:<restaurante>:<huella de la IP>`, con la huella `sha256(MANAGE_TOKEN_SECRET + IP)` (la IP nunca se guarda). Límites: alta online, 5 cada 10 min y 20 al día; consultas y cambios con token, 30 cada 10 min. Mensaje: «Has hecho demasiados intentos. Espera unos minutos y vuelve a probar».
14. **Página del token:** `noindex`, `referrer: no-referrer`; un token que no existe o de otro restaurante → página propia «No encontramos esta reserva» (sin decir por qué).

### Datos (migración nueva)
15. **`booking_settings`**: `online_enabled boolean default true`, `notify_restaurant boolean default true`, `notification_email text` (opcional, email válido; si es nulo se usa `restaurants.email`). Se añaden a las columnas que puede actualizar `authenticated` (con `settings.booking`).
16. **`reservations`**: `notify_customer boolean not null default false` (online siempre `true`; teléfono según la casilla; walk-in `false`). `manage_token_hash` se rellena en las online y en las telefónicas con aviso.
17. **`email_outbox`**: `id`, `restaurant_id`, `reservation_id` (FK compuesta como en el 4A), `kind`, `status` (`pending`, `sending`, `sent`, `failed`, `skipped`), `attempts` (0–3), `last_error` (sin datos personales), `provider_id`, `next_attempt_at`, `created_at`, `sent_at`. El destinatario **no** se guarda: se resuelve al enviar (email actual del cliente o email de avisos). Índice único parcial para que solo haya un recordatorio por reserva. RLS: lectura para los miembros con `reservations.manage` de ese restaurante; sin escritura directa para nadie (solo funciones).
18. **Tipos de email (`kind`)**: al comensal `customer_pending`, `customer_confirmed`, `customer_modified`, `customer_cancelled`, `customer_rejected`, `customer_reminder`; al restaurante `restaurant_new`, `restaurant_request`, `restaurant_modified`, `restaurant_cancelled`.
19. **Quién ha hecho el cambio:** las funciones públicas marcan la transacción con `set_config('mesa.actor', 'customer', true)`; las del panel, `staff`; la tarea horaria, `system`.
20. **Encolado por trigger** (`AFTER INSERT OR UPDATE` en `reservations`, función pura de reglas probada en la BD). Los de comensal solo si `notify_customer` y el cliente tiene email; los de restaurante solo si el actor es `customer`, `notify_restaurant` y hay email de avisos.
    - Alta: `pending` → `customer_pending` + `restaurant_request`; `confirmed` → `customer_confirmed` (+ `restaurant_new` si es online).
    - `pending → confirmed` → `customer_confirmed`; `→ rejected` → `customer_rejected`; `→ cancelled_restaurant` → `customer_cancelled`; `→ cancelled_customer` → `customer_cancelled` (+ `restaurant_cancelled` si lo hizo el comensal).
    - Cambio de `starts_at` o `party_size` en una reserva activa → `customer_modified` (+ `restaurant_modified` si lo hizo el comensal). Cambiar solo mesas, notas o duración no envía nada.
    - Deshacer una cancelación o un rechazo (vuelve a `confirmed`) → `customer_confirmed`. Deshacer `no_show`/`completed` y el cierre automático no envían nada. Los walk-ins nunca.

### Funciones de BD nuevas (todas con *advisory lock* por restaurante y día como en el 4A)
21. **`get_public_booking_day(slug, date)`**: restaurante activo y con reserva online activada; devuelve zona horaria, ajustes, servicios del día (con excepciones), zonas con mesas online, mesas online activas (id, zona, capacidades, posición) y franjas ocupadas por mesa (reservas activas y bloqueos), **sin ningún dato personal**. El módulo TS de disponibilidad del 4A calcula las horas libres, añadiendo: solo mesas `online_bookable` y activas, ventana de antelación (`min_advance_min`, `max_advance_days`), zona opcional y el límite `max_online_party`.
22. **`is_bookable_slot(restaurant, starts_at)`** (SQL): la hora es una de las ofrecidas (dentro de un servicio del día de servicio, con excepciones, ≤ última reserva, alineada al intervalo, servicios que pasan de medianoche incluidos) y está dentro de la ventana de antelación. Se usa en crear y modificar online; con prueba de BD que compare con el módulo TS en los mismos casos (cambio de hora y Canarias).
23. **`create_public_reservation(slug, p_id, p_token_hash, party, starts_at, zone_id?, name, email, phone, notes, locale, marketing_opt_in)`**: comprueba restaurante activo, reserva online activada, hora válida y personas 1–50.
    - Si `party ≤ max_online_party`: busca la mesa más pequeña que sirve (en la zona si se pidió) y la inserta `confirmed` o `pending` según `auto_confirm`; si no hay, `SLOT_TAKEN` (la app calcula entonces las horas libres más cercanas).
    - Si `party > max_online_party`: solicitud `pending` **sin mesa**.
    - `privacy_accepted_at = now()`, `source = online`, `notify_customer = true`.
24. **Cliente online** (`upsert_customer` en modo comensal): busca por email y, si no, por teléfono; **no sobrescribe** nombre ni notas; solo rellena email o teléfono que falten si no chocan con otro cliente; `marketing_opt_in` solo pasa a `true` (con fecha), nunca se quita desde una reserva.
25. **`get_public_reservation(slug, token_hash)`**: datos para la página del enlace (nombre del cliente, día, hora, personas, zona, notas, estado, si se puede modificar y hasta cuándo). Nada de teléfono ni email completos.
26. **`modify_public_reservation(slug, token_hash, party, starts_at, zone_id?)`** y **`cancel_public_reservation(slug, token_hash)`**: solo en `pending`/`confirmed` y si `now() < starts_at − cancel_limit_hours`; si no, `CHANGE_CLOSED`. Al modificar se vuelve a asignar mesa como en el alta (o solicitud sin mesa si supera el máximo online); si el restaurante confirma a mano, queda `pending`. Cancelar → `cancelled_customer`.
27. **Panel:** nuevas versiones de `create_panel_reservation` y `update_panel_reservation` con `p_id`, `p_notify_customer` y `p_token_hash` (las anteriores se sustituyen en la migración nueva, sin editar las antiguas).
28. **Cola:** `claim_outbox(limit)` (marca `sending` con `for update skip locked`; recupera los `sending` de más de 10 min), `finish_outbox(id, ok, provider_id, error)` (con `attempts` y `next_attempt_at` a +15 min, +1 h; al tercer fallo, `failed`) y `retry_outbox(id)` (para el botón del panel, con `reservations.manage`).
29. **Tarea horaria `run_hourly_jobs()`**:
    - Encola `customer_reminder` para reservas `confirmed` con `notify_customer` que empiezan entre 23 y 25 h después, creadas hace más de 6 h, sin recordatorio previo.
    - Pasa a `completed` las `seated` con `ends_at < now() − 2 h` (actor `system`).
    - Borra los `rate_limits` de más de un día.
    - Llama con `pg_net` a `POST <site>/api/cron/hourly` con `Authorization: Bearer <CRON_SECRET>`, leyendo la URL y la clave de Vault (`mesa_site_url`, `mesa_cron_secret`).
    - La migración activa `pg_cron` y `pg_net` y programa el job **solo si las extensiones están disponibles** (el PG local de pruebas no las tiene); los secretos de Vault se crean al publicar.

### Envío de emails (app)
30. **`/api/cron/hourly`** (route handler, `runtime nodejs`): compara la clave con `CRON_SECRET` en tiempo constante y vacía la cola en lotes. Las acciones públicas y del panel llaman a `deliverOutbox()` con `after()` de Next para enviar justo después de responder.
31. **`deliverOutbox`**: reclama filas, carga los datos **actuales** de la reserva y el restaurante con el cliente admin, pinta la plantilla y envía con Resend usando el id de la fila como clave de idempotencia. Un recordatorio de una reserva que ya no está confirmada se marca `skipped`. Logs sin datos personales.
32. **Remitente:** `RESERVATIONS_FROM_ADDRESS=reservas@fbytesolutions.com`; el nombre visible se compone por restaurante (sin comillas ni caracteres de control). `reply-to`: email del restaurante (o el de avisos).
33. **Plantillas (React Email):**
    - **Comensal**, en el `locale` de la reserva y los 6 idiomas (`es`, `en`, `ca`, `fr`, `de`, `it`), con logo y color de acento del restaurante y el pie «Reservas y menú con Mesa · FByte Solutions»: datos de la reserva, botón «Gestionar mi reserva», «Cómo llegar» (Google Maps con la dirección o las coordenadas) y teléfono del restaurante. Confirmada, Modificada y Recordatorio adjuntan `reserva.ics`.
    - **Restaurante**, en castellano con la identidad FByte: datos de la reserva, avisos del cliente y botón al panel.
34. **`.ics`** propio (sin librería): `METHOD:PUBLISH`, `UID:<id>@mesa`, horas en UTC, `SEQUENCE` derivado de la última modificación, título «Reserva en <restaurante>», dirección en `LOCATION`; con escapado y líneas plegadas según RFC 5545.

### Páginas públicas
35. **`/[slug]/reservar`**: pasos personas → fecha → hora → zona → datos → resultado, en el idioma de la mini-web (`?lang=`), con la marca del restaurante.
    - El calendario deshabilita los días cerrados y los que quedan fuera de la antelación.
    - Las horas se agrupan por servicio.
    - Grupos por encima del máximo: «Para grupos de más de N personas enviamos una solicitud al restaurante».
    - Casilla obligatoria de privacidad, con la información básica (responsable, finalidad, derechos) y enlace a la política; casilla aparte y opcional de comunicaciones del restaurante.
    - Resultado: confirmada o pendiente, y «Te hemos enviado un email a …».
    - Restaurante sin reserva online, o sin mesas online → página informativa con el teléfono. Sale en el `sitemap` en cada idioma.
36. **`/[slug]/reserva/[token]`**: estado (color y texto), datos, «Cómo llegar», «Modificar» (mismo selector de fecha, hora, personas y zona) y «Cancelar reserva» (con confirmación). Fuera de plazo: «Para cambiar algo, llama al restaurante: …».
37. **`/[slug]/privacidad`**: plantilla en los 6 idiomas marcada «PENDIENTE DE REVISIÓN LEGAL».
    - Responsable: el restaurante (nombre legal, CIF, dirección y email). Encargado: FByte Solutions.
    - Finalidad: gestionar la reserva y, si se consiente, comunicaciones comerciales.
    - Base legal: medidas precontractuales y consentimiento.
    - Conservación: anonimización tras 3 años sin actividad.
    - Destinatarios y subencargados: Supabase (UE), Vercel, Resend y Cloudflare Turnstile, con transferencias amparadas en cláusulas tipo o el Marco de Privacidad de Datos.
    - Derechos y reclamación ante la AEPD.
    - Enlazada desde el pie de la mini-web, junto al aviso legal.
38. **Botón «Reservar»** en la mini-web (destacado, junto a «Ver carta») y en la cabecera de la carta, si la reserva online está activada y hay al menos una mesa online. El JSON-LD `Restaurant` añade `acceptsReservations` con la URL de reservar.
39. **Errores** (voz neutra de páginas públicas, en el idioma del comensal):
    - Hora ocupada: «Vaya, esa hora se acaba de ocupar. Te enseño las más cercanas».
    - Fuera de plazo.
    - Demasiados intentos.
    - Turnstile fallido: «No hemos podido comprobar que no eres un robot. Vuelve a intentarlo».
    - Validación junto a cada campo, con los mismos esquemas Zod en cliente y servidor.

### Panel
40. **Vista del día:** lista **«Pendientes de confirmar»** arriba (online y solicitudes de grupo, con Confirmar/Rechazar y asignar mesa); etiqueta de origen («Online», «Teléfono», «Walk-in») en cada reserva.
41. **Ficha de la reserva:** historial de emails (tipo, estado y fecha); si alguno quedó `failed`, aviso «No pudimos enviar el email de …» con el botón «Reintentar».
42. **Formulario telefónico:** casilla «Enviar confirmación por email» (visible si hay email, marcada por defecto).
43. **Reservas → Ajustes:** «Reserva online» (interruptor), «Avisos por email al restaurante» (interruptor) y «Email para avisos de reservas» (vacío = el del local, con ese valor como texto de ayuda). Las reglas online del 4A pasan a aplicarse y su texto de ayuda deja de decir «se aplicará más adelante».

### Variables de entorno nuevas
`MANAGE_TOKEN_SECRET` (≥ 32 bytes aleatorios), `CRON_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y `RESERVATIONS_FROM_ADDRESS`. Todas en `src/lib/env.ts` con validación y en `.env.example` sin valores reales. `docs/setup.md` explica el widget de Turnstile, los secretos de Vault y el job de `pg_cron`.

### Pruebas
44. **Unitarias:**
    - Token (determinista, huella).
    - `.ics` (escapado, plegado, UTC, cambio de hora, Canarias).
    - Disponibilidad online (antelación mínima y máxima, mesas online, zona, máximo online, solicitud de grupo).
    - Horas alternativas más cercanas.
    - Plazo de modificación.
    - Reglas del nombre del remitente.
    - Plantillas en los 6 idiomas (se pintan, sin claves vacías).
    - Esquemas del formulario público.
    - Verificación de Turnstile (con `fetch` simulado).
45. **De BD:**
    - `anon` y `authenticated` no pueden ejecutar ninguna función pública nueva.
    - `get_public_booking_day` no devuelve datos personales.
    - Dos altas online a la vez en la última mesa: solo una se crea.
    - `is_bookable_slot` coincide con el módulo TS.
    - Solicitud de grupo sin mesa.
    - Modificar y cancelar con token, dentro y fuera de plazo; token de otro restaurante.
    - El cliente online no sobrescribe datos.
    - Encolado de cada tipo de email según actor y estado.
    - Un único recordatorio.
    - Cierre automático y contadores.
    - Límite de intentos.
    - `claim_outbox`/`finish_outbox`/`retry_outbox`.
46. **Sin e2e** (no hay claves de Supabase en el contenedor): lista de comprobación manual para el usuario.

### Publicación (cada paso que toca producción, con confirmación del usuario)
Migraciones → widget de Turnstile con el conector de Cloudflare (dominio de producción) → generar `MANAGE_TOKEN_SECRET` y `CRON_SECRET` y guardarlos en Vercel y en Vault sin mostrarlos, junto con `RESERVATIONS_FROM_ADDRESS` y las claves de Turnstile → comprobar el dominio en Resend → comprobar que el job de `pg_cron` existe → desplegar y probar.

## Fuera del Hito 4B
Pantalla de clientes, estadísticas, anonimización automática y resto de textos legales (Hito 5); WhatsApp, lista de espera, señales o depósitos y reseñas (fase 2); pruebas e2e automáticas.
