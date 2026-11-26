# Mesa — Hito 3 (Menú digital): decisiones de diseño

- **Fecha:** 26/11/2026
- **Completa:** `docs/superpowers/specs/2026-11-24-plataforma-restaurantes-design.md` (§3, §5 "Menú", §7.2–§7.6, §13) y `2026-11-25-hito-2-decisiones.md`. Si hay contradicción, manda este documento.
- **Estado de partida:** Hito 2 en `main` (a07d86b), desplegado y probado a mano por el usuario. Las migraciones `20261124000100`, `20261124000200`, `20261125000100`, `20261125000200` y `20261125000300` **ya están aplicadas** en Supabase: **no se editan**; todo cambio de BD va en migraciones nuevas.

## Decisiones confirmadas por el usuario
1. **Tipos de precio:** fijo (con etiqueta opcional: Ración/Media, Copa/Botella), **por peso** (€/kg o €/100 g) y **según mercado** (sin importe, se muestra "S/M"). Hasta 4 precios por plato.
2. **Iconos de alérgenos propios:** 14 SVG sencillos de línea, con el estilo de FByte, hechos para Mesa (sin licencias de terceros). Siempre acompañados del nombre del alérgeno.
3. **PDF del QR:** una hoja A4 con 4 tarjetas A6 iguales y marcas de corte. Además, el QR en PNG.
4. **Modelo de platos reutilizables** (enfoque A): los platos son del restaurante y las cartas los colocan en sus secciones; el mismo plato puede estar en varias cartas (p. ej., Carta y menú del día) y su precio, su agotado y sus traducciones son los mismos en todas.
5. **Estadísticas de platos vistos (`menu_views`) al Hito 5**, con el resto de estadísticas. En el Hito 3 no se registran visitas.

## Decisiones técnicas (tomadas por coherencia con la spec, presentadas y aprobadas)

### Datos
6. **Cartas (`menus`)** de tres tipos: `carta` (Carta, Bebidas, Vinos, Postres…; siempre visible si está activa), `daily` (menú del día) y `special` (menú especial con fechas). Campos: nombre por idioma, `position`, `active`; para `daily`/`special`: `price_cents` (precio cerrado, obligatorio) y texto "incluye" por idioma (opcional, máx. 300).
7. **Programación** (solo `daily`/`special`), en columnas en lugar del `schedule jsonb` de la spec:
   - `weekdays smallint[]` (ISO 1 = lunes … 7 = domingo; obligatorio, al menos un día),
   - `start_minute`/`end_minute` opcionales (los dos o ninguno; mismas reglas que los servicios del Hito 2: `end ≤ 1800`, se admite pasar de medianoche),
   - `date_from`/`date_to` opcionales (los dos o ninguno; obligatorios en `special`).
   - Visible si hoy (en la zona del restaurante) está en el rango de fechas (si lo hay), el día de la semana está en `weekdays` y la hora está en la franja (si la hay). Una franja que pasa de medianoche cuenta para el día en que empieza.
   - La visibilidad se calcula **al pintar la página** (en la zona horaria del restaurante), no en la caché: los datos cacheados traen la programación.
8. **Secciones (`menu_sections`)** con nombre por idioma y `position`. En la carta, una sección es una categoría; en el menú del día, "Primeros", "Segundos"…
9. **Platos (`dishes`)** del restaurante: nombre (obligatorio en castellano, máx. 120) y descripción (opcional, máx. 500) por idioma; foto opcional; alérgenos; etiquetas; `unavailable` (agotado).
   - **Alérgenos** como códigos de texto (`text[]`, en lugar de los `smallint[]` de la spec, por legibilidad): `gluten`, `crustaceans`, `eggs`, `fish`, `peanuts`, `soy`, `milk`, `nuts`, `celery`, `mustard`, `sesame`, `sulphites`, `lupin`, `molluscs` (Reglamento (UE) 1169/2011, anexo II).
   - **Etiquetas:** `vegan`, `vegetarian`, `gluten_free`, `spicy`, `new`, `recommended`. La BD rechaza `gluten_free` junto al alérgeno `gluten`, y `vegan` junto a `milk`, `eggs`, `fish`, `crustaceans` o `molluscs`.
10. **Precios (`dish_prices`)**: `kind` = `fixed` | `per_kg` | `per_100g` | `market`; `price_cents` obligatorio salvo en `market` (donde es nulo); etiqueta opcional por idioma (máx. 40); `position`. Un precio `market` va solo (no se combina con otros). Un plato sin precios es válido (p. ej., en un menú del día).
11. **Elementos de sección (`menu_items`)**: un plato del restaurante (`dish_id`) **o** un plato escrito solo para ese menú (`inline_names` por idioma, con alérgenos propios), nunca los dos. Los platos escritos a mano solo se admiten en `daily`/`special`. Un plato no se repite dentro de la misma carta.
12. **Agotados:** `restaurants.menu_unavailable_mode` = `hide` | `strike` (por defecto `strike`), lo elige el Administrador o el Encargado en Menú.
13. **Límites:** 20 cartas por restaurante, 40 secciones por carta, 100 elementos por sección, 500 platos por restaurante, 4 precios por plato. Importes entre 0 y 99 999,99 €.
14. **Fotos de platos** en el bucket `restaurant-media`, ruta `{restaurant_id}/dishes/{uuid}.webp`; el navegador reduce a 1200 px como en el Hito 2. Hace falta una migración que amplíe `can_manage_media`: la carpeta `dishes/` la gestionan Administrador y Encargado; el resto de rutas, solo el Administrador (como ahora).

