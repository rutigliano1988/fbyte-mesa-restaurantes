# Puesta en marcha de Mesa

## 1. Supabase
1. Crea un proyecto en la región **EU Central (Frankfurt)**.
2. Aplica las migraciones de `supabase/migrations/` **en orden** (SQL Editor, `supabase db push` o la herramienta MCP `apply_migration`). Las ya aplicadas no se vuelven a aplicar ni se editan.
   - Hito 1: `20261124000100_base.sql`, `20261124000200_invitations.sql`.
   - Hito 2: `20261125000100_local.sql`, `20261125000200_horario.sql`, `20261125000300_publicar.sql`.
   - **Aviso sobre `20261125000300_publicar.sql`:** devuelve a «En configuración» (`setup`) los restaurantes que estén «Activo» (`active`) sin un contrato de encargado del tratamiento aceptado; su Administrador tendrá que publicar de nuevo. Despliega esta migración **a la vez que el código de la aplicación de este hito**, no antes ni mucho después.
   - Hito 3: `20261126000100_menu.sql`, `20261126000200_menu_funciones.sql`, `20261126000300_menu_fotos.sql`, `20261126000400_menu_publico.sql`. No tocan datos existentes: añaden las tablas del menú, sus funciones y la columna `restaurants.menu_unavailable_mode` (por defecto `strike`). `20261126000300_menu_fotos.sql` sustituye `public.can_manage_media` para que los Encargados gestionen las fotos de platos; si falla por permisos, ejecútala desde el SQL Editor. Aplica las 4 migraciones del Hito 3 **antes** de desplegar el código (son aditivas y compatibles con el código del Hito 2).
   - Hito 4A: `20261127000100_reservas.sql` y `20261127000200_reservas_funciones.sql`. No tocan datos existentes: añaden zonas, mesas, ajustes de reserva, clientes, reservas, mesas de cada reserva y bloqueos (con su RLS), dos columnas en `services` (`last_booking_minute`, vacía, y `slot_interval_min`, 15 por defecto) y las funciones del panel de reservas. **Aplícalas antes de desplegar el código del Hito 4A**: el código nuevo lee esas columnas y tablas; el del Hito 3 sigue funcionando con ellas.
   - **Tiempo real:** `20261127000100_reservas.sql` añade `reservations`, `reservation_tables` y `blocks` a la publicación `supabase_realtime` (si existe, como en todo proyecto de Supabase). Compruébalo en Database → Publications → `supabase_realtime`: tienen que salir esas tres tablas. Si no, actívalas ahí a mano. Los cambios llegan filtrados por las RLS de cada usuario.

   Después, revisa los avisos de seguridad y rendimiento con `get_advisors` (MCP de Supabase) o en Advisors del panel. Es normal que queden avisos 0028/0029 (funciones `SECURITY DEFINER` ejecutables):
   - para `anon`: `get_invitation`, `get_public_restaurant`, `list_public_slugs`, `get_public_menu` y `list_public_menus` (la mini-web y la carta pública solo leen por ellas);
   - para `authenticated`: las de permisos (`is_member`, `has_role`, `my_role`, `belongs_to`, `is_platform_admin`, `my_restaurants`) y las de negocio (`create_restaurant`, `create_invitation`, `accept_invitation`, `set_restaurant_status`, `log_admin_view`, `restaurant_team`, `change_slug`, `restaurant_missing_fields`, `publish_restaurant`, `set_dish_unavailable`, `set_menu_unavailable_mode`, `get_public_menu`, `list_public_menus`, `create_panel_reservation`, `create_walk_in`, `update_panel_reservation`, `set_reservation_status`, `undo_reservation_status`).

   Son intencionados: **no les quites los permisos**, porque las políticas RLS y la mini-web dependen de ellos. Cualquier otro aviso de seguridad sí hay que corregirlo.
   - Del rendimiento, con las tablas del Hito 4A es normal ver avisos `unindexed_foreign_keys` (nivel INFO) en las claves foráneas compuestas `(x_id, restaurant_id)` de `tables`, `reservations`, `reservation_tables` y `blocks`: sus índices empiezan por la columna `x_id` o la acompañan con otra, y el advisor no los da por buenos. Son intencionados (las consultas y los borrados en cascada usan esos índices) y no hay que crear índices compuestos extra.
   - Tras aplicar las migraciones, haz una prueba real de subida como Administrador: sube un logo y una foto de galería y comprueba que aparecen en Storage → `restaurant-media`.
