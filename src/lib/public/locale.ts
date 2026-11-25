import 'server-only';
import { headers } from 'next/headers';
import { resolveLocale, type Locale } from '@/lib/i18n/locales';

/** Idioma de la petición: ?lang= y, si no, Accept-Language (solo entre los activos). */
export async function requestLocale(lang: string | undefined, enabled: readonly Locale[]): Promise<Locale> {
  const h = await headers();
  return resolveLocale({ lang, acceptLanguage: h.get('accept-language'), enabled });
}
