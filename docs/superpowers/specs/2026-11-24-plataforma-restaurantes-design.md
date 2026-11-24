# Mesa: plataforma de gestión para restaurantes (diseño v1)

- **Fecha:** 24/11/2026
- **Estado:** aprobado por secciones en la sesión de brainstorming; pendiente de revisión final del documento
- **Producto de:** FByte Solutions (se vende como un producto más del catálogo)
- **Nombre:** "Mesa" es **provisional** y se define en un único archivo de configuración (`src/config/brand.ts`)
- **Mercado:** España

---

## 1. Objetivo

Una plataforma web **multi-restaurante (SaaS)** en la que cada restaurante gestiona, desde un mismo panel:

1. La información de su local (datos, logo, fotos, horarios).
2. Su menú digital (cartas, platos, alérgenos, menú del día, QR).
3. Sus reservas (online y manuales), con asignación de mesas.
4. Sus clientes y estadísticas básicas.

FByte da de alta a los restaurantes desde un panel de superadministración. En la v1 la plataforma **no cobra nada**: la facturación a los restaurantes se gestiona fuera.

## 2. Alcance

### 2.1 Incluido en la v1

- Superadmin de FByte: alta, activación y desactivación de restaurantes, invitación al administrador, soporte en solo lectura.
- Usuarios por restaurante con tres roles: Administrador, Encargado y Sala/Recepción.
- Ficha del local con un asistente de bienvenida.
- Horarios: servicios por día de la semana y excepciones por fecha.
- Mesas por zonas y reglas de reserva.
- Reservas online del comensal y reservas manuales del equipo, con asignación automática de mesa, estados, walk-ins y bloqueos.
- Emails transaccionales con Resend: confirmación, modificación, cancelación, recordatorio, avisos al restaurante e invitaciones.
- Menú digital multidioma: cartas, categorías, platos con varios precios, 14 alérgenos, etiquetas, agotados y filtro de alérgenos.
- Menú del día y menús especiales programados.
- Código QR imprimible (PNG y PDF).
- Mini-web pública del restaurante.
- Ficha de clientes (CRM básico) con no-shows.
- Estadísticas básicas.
- Cumplimiento del RGPD: consentimientos, borrado y anonimización, y plantillas legales.
- Restaurante de demostración con datos de ejemplo.

### 2.2 Fuera de la v1 (fase 2 y posteriores)

WhatsApp (confirmaciones y recordatorios) · lista de espera · petición de reseñas en Google · subdominio por restaurante · dominio propio por restaurante · suscripciones y pagos (Stripe) · grupos con varios locales en una cuenta · plano visual de mesas · combinación automática de mesas · traducción automática del menú · pedidos y pago desde la mesa · SMS · panel en otros idiomas distintos del castellano.

La arquitectura debe permitir añadir **subdominios y dominios propios**, **grupos multi-local** y **planes de suscripción** sin rehacer el modelo de datos.

## 3. Usuarios y zonas de la plataforma

| Zona | Ruta (sin dominio propio) | Usuarios | Marca |
|---|---|---|---|
| Superadmin | `/admin` | Personal de FByte (`is_platform_admin`) | FByte |
| Panel del restaurante | `/panel` (y `/panel/[restaurante]/...`) | Miembros del restaurante | FByte |
| Páginas públicas | `/[slug]`, `/[slug]/menu`, `/[slug]/reservar`, `/[slug]/reserva/[token]` | Comensales (sin cuenta) | La del restaurante |
| Autenticación | `/login`, `/invitacion/[token]`, `/recuperar` | Equipo y FByte | FByte |

Mientras no haya dominio, la plataforma vive en la URL gratuita de Vercel (`*.vercel.app`). Hay una **lista de slugs reservados** (`admin`, `panel`, `login`, `api`, `invitacion`, `recuperar`, `legal`, etc.) que ningún restaurante puede usar.

### 3.1 Roles y permisos

