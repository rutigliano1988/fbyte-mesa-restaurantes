# Puesta en marcha de Mesa

## 1. Supabase
1. Crea un proyecto en la región **EU Central (Frankfurt)**.
2. Aplica las migraciones de `supabase/migrations/` **en orden** (SQL Editor, `supabase db push` o la herramienta MCP `apply_migration`).
   Después, revisa los avisos de seguridad y rendimiento con `get_advisors` (MCP de Supabase) o en Advisors del panel: no debe quedar ningún aviso de seguridad.
3. Settings → API Keys: copia la *publishable key* y la *secret key* en `.env.local` (ver `.env.example`).
4. Authentication → URL Configuration:
   - **Site URL**: la URL pública (en local `http://localhost:3000`).
   - **Redirect URLs**: `http://localhost:3000/auth/confirm` y `https://<dominio>/auth/confirm`.
     En el proyecto de **desarrollo** (el que usan las vistas previas) añade también el comodín de Vercel: `https://*-<equipo>.vercel.app/auth/confirm`.
5. Authentication → Providers → Email: deja activado el acceso con email y contraseña. Desactiva **"Allow new users to sign up"**: las cuentas solo se crean mediante invitación.
6. Authentication → SMTP: configura el SMTP de **Resend** (host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key de Resend) con el mismo remitente que `EMAIL_FROM`. Lo usan los emails de recuperación de contraseña.
7. Authentication → Emails: sustituye las plantillas en inglés por textos en castellano. La importante es **Reset password**: su enlace tiene que pasar por `/auth/confirm` con `token_hash`, para que la recuperación funcione aunque se abra el email en otro navegador o en el móvil.

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
   - **Nunca des la clave secreta de producción (`SUPABASE_SECRET_KEY`) a las vistas previas (Preview).** En el entorno Preview de Vercel usa las claves de un proyecto de Supabase de **desarrollo**, aparte del de producción.
3. Cada push a `main` despliega a producción; cada PR crea una vista previa.
