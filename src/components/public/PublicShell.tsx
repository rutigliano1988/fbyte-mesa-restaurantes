import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { BRAND } from '@/config/brand';
import { publicAccentTheme } from '@/lib/color';
import type { Locale } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { localeHref } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Marco de las páginas públicas: colores del restaurante, idioma, selector de idioma y pie. */
export function PublicShell({
  restaurant,
  locale,
  path,
  languagesInFooter = true,
  children,
}: {
  restaurant: PublicRestaurant;
  locale: Locale;
  path: string;
  /** La carta pone el selector en la cabecera; el resto de páginas, en el pie. */
  languagesInFooter?: boolean;
  children: ReactNode;
}) {
  const theme = publicAccentTheme(restaurant.accentColor);
  const m = getMessages(locale);
  const style = { '--accent': theme.accent, '--on-accent': theme.onAccent, '--accent-text': theme.accentText } as CSSProperties;
  return (
    <div lang={locale} style={style} className="min-h-dvh bg-white text-neutral-900">
      {children}
      <footer className="mt-12 border-t border-neutral-200 px-4 py-8 text-center text-sm text-neutral-600">
        {languagesInFooter && (
          <LanguageSwitcher enabled={restaurant.enabledLocales} locale={locale} path={path} label={m.language} className="mb-4 justify-center" />
        )}
        <p>
          <Link href={localeHref(`/${restaurant.slug}/aviso-legal`, locale)} className="hover:underline">
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