| Permiso | Administrador | Encargado | Sala/Recepción |
|---|:-:|:-:|:-:|
| Gestionar reservas, walk-ins y bloqueos | ✅ | ✅ | ✅ |
| Ver fichas de clientes y añadir notas | ✅ | ✅ | ✅ |
| Editar cartas, platos y menú del día | ✅ | ✅ | ❌ |
| Marcar platos como agotados | ✅ | ✅ | ✅ |
| Horarios, mesas y reglas de reserva | ✅ | ✅ | ❌ |
| Ver estadísticas | ✅ | ✅ | ❌ |
| Datos del local, idiomas y slug | ✅ | ❌ | ❌ |
| Gestionar usuarios del restaurante | ✅ | ❌ | ❌ |
| Exportar clientes a CSV | ✅ | ❌ | ❌ |
| Borrar o anonimizar clientes | ✅ | ❌ | ❌ |

Los permisos se aplican **dos veces**: en la interfaz (ocultar lo no permitido) y en la base de datos (políticas RLS y comprobaciones en las funciones del servidor). La base de datos es la fuente de verdad.

## 4. Arquitectura técnica

### 4.1 Stack

| Pieza | Tecnología |
|---|---|
| Aplicación | Next.js (App Router) + TypeScript, una sola aplicación |
| Hosting | Vercel, con despliegue automático desde GitHub |
| Base de datos | Supabase Postgres, **región UE (Fráncfort)** |
| Autenticación | Supabase Auth (email + contraseña; invitaciones y recuperación por email) |
| Archivos | Supabase Storage (logos, portadas, galería, fotos de platos) |
| Emails | Resend + React Email, desde la cuenta de FByte |
| Tareas programadas | Vercel Cron (recordatorios cada hora; anonimización RGPD cada día) |
| Tiempo real | Supabase Realtime (reservas nuevas en el panel sin recargar) |
| Estilos | Tailwind CSS con los tokens de la marca FByte |
| Anti-bots | Cloudflare Turnstile en los formularios públicos + límite de intentos |
| Validación | Zod, compartida entre cliente y servidor |
| i18n de la interfaz pública | Archivos de mensajes por idioma (es, en, ca, fr, de, it) |
| Pruebas | Vitest (lógica y BD) + Playwright (extremo a extremo) |

Las mutaciones del panel se hacen con **Server Actions** usando la sesión del usuario, para que se apliquen las RLS. Las operaciones públicas (crear reserva, cancelar con token) pasan por **funciones de Postgres `SECURITY DEFINER`** con validación estricta. La clave de servicio de Supabase solo se usa en el servidor, para los crons y el superadmin.

### 4.2 Multi-tenencia y seguridad

- Toda tabla de negocio lleva `restaurant_id`.
- `restaurant_members(user_id, restaurant_id, role)` define el acceso. Con un usuario que pueda pertenecer a varios restaurantes, el modelo ya queda preparado para los grupos multi-local de la fase 2.
- Las políticas RLS usan funciones auxiliares `is_member(restaurant_id)` y `has_role(restaurant_id, roles[])`.
- Las lecturas públicas (mini-web, menú) solo exponen restaurantes `active` y los campos marcados como públicos, mediante vistas o funciones específicas. Nunca devuelven datos de clientes ni de reservas.
- Los restaurantes desactivados se bloquean tanto en el panel como en las páginas públicas, sin borrar datos.

### 4.3 Fechas, horas y formato

- Cada restaurante tiene `timezone` (por defecto `Europe/Madrid`; `Atlantic/Canary` para Canarias).
- Los instantes se guardan en `timestamptz` (UTC). Los horarios de servicio se guardan como hora local más el día de la semana, y se convierten a instantes con la zona horaria del restaurante, con soporte para los cambios de horario de verano.
- Moneda EUR. Los precios se guardan en **céntimos (entero)** y se muestran con formato `es-ES` (14,50 €). Las fechas, en formato `dd/mm/aaaa`.

### 4.4 Marca

- **Panel, superadmin, autenticación y emails al equipo**: identidad FByte. Colores núcleo `ink #0A1330`, `navy #17317F`, `orange #FF7A1A`, `peach #FFC48A` y `paper #F8F5EF`, más los colores de apoyo del handoff. Tipografía Archivo, cargando también el eje `wdth`. Sombras duras y radios de la marca. El naranja se usa solo en las acciones principales, y nunca con texto blanco encima. Voz: frases cortas, tuteo, sin jerga.
- **Páginas públicas y emails al comensal**: marca del restaurante (logo, portada y un color de acento elegido por él, con contraste comprobado), sobre un diseño limpio y neutro. Al pie: "Reservas y menú con Mesa · FByte Solutions".
- Los recursos de marca salen del paquete `design_handoff_fbyte_web` (logos SVG y PNG, favicons).

