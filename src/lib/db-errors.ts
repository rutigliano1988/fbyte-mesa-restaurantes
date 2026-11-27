const GENERIC = 'Algo ha fallado. Vuelve a intentarlo en un momento.';

const RULES: [RegExp, string][] = [
  [/FORBIDDEN|permission denied|row-level security/i, 'No tienes permiso para hacer esto.'],
  [/SLUG_RESERVED/, 'Esa dirección está reservada. Prueba con otra.'],
  [/restaurants_slug_key/, 'Ya hay un restaurante con esa dirección. Prueba con otra.'],
  [/restaurants_slug_check/, 'La dirección solo puede llevar minúsculas, números y guiones.'],
  [/ALREADY_MEMBER/, 'Esa persona ya forma parte del equipo.'],
  [/LAST_ADMIN/, 'Tiene que quedar al menos un administrador.'],
  [/INVALID_INVITATION/, 'Esta invitación ya no es válida. Pide que te la reenvíen.'],
  [/EMAIL_MISMATCH/, 'Esta invitación es para otro email. Entra con la cuenta correcta.'],
  [/INVALID_EMAIL/, 'Ese email no parece correcto.'],
  [/RESTAURANT_DISABLED/, 'Este restaurante está desactivado. Reactívalo antes de invitar a nadie.'],
  [/\bNOT_FOUND\b/, 'No encontramos ese restaurante.'],
  [/NOT_AUTHENTICATED/, 'Tu sesión ha caducado. Vuelve a entrar.'],
  // Hito 2: ficha, fotos, horario y publicación
  [/SLUG_TAKEN/, 'Esa dirección ya la usa otro restaurante. Prueba con otra.'],
  [/PHOTO_LIMIT/, 'Ya tienes 12 fotos en la galería. Borra alguna para subir otra.'],
  [/services_no_overlap/, 'Ese servicio se solapa con otro del mismo día.'],
  [/services_range_check/, 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.'],
  [/schedule_exceptions_no_overlap/, 'Ya hay un cierre u horario especial en esas fechas.'],
  [/schedule_exceptions_dates_check/, 'Revisa las fechas: la final no puede ser anterior a la inicial (y como mucho, un año).'],
  [/MISSING_FIELDS/, 'Todavía faltan datos para publicar. Revisa la lista.'],
  [/ALREADY_PUBLISHED/, 'Tu web ya está publicada.'],
  [/DPA_VERSION/, 'El contrato ha cambiado. Recarga la página y vuelve a aceptarlo.'],
  [/PUBLISHED_FIELDS_REQUIRED/, 'Tu web está publicada: este dato no se puede dejar vacío.'],
  [/SLUG_CHANGE_LIMIT/, 'Ya has cambiado la dirección demasiadas veces. Escríbenos a FByte si necesitas otra.'],
  [/INVALID_INPUT/, 'Revisa los datos: hay algo que no es válido.'],
  [/DPA_REQUIRED/, 'Este restaurante aún no ha aceptado el contrato. Lo publica su administrador desde el panel.'],
  [/restaurants_tax_id_check/, 'Ese CIF, NIF o NIE no parece correcto.'],
  [/restaurants_postal_code_check/, 'El código postal tiene 5 cifras (por ejemplo, 28013).'],
  [/restaurants_accent_color_check/, 'Elige un color válido.'],
  [/restaurants_enabled_locales_es_check/, 'El castellano siempre tiene que estar activo.'],
  [/exceeded the maximum allowed size|payload too large/i, 'La imagen pesa demasiado. Prueba con otra más pequeña.'],
  [/mime type/i, 'Ese formato de imagen no vale. Usa JPG, PNG o WebP.'],
  // Hito 3: menú
  [/MENU_LIMIT/, 'Ya tienes 20 cartas. Borra alguna para crear otra.'],
  [/SECTION_LIMIT/, 'Esta carta ya tiene 40 secciones. Borra alguna para añadir otra.'],
  [/ITEM_LIMIT/, 'Esta sección ya tiene 100 platos. Quita alguno o crea otra sección.'],
  [/DISH_LIMIT/, 'Ya tienes 500 platos. Borra los que no uses para crear otros.'],
  [/PRICE_LIMIT/, 'Un plato puede tener como mucho 4 precios.'],
  [/MARKET_PRICE_ALONE/, 'Un precio «según mercado» va solo: quita los demás precios.'],
  [/INLINE_ONLY_DAILY/, 'Los platos escritos a mano solo valen en el menú del día y en los menús especiales.'],
  [/menu_items_menu_dish_key/, 'Ese plato ya está en esta carta.'],
  [/dishes_tags_allergens_check/, 'Esas etiquetas no encajan con los alérgenos del plato.'],
  [/dish_prices_amount_check/, 'Revisa los precios: van de 0 a 99.999,99 € y «según mercado» no lleva importe.'],
  [/menus_(kind|time|dates|weekdays|price_cents)_check/, 'Revisa la programación del menú: días, horas y fechas.'],
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

export function mapDbError(message: string | null | undefined): string {
  if (!message) return GENERIC;
  for (const [pattern, text] of RULES) if (pattern.test(message)) return text;
  return GENERIC;
}

/**
 * Texto para enseñar ante un error de la BD. Si el mensaje no corresponde a ninguna regla (error inesperado),
 * deja rastro en el log con el contexto (nombre de la acción) y el mensaje de PostgREST; nunca datos del cliente.
 */
export function dbError(context: string, error: { message?: string | null } | null | undefined): string {
  const text = mapDbError(error?.message);
  if (text === GENERIC) console.error(`[${context}]`, error?.message ?? '(sin mensaje)');
  return text;
}
