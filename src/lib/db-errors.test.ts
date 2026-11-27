import { afterEach, expect, it, vi } from 'vitest';
import { dbError, mapDbError } from './db-errors';

it.each([
  ['FORBIDDEN', 'No tienes permiso para hacer esto.'],
  ['SLUG_RESERVED', 'Esa dirección está reservada. Prueba con otra.'],
  ['duplicate key value violates unique constraint "restaurants_slug_key"', 'Ya hay un restaurante con esa dirección. Prueba con otra.'],
  ['ALREADY_MEMBER', 'Esa persona ya forma parte del equipo.'],
  ['LAST_ADMIN', 'Tiene que quedar al menos un administrador.'],
  ['INVALID_INVITATION', 'Esta invitación ya no es válida. Pide que te la reenvíen.'],
  ['EMAIL_MISMATCH', 'Esta invitación es para otro email. Entra con la cuenta correcta.'],
  ['INVALID_EMAIL', 'Ese email no parece correcto.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_slug_check"', 'La dirección solo puede llevar minúsculas, números y guiones.'],
  ['RESTAURANT_DISABLED', 'Este restaurante está desactivado. Reactívalo antes de invitar a nadie.'],
  ['NOT_FOUND', 'No encontramos ese restaurante.'],
  ['NOT_AUTHENTICATED', 'Tu sesión ha caducado. Vuelve a entrar.'],
  ['SLUG_TAKEN', 'Esa dirección ya la usa otro restaurante. Prueba con otra.'],
  ['PHOTO_LIMIT', 'Ya tienes 12 fotos en la galería. Borra alguna para subir otra.'],
  ['conflicting key value violates exclusion constraint "services_no_overlap"', 'Ese servicio se solapa con otro del mismo día.'],
  ['new row for relation "services" violates check constraint "services_range_check"', 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.'],
  ['conflicting key value violates exclusion constraint "schedule_exceptions_no_overlap"', 'Ya hay un cierre u horario especial en esas fechas.'],
  ['new row for relation "schedule_exceptions" violates check constraint "schedule_exceptions_dates_check"', 'Revisa las fechas: la final no puede ser anterior a la inicial (y como mucho, un año).'],
  ['MISSING_FIELDS', 'Todavía faltan datos para publicar. Revisa la lista.'],
  ['ALREADY_PUBLISHED', 'Tu web ya está publicada.'],
  ['DPA_VERSION', 'El contrato ha cambiado. Recarga la página y vuelve a aceptarlo.'],
  ['DPA_REQUIRED', 'Este restaurante aún no ha aceptado el contrato. Lo publica su administrador desde el panel.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_tax_id_check"', 'Ese CIF, NIF o NIE no parece correcto.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_postal_code_check"', 'El código postal tiene 5 cifras (por ejemplo, 28013).'],
  ['new row for relation "restaurants" violates check constraint "restaurants_accent_color_check"', 'Elige un color válido.'],
  ['new row for relation "restaurants" violates check constraint "restaurants_enabled_locales_es_check"', 'El castellano siempre tiene que estar activo.'],
  ['The object exceeded the maximum allowed size', 'La imagen pesa demasiado. Prueba con otra más pequeña.'],
  ['mime type image/gif is not supported', 'Ese formato de imagen no vale. Usa JPG, PNG o WebP.'],
  ['new row violates row-level security policy for table "objects"', 'No tienes permiso para hacer esto.'],
  ['PUBLISHED_FIELDS_REQUIRED', 'Tu web está publicada: este dato no se puede dejar vacío.'],
  ['INVALID_INPUT', 'Revisa los datos: hay algo que no es válido.'],
  ['SLUG_CHANGE_LIMIT', 'Ya has cambiado la dirección demasiadas veces. Escríbenos a FByte si necesitas otra.'],
  ['MENU_LIMIT', 'Ya tienes 20 cartas. Borra alguna para crear otra.'],
  ['SECTION_LIMIT', 'Esta carta ya tiene 40 secciones. Borra alguna para añadir otra.'],
  ['ITEM_LIMIT', 'Esta sección ya tiene 100 platos. Quita alguno o crea otra sección.'],
  ['DISH_LIMIT', 'Ya tienes 500 platos. Borra los que no uses para crear otros.'],
  ['PRICE_LIMIT', 'Un plato puede tener como mucho 4 precios.'],
  ['MARKET_PRICE_ALONE', 'Un precio «según mercado» va solo: quita los demás precios.'],
  ['INLINE_ONLY_DAILY', 'Los platos escritos a mano solo valen en el menú del día y en los menús especiales.'],
  ['duplicate key value violates unique constraint "menu_items_menu_dish_key"', 'Ese plato ya está en esta carta.'],
  ['new row for relation "dishes" violates check constraint "dishes_tags_allergens_check"', 'Esas etiquetas no encajan con los alérgenos del plato.'],
  ['new row for relation "dish_prices" violates check constraint "dish_prices_amount_check"', 'Revisa los precios: van de 0 a 99.999,99 € y «según mercado» no lleva importe.'],
  ['new row for relation "menus" violates check constraint "menus_time_check"', 'Revisa la programación del menú: días, horas y fechas.'],
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
])('%s → mensaje claro', (raw, msg) => {
  expect(mapDbError(raw)).toBe(msg);
});

it('cualquier otro error da un mensaje genérico', () => {
  expect(mapDbError('connection reset')).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
  expect(mapDbError(undefined)).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
});

afterEach(() => vi.restoreAllMocks());

it('dbError: registra el error desconocido con su contexto y devuelve el texto genérico', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(dbError('reservas.create', { message: 'boom 42P01' })).toBe(mapDbError(undefined));
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('[reservas.create]', 'boom 42P01');
});

it('dbError: no registra un error conocido y devuelve su texto', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(dbError('reservas.create', { message: 'SLOT_TAKEN' })).toBe(mapDbError('SLOT_TAKEN'));
  expect(log).not.toHaveBeenCalled();
});