## 5. Modelo de datos (resumen)

Todas las tablas de negocio llevan `id uuid`, `restaurant_id`, `created_at` y `updated_at`.

**Plataforma y acceso**
- `profiles(user_id, full_name, is_platform_admin)`
- `restaurants(slug único, name, status: setup|active|disabled, timezone, default_locale='es', enabled_locales[], accent_color, logo_path, cover_path, cuisine, price_range, address, lat, lng, phone, email, website, social{instagram,facebook,tiktok}, legal_name, tax_id (CIF), menu_unavailable_mode: hide|strike)`
- `restaurant_translations(restaurant_id, locale, description)`
- `restaurant_photos(path, position)`
- `restaurant_members(user_id, restaurant_id, role: admin|manager|staff)`
- `invitations(email, restaurant_id null para invitaciones de FByte, role, token_hash, expires_at, accepted_at)`

**Horarios y mesas**
- `services(name, weekday 0-6, start_time, end_time, last_booking_time, slot_interval_min)`: varias filas por día (Comida, Cena)
- `schedule_exceptions(date, type: closed|custom, custom_services jsonb, note)`
- `zones(name, position)`
- `tables(zone_id, name, min_capacity, max_capacity, online_bookable, active, position)`
- `booking_settings(restaurant_id PK, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm bool, default_duration_min, duration_rules jsonb [{min_party,max_party,duration_min}])`

**Reservas**
- `customers(name, email, phone, notes, tags[], marketing_opt_in, marketing_opt_in_at, visits_count, no_show_count, cancel_count, last_visit_at, anonymized_at)`, con unicidad por restaurante sobre el email y el teléfono normalizados
- `reservations(customer_id, party_size, starts_at, ends_at, status: pending|confirmed|seated|completed|cancelled_customer|cancelled_restaurant|rejected|no_show, source: online|phone|walk_in, notes, internal_notes, locale, manage_token_hash, privacy_accepted_at, created_by, email_status)`
- `reservation_tables(reservation_id, table_id)`: permite varias mesas por reserva (grupos asignados a mano)
- `blocks(table_id null = todo el restaurante, starts_at, ends_at, reason)`
- `email_log(reservation_id, type, to, status, provider_id, error, attempts)`

**Menú**
- `menus(type: carta|daily|special, name, position, active, schedule jsonb {weekdays[], start_time, end_time, dates[]}, price_cents, includes_text)`
- `menu_translations(menu_id, locale, name, includes_text)`
- `menu_sections(menu_id, name, position)` + `menu_section_translations`. En la carta, una sección es una **categoría**; en el menú del día, una sección es "Primeros", "Segundos", etc.
- `dishes(restaurant_id, photo_path, allergens smallint[] (14 códigos UE), tags[], unavailable bool)` + `dish_translations(dish_id, locale, name, description)`
- `dish_prices(dish_id, labels jsonb {es:'Ración', en:'Portion', …}, price_cents, position)`: uno o varios precios; si solo hay uno, `labels` puede ir vacío
- `menu_items(section_id, dish_id null, inline_names jsonb {es:…, en:…} null, position)`: un plato de la carta (`dish_id`) **o** un plato escrito solo para el menú del día (`inline_names`), nunca los dos a la vez

**Estadísticas**
- `menu_views(restaurant_id, menu_id, dish_id null, day, count)`: agregados diarios anónimos, sin cookies ni datos personales
- Las estadísticas de reservas se calculan con consultas o vistas sobre `reservations`.

## 6. Reservas

### 6.1 Configuración

- **Servicios** por día de la semana, con inicio, fin, última hora de reserva e intervalo (15 o 30 min).
- **Excepciones por fecha**: cerrado, u horario especial que sustituye a los servicios de ese día.
- **Mesas** con zona, capacidad mínima y máxima, y si se pueden reservar online.
- **Duración** por defecto (90 min) más tramos opcionales por tamaño de grupo.
- **Reglas**: antelación mínima y máxima, máximo de personas online, límite de cancelación (horas) y confirmación automática o manual (**la elige cada restaurante**).

