import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { withLang } from './format';
import { descriptionFor, type PublicRestaurant } from './restaurant-schema';

export function publicUrl(siteUrl: string, path: string, locale: Locale): string {
  return `${siteUrl}${withLang(path, locale)}`;
}

/** hreflang: una URL por idioma activo y x-default en castellano. */
export function languageAlternates(siteUrl: string, path: string, enabled: readonly Locale[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of enabled) out[locale] = publicUrl(siteUrl, path, locale);
  out['x-default'] = publicUrl(siteUrl, path, DEFAULT_LOCALE);
  return out;
}

/** Descripción para buscadores: la del restaurante o, si no hay, tipo de cocina y ciudad. Máximo 160 caracteres. */
export function metaDescription(r: PublicRestaurant, locale: Locale): string {
  const text = descriptionFor(r, locale) ?? [r.name, r.cuisine, r.city].filter(Boolean).join(' · ');
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 159).trimEnd()}…` : clean;
}

/** Open Graph usa idioma_PAÍS. */
export const OG_LOCALE: Record<Locale, string> = {
  es: 'es_ES',
  en: 'en_GB',
  ca: 'ca_ES',
  fr: 'fr_FR',
  de: 'de_DE',
  it: 'it_IT',
};
