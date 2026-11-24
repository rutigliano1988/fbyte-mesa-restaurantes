# Puesta en marcha de Mesa

## 1. Supabase
1. Crea un proyecto en la región **EU Central (Frankfurt)**.
2. Aplica las migraciones de `supabase/migrations/` **en orden** (SQL Editor, `supabase db push` o la herramienta MCP `apply_migration`).
3. Settings → API Keys: copia la *publishable key* y la *secret key* en `.env.local` (ver `.env.example`).
4. Authentication → URL Configuration:
   - **Site URL**: la URL pública (en local `http://localhost:3000`).
   - **Redirect URLs**: `http://localhost:3000/auth/confirm` y `https://<dominio>/auth/confirm`.
5. Authentication → Providers → Email: deja activado el acceso con email y contraseña. Desactiva **"Allow new users to sign up"**: las cuentas solo se crean mediante invitación.
6. Authentication → SMTP: configura el SMTP de **Resend** (host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key de Resend) con el mismo remitente que `EMAIL_FROM`. Lo usan los emails de recuperación de contraseña.

## 2. Resend
- `EMAIL_FROM` tiene que usar un **dominio verificado** en la cuenta de FByte.
- Sin `RESEND_API_KEY`, la app no envía nada y escribe los emails en la consola. Los enlaces de invitación se muestran en pantalla de todas formas.

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
3. Cada push a `main` despliega a producción; cada PR crea una vista previa.