### 6.2 Algoritmo de disponibilidad (módulo puro y probado)

`getAvailableSlots(restaurant, date, partySize, zone?)`:
1. Calcular los servicios del día (aplicando excepciones) y generar las horas candidatas desde el inicio hasta la última hora de reserva, según el intervalo.
2. Descartar las horas fuera de la ventana de antelación mínima y máxima.
3. Calcular `ends_at = starts_at + duración(partySize)`.
4. Para cada hora, buscar mesas activas, reservables online, de la zona elegida si la hay, con `min ≤ partySize ≤ max`, sin solape con reservas activas (`pending`, `confirmed` o `seated`) ni con bloqueos.
5. Hay hueco si queda al menos una mesa. Se asigna la **mesa más pequeña que sirve** (desempate por posición).

La lógica se implementa como un módulo TypeScript puro (fácil de probar). La **reserva definitiva** la hace una función de Postgres `create_public_reservation(...)` que vuelve a comprobar el hueco **dentro de una transacción con bloqueo** (advisory lock por restaurante y fecha) e inserta la reserva y su mesa. Si la hora ya no está libre, devuelve `SLOT_TAKEN` junto con las horas alternativas más cercanas.

Como segunda red de seguridad, una restricción de exclusión (`btree_gist`) en `reservation_tables` impide solapes de la misma mesa entre reservas activas.

### 6.3 Flujo del comensal

1. Personas → fecha (calendario con los días cerrados deshabilitados) → horas libres → zona (si hay varias).
2. Datos: nombre, email, teléfono (por defecto +34, admite números extranjeros), notas, aceptación de la privacidad (obligatoria) y consentimiento comercial (opcional y separado). Turnstile.
3. Resultado: confirmada o pendiente, según `auto_confirm`. Se envía un email con un enlace `/[slug]/reserva/[token]` para ver, modificar o cancelar dentro del límite.
4. **Grupos por encima de `max_online_party`**: se envía como solicitud `pending` sin mesa asignada. El restaurante asigna una o varias mesas y la confirma o la rechaza.

### 6.4 Panel de reservas

- Vista **del día por servicio** (lista: hora, cliente, personas, mesa, notas, estado, avisos del cliente).
- Vista **cuadrícula mesas × horas** (no es el plano visual).
- Alta rápida de una reserva telefónica: mesa sugerida, otra elegida a mano, o **forzar** con un aviso si no hay hueco.
- **Walk-in** con un clic (estado `seated`, origen `walk_in`).
- Cambios de estado: confirmar, rechazar, sentar, finalizar, cancelar y marcar no-show. Marcar un no-show incrementa `customers.no_show_count`.
- Bloqueos de una mesa o del restaurante entero en una franja.
- Reservas nuevas en tiempo real (Supabase Realtime) y aviso por email al restaurante.

## 7. Información del local, menú y mini-web

### 7.1 Ficha del local

Asistente de bienvenida en el primer acceso del Administrador (datos básicos → logo y portada → horarios → mesas → idiomas → publicar), editable después. El horario público se calcula a partir de `services`, sin duplicar datos. El slug se puede cambiar, con aviso de que el QR impreso dejaría de funcionar (salvo que se mantenga una redirección del slug anterior, que **sí se implementa**: tabla `slug_redirects`).

### 7.2 Menú digital

- Varias cartas (Carta, Bebidas, Vinos, Postres) → categorías → platos, con orden por arrastre y duplicado de platos.
- Uno o varios precios por plato (por ejemplo, Ración y Media, o Copa y Botella).
- Los 14 alérgenos del Reglamento (UE) 1169/2011, con iconos.
- Etiquetas: Vegano, Vegetariano, Sin gluten, Picante, Novedad y Recomendado.
- Interruptor de **Agotado**, con modo ocultar o tachar a elección del restaurante.
- **Filtro de alérgenos** del comensal ("sin gluten", "sin lácteos"…), acompañado de un aviso de que la información es orientativa y conviene confirmarla con el personal.

