import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from '@/lib/i18n/locales';

/** Texto escrito por el restaurante en cada idioma: {"es": "Croquetas", "en": "Croquettes"}. */
export type I18nText = Partial<Record<Locale, string>>;

/** El texto en el idioma pedido o, si falta, en castellano. null si no hay ninguno. */
export function textFor(value: I18nText | null | undefined, locale: Locale): string | null {
  const own = value?.[locale]?.trim();
  if (own) return own;
  return value?.[DEFAULT_LOCALE]?.trim() || null;
}

/** Idiomas activos sin traducción (para el aviso «Falta la traducción» del panel). */
export function missingLocales(value: I18nText | null | undefined, enabled: readonly Locale[]): Locale[] {
  return enabled.filter((l) => !value?.[l]?.trim());
}

/** Nombres de los campos de formulario de un texto: localeKeys('name') → ['name_es', 'name_en', …]. */
export function localeKeys<P extends string>(prefix: P): `${P}_${Locale}`[] {
  return LOCALES.map((l) => `${prefix}_${l}` as const);
}

/** Campos `${prefix}_${idioma}` de un formulario → texto por idioma, sin textos vacíos. */
export function i18nFromForm(values: Readonly<Record<string, string | undefined>>, prefix: string): I18nText {
  const out: I18nText = {};
  for (const l of LOCALES) {
    const value = values[`${prefix}_${l}`]?.trim();
    if (value) out[l] = value;
  }
  return out;
}

/** JSON de la BD → texto por idioma (solo idiomas conocidos y textos no vacíos). */
export function toI18nText(value: unknown): I18nText {
  const out: I18nText = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, text] of Object.entries(value)) {
    if (isLocale(key) && typeof text === 'string' && text.trim()) out[key] = text;
  }
  return out;
}