3. Storage (lo crea la migración `20261125000100_local.sql`): en Storage → Buckets comprueba que existe `restaurant-media`, **público**, con límite de 2 MB y tipos `image/webp` e `image/jpeg`, y que en Storage → Policies aparecen `restaurant_media_select`, `restaurant_media_insert`, `restaurant_media_update` y `restaurant_media_delete` sobre `storage.objects`. Si la migración no pudiera crear esas políticas por permisos, créalas a mano en esa pantalla con la expresión `public.can_manage_media(bucket_id, name)` (en `insert` como *with check*; en `update`, en las dos), para el rol `authenticated`.
   - Si al crear las políticas sobre `storage.objects` falla con «must be owner of table objects», ejecuta la parte de Storage de `20261125000100_local.sql` desde el SQL Editor de Supabase.
   - La extensión `btree_gist` se instala en el esquema `extensions` (la necesitan las restricciones que impiden solapar servicios y cierres).
   - El plan gratuito no transforma imágenes: el navegador las reduce y las pasa a WebP antes de subirlas. No hace falta activar *Image Transformations*.
   - Desde el Hito 3, la carpeta `{restaurante}/dishes/` (fotos de platos) la pueden gestionar el Administrador y el Encargado; el resto del bucket, solo el Administrador. Haz una prueba real como Encargado: sube la foto de un plato y comprueba que aparece en `restaurant-media/<id>/dishes/`.
4. Settings → API Keys: copia la *publishable key* y la *secret key* en `.env.local` (ver `.env.example`).
5. Authentication → URL Configuration:
   - **Site URL**: la URL pública (en local `http://localhost:3000`).
   - **Redirect URLs**: `http://localhost:3000/auth/confirm` y `https://<dominio>/auth/confirm`.
     En el proyecto de **desarrollo** (el que usan las vistas previas) añade también el comodín de Vercel: `https://*-<equipo>.vercel.app/auth/confirm`.
6. Authentication → Providers → Email: deja activado el acceso con email y contraseña. Desactiva **"Allow new users to sign up"**: las cuentas solo se crean mediante invitación.
7. Authentication → SMTP: configura el SMTP de **Resend** (host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key de Resend) con el mismo remitente que `EMAIL_FROM`. Lo usan los emails de recuperación de contraseña.
8. Authentication → Emails: sustituye las plantillas en inglés por textos en castellano. La importante es **Reset password**: su enlace tiene que pasar por `/auth/confirm` con `token_hash`, para que la recuperación funcione aunque se abra el email en otro navegador o en el móvil.

   - **Asunto**: `Cambia tu contraseña`
   - **Cuerpo** (HTML):

   ```html
   <h2>Cambia tu contraseña</h2>
   <p>Hola:</p>
   <p>Nos has pedido cambiar la contraseña de tu acceso. Pulsa el botón y elige una nueva. Es rápido.</p>
   <p>
     <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/nueva-contrasena"
        style="display:inline-block;background:#FF7A1A;color:#0A1330;font-weight:700;padding:12px 20px;border-radius:6px;text-decoration:none">
       Elegir contraseña nueva
     </a>
   </p>
   <p>El enlace caduca pronto y solo sirve una vez.</p>
   <p>Si no has sido tú, ignora este email: tu contraseña sigue igual.</p>
   <p>Un saludo,<br />El equipo de FByte Solutions</p>
   ```

   En el resto de plantillas (Confirm signup, Invite user, Magic Link, Change email address) usa el mismo tono y el mismo esquema de enlace, cambiando `type` por `signup`, `invite`, `magiclink` o `email_change`. La app no las usa hoy (las cuentas se crean por invitación propia), pero así ningún email llega en inglés.

