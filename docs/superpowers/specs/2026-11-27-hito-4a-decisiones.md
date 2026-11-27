# Mesa — Hito 4A (Reservas: configuración y panel): decisiones de diseño

- **Fecha:** 27/11/2026
- **Completa:** `docs/superpowers/specs/2026-11-24-plataforma-restaurantes-design.md` (§5 "Horarios y mesas" y "Reservas", §6.1, §6.2, §6.4, §8.1, §12) y los documentos de decisiones de los Hitos 2 y 3. Si hay contradicción, manda este documento.
- **Estado de partida:** Hito 3 en `main` (58d0c19), desplegado y probado a mano por el usuario. **Todas** las migraciones de `supabase/migrations/` ya están aplicadas en Supabase: no se editan; todo cambio de BD va en migraciones nuevas (`20261127…`).

## Decisiones confirmadas por el usuario
1. **El Hito 4 se parte en dos entregas**, cada una con su prueba y su publicación:
   - **4A (este documento):** mesas, zonas, reglas y el panel de reservas (teléfono, walk-in, vista del día, cuadrícula, estados, bloqueos, tiempo real). El restaurante ya puede usarlo como libro de reservas digital.
   - **4B (después):** reserva online desde la mini-web, enlace para ver/modificar/cancelar, emails al comensal y al restaurante, recordatorio 24 h, antibots y el cierre automático de reservas sentadas.
2. **El panel se diseña para tablet o portátil** (la cuadrícula se ve entera). En el móvil funciona todo: la vista principal es la lista del día y la cuadrícula se desplaza en horizontal.
3. **Disponibilidad con doble comprobación** (enfoque A): el cálculo de horas y mesas libres es un módulo TypeScript puro y probado; la reserva definitiva la hace una función de Postgres que vuelve a comprobar dentro de una transacción con bloqueo (*advisory lock* por restaurante y día); y una restricción de exclusión (`btree_gist`) impide que una mesa tenga dos reservas activas que se solapen.
4. **Configuración** (Administrador y Encargado): zonas y mesas; última hora de reserva e intervalo por servicio; duración por defecto y tramos por tamaño de grupo; y las reglas de la reserva online (se guardan ya, se aplican en el 4B).
5. **Ficha mínima de cliente** con cada reserva: se reconoce por teléfono o email; contadores de visitas, cancelaciones y no-shows, que se muestran como avisos en la reserva. La pantalla de clientes llega en el Hito 5.
6. **Panel:** vista del día por servicio, cuadrícula mesas × horas, reserva por teléfono con mesa propuesta (la más pequeña que sirve), otra o varias elegidas a mano, o **forzar** cuando no hay hueco; walk-in en un clic; cambios de estado; bloqueos; tiempo real. «Finalizar» es manual en el 4A.
7. **Forzar = sin mesa asignada.** Una reserva forzada se guarda sin mesa y sale en la lista «Sin mesa asignada» del día. Nunca se pone una reserva encima de otra en la misma mesa.

## Decisiones técnicas (coherentes con la spec)

### Datos
8. **Zonas (`zones`)**: nombre (1–40), `position`. Máximo 20 por restaurante. Toda mesa tiene zona; si el restaurante no crea ninguna, el panel crea «Sala» al dar de alta la primera mesa.
9. **Mesas (`tables`)**: zona, nombre (1–20, único por restaurante, p. ej. «T4»), `min_capacity` y `max_capacity` (1–50, mín ≤ máx), `online_bookable` (por defecto sí), `active` (por defecto sí), `position`. Máximo 100 por restaurante. Una mesa con reservas futuras no se borra: se desactiva.
10. **Servicios (`services`, Hito 2)**: columnas nuevas `last_booking_minute` (opcional; si falta, `end_minute − 60`, sin bajar de `start_minute`) y `slot_interval_min` (15 o 30; por defecto 15). Los servicios de un día especial (`schedule_exceptions.custom_services`) usan esos mismos valores por defecto.
11. **Ajustes (`booking_settings`, una fila por restaurante, se crea al guardar por primera vez; si no existe se usan los valores por defecto)**:
    - `default_duration_min` 90 (30–360, múltiplo de 15);
    - `duration_rules`: hasta 6 tramos `{min_party, max_party, duration_min}` sin solaparse;
    - `min_advance_min` 60, `max_advance_days` 60, `max_online_party` 8, `cancel_limit_hours` 2, `auto_confirm` sí (solo para el 4B).
12. **Clientes (`customers`)**: nombre (1–120), teléfono normalizado E.164 (opcional), email en minúsculas (opcional), notas internas (≤ 500), etiquetas (`vip`, `regular`, `problem`), `marketing_opt_in` + fecha (para el 4B/5), `visits_count`, `no_show_count`, `cancel_count`, `last_visit_at`, `anonymized_at`. Únicos por restaurante sobre teléfono y sobre email (índices parciales). Teléfonos con `libphonenumber-js` (país por defecto ES; admite extranjeros).
13. **Reservas (`reservations`)**: cliente (opcional solo en walk-in sin datos), `party_size` 1–50, `starts_at`/`ends_at` (timestamptz), `status` (`pending`, `confirmed`, `seated`, `completed`, `cancelled_customer`, `cancelled_restaurant`, `rejected`, `no_show`), `source` (`online`, `phone`, `walk_in`), notas del cliente y notas internas (≤ 500), `locale`, `created_by`, y las columnas del 4B ya creadas y vacías (`manage_token_hash`, `privacy_accepted_at`). Las reservas del panel nacen `confirmed` (teléfono) o `seated` (walk-in).
14. **Mesas de una reserva (`reservation_tables`)**: una o varias mesas por reserva, con `starts_at`/`ends_at` y `active` copiados de la reserva por trigger; restricción de exclusión `table_id =` + `tstzrange(starts_at, ends_at) &&` cuando `active`. Activas = `pending`, `confirmed`, `seated`.
15. **Bloqueos (`blocks`)**: una mesa o todo el restaurante (`table_id` nulo), `starts_at`/`ends_at`, motivo opcional (≤ 140). Los crean Administrador y Encargado.
16. **Día de servicio:** una reserva pertenece al servicio cuya franja contiene su hora de inicio; los servicios que pasan de medianoche cuentan para el día en que empiezan (igual que en los Hitos 2 y 3). Las reservas fuera de cualquier servicio (p. ej., forzadas a otra hora) salen en «Fuera de horario».
17. **Duración:** la del tramo que contiene `party_size`; si ninguno, la de por defecto. Se puede cambiar a mano en cada reserva.

