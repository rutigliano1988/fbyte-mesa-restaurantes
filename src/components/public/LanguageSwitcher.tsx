import Link from 'next/link';
import { LOCALE_NAMES, type Locale } from '@/lib/i18n/locales';
import { localeHref } from '@/lib/public/format';

/**
 * La misma página en cada idioma activo (?lang=, sin cookies). Nada si el restaurante solo tiene uno.
 * `query`: parámetros que se conservan al cambiar de idioma (p. ej. la carta elegida).
 */
export function LanguageSwitcher({
  enabled,
  locale,
  path,
  label,
  query,
  className = '',
}: {
  enabled: readonly Locale[];
  locale: Locale;
  path: string;
  label: string;
  query?: Record<string, string>;
  className?: string;
}) {
  if (enabled.length < 2) return null;
  const extra = Object.entries(query ?? {})
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('');
  return (
    <nav aria-label={label} className={`flex flex-wrap gap-x-4 gap-y-2 ${className}`}>
      {enabled.map((l) => (
        <Link
          key={l}
          href={`${localeHref(path, l)}${extra}`}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? 'page' : undefined}
          className={l === locale ? 'font-bold text-neutral-900' : 'hover:underline'}
        >
          {LOCALE_NAMES[l]}
        </Link>
      ))}
    </nav>
  );
}