### 7.3 Menú del día y menús especiales

Precio cerrado, secciones y texto "incluye". Programación por días de la semana y franja horaria, o por fechas concretas; fuera de la programación no se muestra. Admite platos de la carta o platos escritos solo para ese menú.

### 7.4 Multidioma

- Idiomas soportados en las páginas públicas: **es, en, ca, fr, de, it**. Cada restaurante activa los suyos (el castellano siempre está activo y es el idioma de respaldo).
- Los textos del restaurante se escriben a mano por idioma, y si falta una traducción se muestra el castellano. Los textos de la interfaz los traduce el equipo de desarrollo.
- El idioma se elige con este orden de prioridad: el parámetro de la URL (`?lang=`), luego la preferencia guardada y, por último, el idioma del navegador si está activo.

### 7.5 QR

Un QR por restaurante que apunta a `/[slug]/menu`. Se descarga en PNG y en un PDF imprimible (tarjeta de mesa con logo y texto "Escanea para ver la carta" en castellano e inglés).

### 7.6 Mini-web `/[slug]`

Portada (foto, logo, nombre) · botones Reservar, Ver carta y Cómo llegar · descripción · galería · menú del día si está activo · horario · mapa: botón "Cómo llegar" que abre Google Maps, y un mapa incrustado que **solo se carga si el comensal pulsa "Ver mapa"** (así no se cargan cookies de terceros sin su permiso) · contacto · redes · selector de idioma · enlaces legales. Pensada primero para móvil, con renderizado en servidor y caché, metadatos Open Graph y datos estructurados `Restaurant` (schema.org) para SEO.

## 8. Clientes y estadísticas

### 8.1 Ficha de clientes

Se crea o actualiza automáticamente con cada reserva, haciendo coincidir el email o el teléfono normalizados. Incluye el historial, los contadores (visitas, cancelaciones, no-shows), las notas internas y las etiquetas (VIP, Habitual, Problemático). Los avisos se muestran en las reservas. Tiene buscador y filtros. La exportación a CSV (solo Administrador) incluye **solo** a los clientes con consentimiento comercial.

### 8.2 Estadísticas

Con rango de fechas: reservas y comensales por día, día de la semana y servicio · ocupación (plazas ocupadas sobre plazas disponibles) · origen (online, teléfono o walk-in) · tasa de cancelación y de no-show · antelación media · cartas y platos más vistos (a partir de `menu_views`).

## 9. Superadmin (FByte)

Listado de restaurantes con estado y buscador · crear un restaurante (nombre, slug, email del administrador), que envía la invitación · reenviar la invitación · activar y desactivar · **ver el panel en solo lectura** para soporte (queda registrado en `admin_audit_log`) · métricas globales (restaurantes activos, reservas del mes).

## 10. Emails

| Destinatario | Emails |
|---|---|
| Comensal (en el idioma en que reservó) | Solicitud recibida (pendiente) · Confirmada · Modificada · Cancelada · Rechazada · Recordatorio 24 h antes |
| Restaurante | Nueva reserva · Nueva solicitud de grupo · Cancelación del cliente |
| Equipo y FByte | Invitación · Recuperación de contraseña |

- Los emails al comensal llevan el logo y el color del restaurante, un archivo `.ics` o botón "Añadir al calendario" y el botón "Cómo llegar".
- El remitente debe estar en un **dominio verificado en la cuenta Resend de FByte** (por ejemplo, `reservas@fbytesolutions.com`), con el nombre visible "Nombre del restaurante vía Mesa" y `reply-to` al email del restaurante. **Hay que confirmar el dominio verificado al configurar.**
- Los recordatorios salen de un cron cada hora que busca reservas confirmadas que empiezan entre 23 y 25 horas después y que todavía no tienen recordatorio.
- Si falla un envío, la reserva se mantiene. Se reintenta hasta 3 veces y, si no se consigue, aparece un aviso visible en la reserva dentro del panel.

## 11. RGPD y legal