### Reglas y estados
18. **Cambios de estado permitidos:** `pending → confirmed | rejected | cancelled_*`; `confirmed → seated | no_show | cancelled_*`; `seated → completed`. Se puede **deshacer** el último cambio a `no_show`, `cancelled_*`, `rejected` o `completed` (vuelve a `confirmed` o `seated`), comprobando de nuevo que la mesa sigue libre.
19. **Contadores del cliente por trigger:** `no_show` suma (y deshacer resta) en `no_show_count`; `cancelled_customer` en `cancel_count`; `completed` en `visits_count` y `last_visit_at`.
20. **Funciones de BD** (con `has_role`, `search_path = ''` y *advisory lock* por restaurante y fecha local): crear reserva del panel (con propuesta de mesa, mesas elegidas o forzada sin mesa), modificarla (hora, personas, duración, mesas, notas), cambiar su estado y crear el walk-in. Errores con códigos (`SLOT_TAKEN`, `TABLE_TOO_SMALL`, `INVALID_TRANSITION`…) traducidos en `src/lib/db-errors.ts`. Varias mesas: la suma de sus capacidades máximas debe llegar a `party_size`.
21. **Permisos:** reservas, estados, walk-ins y la vista del día y la cuadrícula → `reservations.manage` (los tres roles). Zonas, mesas, ajustes, servicios y bloqueos → `settings.booking` (Administrador y Encargado). Nada de esto es accesible para `anon` en el 4A.

### Panel
22. **Navegación:** sección «Reservas» (`/panel/[id]/reservas`, vista del día) con «Cuadrícula», y «Reservas → Ajustes» (zonas y mesas, duración y reglas). El horario sigue en «Horario», con los dos campos nuevos por servicio.
23. **Vista del día:** fecha (hoy, ←/→, calendario), resumen por servicio (reservas, personas, pendientes), lista por servicio con hora, nombre, personas, mesas, notas, estado (color **y** texto) y avisos del cliente; listas «Sin mesa asignada» y «Fuera de horario».
24. **Cuadrícula:** filas = mesas por zona; columnas = horas del servicio cada 15 min; barras por reserva y bloqueos rayados; tocar un hueco abre una reserva nueva con esa mesa y hora; tocar una barra abre su ficha. Usable con teclado (cada barra y cada hueco es un botón con nombre accesible).
25. **Nueva reserva por teléfono:** personas, fecha, hora, teléfono (con búsqueda del cliente existente), nombre, email opcional, notas; propone la mesa más pequeña que sirve (desempate por posición) y deja elegir otra(s); si no hay hueco, avisa y ofrece «Guardar sin mesa».
26. **Walk-in:** personas, mesa (libre ahora) y nombre opcional; nace `seated` con la hora actual.
27. **Tiempo real:** Supabase Realtime (`postgres_changes` sobre `reservations`, `reservation_tables` y `blocks`, filtrado por restaurante y protegido por RLS); al llegar un cambio, la página se refresca. Los borrados no se pueden filtrar (solo traen la clave): solo cuentan los de los bloqueos que la página enseña, y los de `reservation_tables` no se escuchan. Al reconectar y al volver a la pestaña, también se refresca. La migración añade esas tablas a la publicación `supabase_realtime` solo si existe y no es `FOR ALL TABLES` (el shim de pruebas no la tiene).
28. **Asistente de bienvenida:** añade el paso «Mesas» (crear al menos una), que no bloquea publicar.

### Pruebas
29. **Unitarias:** disponibilidad (servicios y excepciones, última hora, intervalo, duración por tramos, solapes con reservas y bloqueos, mesa más pequeña, varias mesas, medianoche, cambio de hora, Canarias), transiciones de estado, normalización de teléfonos y validaciones.
30. **De BD:** permisos por rol (Sala reserva pero no configura; otro restaurante no ve nada; anon nada), restricción de exclusión, bloqueo concurrente (dos altas a la vez en la misma mesa → una da `SLOT_TAKEN`), forzar sin mesa, contadores del cliente y deshacer.
31. **Sin e2e** (no hay claves de Supabase en el contenedor): lista de comprobación manual para el usuario.

## Fuera del Hito 4A (van al 4B)
Reserva online y su página pública, enlace del comensal (ver/modificar/cancelar), emails (comensal y restaurante, con `.ics`), recordatorio 24 h y cierre automático de reservas sentadas (crons), Turnstile y límite de intentos, consentimiento de privacidad y comercial del comensal, y el botón «Reservar» en la mini-web.
