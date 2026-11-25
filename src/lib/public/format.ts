import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

/** 2 → '€€'. */
export function priceLabel(priceRange: number | null): string | null {
  return priceRange ? '€'.repeat(priceRange) : null;
}

/** 'Calle Mayor 1, 28013 Madrid'. null si no hay nada. */
export function fullAddress(r: { addressLine: string | null; postalCode: string | null; city: string | null }): string | null {
  const tail = [r.postalCode, r.city].filter(Boolean).join(' ');
  const parts = [r.addressLine, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Abre Google Maps con la ruta hasta el restaurante (sin geocodificar: usa la dirección escrita). */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address}, España`)}`;
}

/** Mapa incrustado. Solo se carga cuando el comensal pulsa "Ver mapa". */
export function mapEmbedUrl(address: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${address}, España`)}&output=embed`;
}

/** Ruta con ?lang= salvo para el castellano. */
export function withLang(path: string, locale: Locale | null | undefined): string {
  return !locale || locale === DEFAULT_LOCALE ? path : `${path}?lang=${locale}`;
}

/** Enlace interno que conserva el idioma elegido: añade ?lang= siempre, también en castellano. */
export function localeHref(path: string, locale: Locale): string {
  return `${path}?lang=${locale}`;
}
