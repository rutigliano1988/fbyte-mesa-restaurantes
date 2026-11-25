import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { BRAND } from '@/config/brand';
import { accentTheme } from '@/lib/color';
import { LOCALE_NAMES, type Locale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { withLang } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';

/** Marco de las páginas públicas: colores del restaurante, idioma, selector de idioma y pie. */
export function PublicShell({
  restaurant,
  locale,
  path,
  children,
}: {
  restaurant: PublicRestaurant;
  locale: Locale;
  path: string;
  children: ReactNode;
}) {
  const theme = accentTheme(restaurant.accentColor);
  const m = getMessages(locale);
  const style = { '--accent': theme.accent, '--on-accent': theme.onAccent, '--accent-text': theme.accentText } as CSSProperties;
  return (
    <div lang={locale} style={style} className="min-h-dvh bg-white text-neutral-900">
      {children}
      <footer className="mt-12 border-t border-neutral-200 px-4 py-8 text-center text-sm text-neutral-600">
        {restaurant.enabledLocales.length > 1 && (
          <nav aria-label={m.language} className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
            {restaurant.enabledLocales.map((l) => (
              <Link
                key={l}
                href={withLang(path, l)}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? 'true' : undefined}
                className={l === locale ? 'font-bold text-neutral-900' : 'hover:underline'}
              >
                {LOCALE_NAMES[l]}
              </Link>
            ))}
          </nav>
        )}
        <p>
          <Link href={withLang(`/${restaurant.slug}/aviso-legal`, locale)} className="hover:underline">
            {m.legalNotice}
          </Link>
        </p>
        <p className="mt-2">
          <a href={BRAND.companyUrl} className="hover:underline">
            {m.poweredBy(BRAND.productName, BRAND.company)}
          </a>
        </p>
      </footer>
    </div>
  );
}
