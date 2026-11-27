import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Teléfono escrito a mano → E.164 (+34612345678). Sin prefijo se entiende de España; admite extranjeros con +
 * o 00. null si no es un número válido.
 */
export function normalizePhoneE164(input: string): string | null {
  const value = input.trim().replace(/^00/, '+');
  if (!/^\+?[\d\s().-]{6,25}$/.test(value)) return null;
  const phone = parsePhoneNumberFromString(value, 'ES');
  return phone?.isValid() ? phone.number : null;
}

/** '+34612345678' → '612 34 56 78'; extranjeros con su prefijo: '+44 20 7946 0958'. */
export function formatPhoneDisplay(e164: string): string {
  const phone = parsePhoneNumberFromString(e164);
  if (!phone) return e164;
  return phone.country === 'ES' ? phone.formatNational() : phone.formatInternational();
}
