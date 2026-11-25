export const LOCALES = ['es', 'en', 'ca', 'fr', 'de', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
/** El castellano siempre está activo y es el idioma de respaldo. */
export const DEFAULT_LOCALE: Locale = 'es';

/** Nombre de cada idioma en ese idioma (selector de la mini-web). */
export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  ca: 'Català',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
};

/** Nombre en castellano (panel). */
export const LOCALE_LABELS_ES: Record<Locale, string> = {
  es: 'Castellano',
  en: 'Inglés',
  ca: 'Catalán',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Quita lo desconocido y los repetidos, y ordena como LOCALES (castellano primero). */
export function sortLocales(values: readonly string[]): Locale[] {
  return LOCALES.filter((l) => values.includes(l));
}

/** 'ca-ES,ca;q=0.9,en;q=0.5' → ['ca-es', 'ca', 'en'] por preferencia. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((x) => x.tag !== '' && x.tag !== '*' && x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((x) => x.tag);
}

/**
 * Idioma de la mini-web: ?lang= si está activo; si no, el primero del navegador que esté activo;
 * si no, castellano. Sin cookies.
 */
export function resolveLocale(input: {
  lang?: string | null;
  acceptLanguage?: string | null;
  enabled: readonly string[];
}): Locale {
  const enabled = sortLocales(input.enabled);
  const lang = input.lang?.trim().toLowerCase();
  if (isLocale(lang) && enabled.includes(lang)) return lang;
  for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
    const base = tag.split('-')[0];
    if (isLocale(base) && enabled.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** `?lang=` tal como lo entrega Next 16 (string | string[] | undefined): primer valor, recortado y en minúsculas. */
export function langParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const lang = first?.trim().toLowerCase();
  return lang ? lang : undefined;
}
