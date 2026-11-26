import type { Locale } from '@/lib/i18n/locales';
import { MAX_PRICE_CENTS, type PriceKind } from './codes';

const NBSP = ' ';
const NUMBER_LOCALE: Record<Locale, string> = {
  es: 'es-ES',
  en: 'en-GB',
  ca: 'ca-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
};

/** 1250 → '12,50 €' (con espacio duro), o '€12.50' en inglés. */
export function formatCents(cents: number, locale: Locale = 'es'): string {
  const amount = new Intl.NumberFormat(NUMBER_LOCALE[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
  return locale === 'en' ? `€${amount}` : `${amount}${NBSP}€`;
}

/** Textos de las unidades en el idioma de la página (salen de messages.ts). */
export type PriceUnitLabels = { perKg: string; per100g: string; market: string };

/** Un precio del plato tal como se muestra: '12,50 €', '45,00 €/kg', '6,00 €/100 g' o 'S/M'. */
export function formatDishPrice(
  price: { kind: PriceKind; priceCents: number | null },
  locale: Locale,
  units: PriceUnitLabels,
): string {
  if (price.kind === 'market' || price.priceCents === null) return units.market;
  const amount = formatCents(price.priceCents, locale);
  if (price.kind === 'per_kg') return `${amount}${units.perKg}`;
  if (price.kind === 'per_100g') return `${amount}${units.per100g}`;
  return amount;
}

/**
 * Importe escrito en el panel → céntimos: '12,50', '12.5', '12', '1.250,00', '1.250' (miles) o '12,50 €'.
 * null si no es un importe o se sale de 0–99 999,99.
 */
export function parsePriceInput(raw: string): number | null {
  const value = raw.replace(/€/g, '').replace(/\s/g, '');
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(value) || /^\d+,\d{1,2}$/.test(value)) {
    normalized = value.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    normalized = value.replace(/\./g, '');
  } else if (/^\d+(\.\d{1,2})?$/.test(value)) {
    normalized = value;
  } else {
    return null;
  }
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) && cents >= 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}

/** 1250 → '12,50' (valor inicial de los campos de importe). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