### Panel
15. **Sección nueva "Menú"** (`/panel/[id]/menu`):
    - **Administrador y Encargado** (`menu.edit`): lista de cartas (crear, renombrar, activar/desactivar, ordenar, borrar), y dentro de cada carta sus secciones y platos; editor de plato (textos por idioma activo con indicador de "falta traducción", foto, alérgenos, etiquetas, precios); duplicar plato; en `daily`/`special`, "Añadir un plato que ya tienes" y "Escribir un plato solo para este menú"; programación y precio del menú.
    - **Sala/Recepción** (`menu.toggle_unavailable`): pantalla sencilla, pensada para el móvil durante el servicio, con los platos agrupados por carta y el interruptor de agotado. Nada más.
    - **Orden por arrastre** con `@dnd-kit` (con soporte de teclado), y además botones "Subir"/"Bajar" con `aria-label` con contexto.
16. **Código QR** en `/panel/[id]/menu/qr` (`menu.edit`): vista previa y descargas PNG y PDF. Se generan en el servidor (route handlers con `requirePanelAccess`). Si el restaurante no está publicado se avisa de que el QR no funcionará hasta publicarlo.
17. **Invalidación:** toda acción que cambie el menú (incluido marcar agotado) invalida la etiqueta `public-restaurant:<slug>` con `updateTag`, igual que la ficha.

### Páginas públicas
18. **`/[slug]/menu`**: logo, nombre y selector de idioma (`?lang=`, sin cookies); pestañas por carta, con el menú del día o especial visible en ese momento primero; índice de categorías fijo al hacer scroll; cada plato con nombre, descripción, precios, alérgenos (icono + nombre), etiquetas y foto ampliable; agotados ocultos o tachados con "Agotado" según el ajuste; pie "Precios con IVA incluido" (obligatorio en España para precios al consumidor). Restaurante no activo → 404 como la mini-web; slug antiguo → redirección 301 a `/[nuevo]/menu`.
19. **Filtro de alérgenos** en el navegador (componente cliente, sin guardar ni enviar nada): oculta los platos que contienen los marcados e indica cuántos quedan fuera. Aviso fijo: «Esta información es orientativa. Si tienes una alergia o intolerancia, confírmalo con el personal antes de pedir». Los platos sin ningún alérgeno marcado no se ocultan, pero llevan «Pregunta al personal por los alérgenos».
20. **Mini-web:** botón "Ver carta" si hay al menos una carta visible; bloque del menú del día (nombre, precio, "incluye" y enlace) si hay uno visible en ese momento.
21. **Datos públicos** solo por una función `SECURITY DEFINER` ejecutable por `anon` (`get_public_menu(slug)`) que devuelve las cartas **activas** de restaurantes **activos** con sus secciones, elementos, platos y precios, en los idiomas activos. Nunca devuelve cartas desactivadas. Cacheada con `unstable_cache` (clave versionada `['public-menu', 'v1', slug]`) y etiquetas `public-restaurant:<slug>` + `PUBLIC_ALL_TAG`.
22. **SEO:** `generateMetadata` propio (título "Carta de <restaurante>"), `alternates.languages`; la carta se añade a `sitemap.xml` en cada idioma; el JSON-LD `Restaurant` de la mini-web añade `hasMenu` con la URL de la carta.

### QR
23. El QR apunta a la URL absoluta `/[slug]/menu` (sin `?lang=`). Gracias a `slug_redirects`, los QR impresos siguen funcionando si cambia la dirección.
24. **PNG** de 1024 px con margen. **PDF A4** con 4 tarjetas A6 y marcas de corte; cada tarjeta lleva logo (si lo hay), nombre, QR, «Escanea para ver la carta · Scan to see the menu», la dirección web escrita debajo y una franja con el color de acento. Librerías: `qrcode` (QR) y `pdf-lib` (PDF); el logo WebP se convierte a PNG en el servidor con `sharp` antes de incrustarlo.

### Seguridad y pruebas
25. **RLS por rol:** `menu.edit` (Administrador, Encargado) para todo el menú; Sala solo puede cambiar `dishes.unavailable`, mediante una función (`set_dish_unavailable`) y sin permiso de UPDATE sobre la tabla. Ningún dato del menú es accesible para `anon` salvo por `get_public_menu`.
26. **Pruebas de BD:** permisos por rol (Sala no edita, sí marca agotado; un miembro de otro restaurante no ve nada), límites, coherencia de precios (`market` solo y sin importe), etiquetas incompatibles con alérgenos, `dish_id` xor `inline_names`, `get_public_menu` no devuelve cartas inactivas ni restaurantes en `setup`/`disabled`, ruta de fotos de platos para el Encargado.
27. **Pruebas unitarias:** programación del menú del día (días, franjas que pasan de medianoche, fechas, Canarias y cambio de hora), formato de precios (`12,50 €`, `45,00 €/kg`, `6,00 €/100 g`, `S/M`), filtro de alérgenos, respaldo de traducciones y validaciones de formularios.

## Fuera del Hito 3
- Registro y estadísticas de platos vistos → Hito 5.
- Botón "Reservar" en la mini-web → Hito 4.
- **Idea propuesta para la fase 2 (pendiente de confirmar):** importar la carta desde una foto o un PDF con IA, con revisión del restaurante antes de guardar.
