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
])('%s → mensaje claro', (raw, msg) => {
  expect(mapDbError(raw)).toBe(msg);
});

it('cualquier otro error da un mensaje genérico', () => {
  expect(mapDbError('connection reset')).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
  expect(mapDbError(undefined)).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
});