## 2. Resend
- `EMAIL_FROM` tiene que usar un **dominio verificado** en la cuenta de FByte.
- En desarrollo, sin `RESEND_API_KEY` la app no envía nada: escribe el asunto en la consola y muestra el enlace de invitación en pantalla.
- **En producción, sin `RESEND_API_KEY` no se envía ningún email**: la app registra un error y avisa de que no pudo enviar la invitación. Los administradores de restaurante nunca ven el enlace de invitación en producción; solo el superadmin de FByte.

## 3. Primer superadmin

```bash
ADMIN_PASSWORD='una-clave-larga-y-segura' pnpm admin:create persona@fbytesolutions.com
```

## 4. Desarrollo local

```bash
pnpm install
cp .env.example .env.local   # y rellénalo
pnpm dev
```

Pruebas: `pnpm test` (unitarias y de BD; la BD de pruebas se levanta sola en el puerto 54329) y `pnpm test:e2e` (requiere `.env.local` y un superadmin en `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`).

## 5. Vercel
1. Importa el repositorio de GitHub.
2. Variables de entorno: todas las de `.env.example`, con `NEXT_PUBLIC_SITE_URL` = URL de producción.
   En las vistas previas, define `NEXT_PUBLIC_SITE_URL` en el entorno *Preview* (por ejemplo, la URL fija de la rama), o acepta que los enlaces de invitación y recuperación apunten al sitio de desarrollo.
   - **Nunca des la clave secreta de producción (`SUPABASE_SECRET_KEY`) a las vistas previas (Preview).** En el entorno Preview de Vercel usa las claves de un proyecto de Supabase de **desarrollo**, aparte del de producción.
3. Cada push a `main` despliega a producción; cada PR crea una vista previa.
   - Settings → Functions: comprueba que la región de las funciones es **`fra1` (Fráncfort)**, por RGPD y por latencia con Supabase (`eu-central-1`).
4. No hay variables nuevas en el Hito 2. Las server actions aceptan cuerpos de hasta 4 MB (`next.config.ts`), por debajo del límite de 4,5 MB de las funciones de Vercel; las fotos llegan ya comprimidas (máx. 2 MB).
5. La mini-web vive en `/<slug>` y se cachea por restaurante; los cambios del panel se ven al momento. `sitemap.xml` y `robots.txt` usan `NEXT_PUBLIC_SITE_URL`: ponla con la URL de producción.
6. No hay variables nuevas en el Hito 3. El PNG y el PDF del QR se generan en funciones de Node.js (`sharp` ya viene con Next.js). Los QR apuntan a `NEXT_PUBLIC_SITE_URL/<slug>/menu`: **antes de imprimir QR de verdad, comprueba que esa variable tiene la dirección definitiva** (si después cambias de dominio, los QR impresos dejarán de funcionar; si solo cambia el slug, siguen funcionando).
7. No hay variables nuevas en el Hito 4A. El tiempo real del panel de reservas usa `NEXT_PUBLIC_SUPABASE_URL` y la *publishable key* con la sesión del usuario (nunca la clave secreta). Orden de publicación: **primero las migraciones del Hito 4A en Supabase, después el despliegue**.

## 6. Revisión legal (antes de abrir a clientes)
1. El contrato de encargado del tratamiento (`src/lib/legal/dpa.ts`, versión `2026-11-borrador`) y el aviso legal de la mini-web son plantillas marcadas «PENDIENTE DE REVISIÓN LEGAL»: tiene que revisarlas un abogado antes de publicar restaurantes reales.
2. Vercel y Resend son proveedores de EE. UU.: incluye las **transferencias internacionales de datos** (y sus garantías) en el contrato y en la lista de subencargados.
