import { expect, it } from 'vitest';
import { mapDbError } from './db-errors';

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
])('%s → mensaje claro', (raw, msg) => {
  expect(mapDbError(raw)).toBe(msg);
});

it('cualquier otro error da un mensaje genérico', () => {
  expect(mapDbError('connection reset')).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
  expect(mapDbError(undefined)).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
});
