<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Reglas del proyecto (Mesa)

- Toda página nueva bajo `src/app/panel/[restaurantId]/` debe llamar a `requirePanelAccess(restaurantId, permiso?)` de `@/lib/auth/guards`: el layout por sí solo no es una barrera fiable.
- Las migraciones ya aplicadas a Supabase no se editan: cada cambio va en una migración nueva.
- Todo texto visible, en castellano de España con tuteo y la voz de FByte.
