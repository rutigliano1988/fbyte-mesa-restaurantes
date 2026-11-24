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
];

export function mapDbError(message: string | null | undefined): string {
  if (!message) return GENERIC;
  for (const [pattern, text] of RULES) if (pattern.test(message)) return text;
  return GENERIC;
}