- **Roles:** el restaurante es el responsable del tratamiento de los datos de sus comensales, y FByte es el encargado. Al activar el restaurante, se acepta un contrato de encargado del tratamiento, que queda registrado con fecha.
- **Consentimientos** registrados con fecha: privacidad (obligatorio para reservar) y comunicaciones comerciales (opcional y separado).
- **Derechos:** el Administrador puede borrar o anonimizar a un cliente. Sus reservas se conservan anonimizadas para las estadísticas.
- **Retención:** los clientes sin actividad durante **3 años** se anonimizan automáticamente (cron diario).
- **Cookies:** solo las técnicas (sesión e idioma); las métricas del menú no usan cookies, así que no hace falta banner de consentimiento. Aun así, se incluye una política de cookies.
- **Datos en la UE:** Supabase en la región de Fráncfort. Vercel y Resend figuran como subencargados en el contrato.
- ⚠️ **Los textos legales** (política de privacidad, aviso legal, cookies, contrato de encargado del tratamiento) se entregan como **plantillas marcadas como "PENDIENTE DE REVISIÓN LEGAL"**. FByte debe revisarlos con un abogado o asesor antes de vender el producto.

## 12. Gestión de errores

- Hora recién ocupada → mensaje "Vaya, esa hora se acaba de ocupar. Te enseño las más cercanas" y horas alternativas.
- Fallo de email → reintentos y aviso en el panel (ver §10).
- Validación junto a cada campo, en el idioma del comensal, con Zod y los mismos esquemas en el cliente y el servidor.
- Slug inexistente o restaurante desactivado → página informativa propia.
- Límite de intentos y Turnstile en los formularios públicos; mensaje claro si se superan.
- Errores del servidor registrados en los logs de Vercel con contexto (restaurante, acción), sin datos personales.
- Todos los textos de error y de éxito siguen la voz de FByte (o la neutra en las páginas públicas): cortos, humanos y sin jerga.

## 13. Pruebas

- **Unitarias (Vitest):** el algoritmo de disponibilidad (servicios, excepciones, duraciones por tramo, antelación, bloqueos, solapes, mesa más pequeña, cambio de horario de verano, Canarias), el cálculo de precios y formatos, y la programación del menú del día.
- **Base de datos:** aislamiento entre restaurantes (un usuario de A no puede leer ni escribir en B), permisos por rol, la función de reserva con concurrencia (dos reservas simultáneas a la última mesa → solo una se crea) y la restricción de exclusión.
- **Extremo a extremo (Playwright):** reserva online completa, alta de una reserva telefónica, edición del menú y su visualización en un móvil emulado, cancelación desde el enlace del email, e invitación y alta de un usuario.
- **Datos de demostración:** un seed con un "Restaurante Demo" (carta en varios idiomas, mesas, reservas de ejemplo), que también sirve para hacer demos comerciales.

## 14. Orden de construcción (hitos)

| Hito | Contenido | Entregable que se puede probar |
|---|---|---|
| 1. Base | Proyecto, marca, autenticación, superadmin, alta de restaurantes, invitaciones, roles y RLS | Crear un restaurante e invitar al equipo |
| 2. Local y mini-web | Ficha, fotos, idiomas, asistente de bienvenida y mini-web pública | La mini-web en el móvil |
| 3. Menú | Cartas, platos, alérgenos, agotados, menú del día, multidioma y QR | Escanear el QR y ver la carta |
| 4. Reservas | Servicios, mesas, reglas, disponibilidad, reserva online, panel, cuadrícula, emails y crons | Reservar y gestionar la reserva |
| 5. Clientes, estadísticas y RGPD | CRM, no-shows, estadísticas, borrado y anonimización, plantillas legales | Ciclo completo |
| 6. Puesta a punto | Piloto con un restaurante real, ajustes y revisión legal | Lanzamiento |

## 15. Requisitos previos y decisiones pendientes

1. **Repositorio en GitHub** de FByte para el código (conectado a Vercel).
2. **Proyecto Supabase** en la región UE (Fráncfort).
3. **Dominio verificado en Resend** desde el que enviar (¿`fbytesolutions.com`?).
4. **Claves de Cloudflare Turnstile** (gratuitas).
5. **Nombre definitivo** del producto y **dominio** propio (no bloquean el desarrollo).
6. **Revisión legal** de los textos (bloquea la venta, no el desarrollo).
