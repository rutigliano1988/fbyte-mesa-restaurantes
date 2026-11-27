import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { LanguageSwitcher } from '@/components/public/LanguageSwitcher';
import { PublicMenu, type PublicMenuLabels } from '@/components/public/PublicMenu';
import { PublicShell } from '@/components/public/PublicShell';
import { siteUrl } from '@/lib/env';
import { isLocale, langParam } from '@/lib/i18n/locales';
import { getMessages, type PublicMessages } from '@/lib/i18n/messages';
import { textFor } from '@/lib/menu/i18n-text';
import { getPublicMenu, getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { localeHref, menuPath, menuTabHref } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';
import { buildMenuView, menusToShow } from '@/lib/public/menu-view';
import { languageAlternates, metaDescription, OG_LOCALE, publicUrl } from '@/lib/public/seo';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(props: Props) {
  const [{ slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const carta = Array.isArray(sp.carta) ? sp.carta[0] : sp.carta;
  return { slug, lang: langParam(sp.lang), carta, result: await getPublicRestaurant(slug) };
}

function menuLabels(m: PublicMessages, itemCount: number): PublicMenuLabels {
  return {
    allergens: m.allergens,
    tags: m.tags,
    allergensLabel: m.allergensLabel,
    marketPriceTitle: m.marketPriceTitle,
    unavailable: m.unavailable,
    askStaffAllergens: m.askStaffAllergens,
    allergenDisclaimer: m.allergenDisclaimer,
    filterTitle: m.filterTitle,
    filterIntro: m.filterIntro,
    filterHidden: Array.from({ length: itemCount + 1 }, (_, n) => m.filterHidden(n)),
    filterClear: m.filterClear,
    filterAllHidden: m.filterAllHidden,
    menuIndex: m.menuIndex,
    closePhoto: m.closePhoto,
  };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { lang, result } = await load(props);
  if (result?.kind !== 'restaurant') return {};
  const r = result.restaurant;
  const locale = await requestLocale(lang, r.enabledLocales);
  const title = getMessages(locale).menuTitle(r.name);
  const site = siteUrl();
  const path = menuPath(r.slug);
  return {
    title: { absolute: title },
    description: metaDescription(r, locale),
    alternates: { canonical: publicUrl(site, path, locale), languages: languageAlternates(site, path, r.enabledLocales) },
    openGraph: {
      type: 'website',
      title,
      url: publicUrl(site, path, locale),
      siteName: r.name,
      locale: OG_LOCALE[locale],
      images: r.coverPath ? [{ url: mediaUrl(r.coverPath) }] : undefined,
    },
  };
}

export default async function PublicMenuPage(props: Props) {
  const { slug, lang, carta, result } = await load(props);
  if (!result) notFound();
  const target = (s: string) => (isLocale(lang) ? localeHref(menuPath(s), lang) : menuPath(s));
  // Los QR impresos con la dirección antigua siguen funcionando.
  if (result.kind === 'redirect') permanentRedirect(target(result.slug));
  const r = result.restaurant;
  if (slug !== r.slug) permanentRedirect(target(r.slug));

  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getMessages(locale);
  const data = await getPublicMenu(r.slug);
  // Qué cartas se ven se decide ahora, en la zona horaria del restaurante: la caché solo trae la programación.
  const menus = menusToShow(data, new Date(), r.timezone);
  const selected = menus.find((x) => x.id === carta) ?? menus[0] ?? null;
  const view = selected && data ? buildMenuView(selected, { locale, unavailableMode: data.unavailableMode, messages: m, mediaUrl }) : null;
  const itemCount = view ? view.sections.reduce((n, s) => n + s.items.length, 0) : 0;
  const path = menuPath(r.slug);

  return (
    <PublicShell restaurant={r} locale={locale} path={path} languagesInFooter={false}>
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href={localeHref(`/${r.slug}`, locale)} className="flex items-center gap-3">
            {r.logoPath && (
              <span className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <Image src={mediaUrl(r.logoPath)} alt={m.logoAlt(r.name)} fill unoptimized sizes="48px" className="object-contain" />
              </span>
            )}
            <span className="text-lg font-extrabold">{r.name}</span>
          </Link>
          <LanguageSwitcher
            enabled={r.enabledLocales}
            locale={locale}
            path={path}
            label={m.language}
            query={selected && selected.id === carta ? { carta: selected.id } : undefined}
            className="text-sm"
          />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6">
        <h1 className="text-3xl font-extrabold tracking-tight">{m.menuTitle(r.name)}</h1>

        {menus.length > 1 && (
          <nav aria-label={m.menuTabs}>
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {menus.map((x) => {
                const current = x.id === selected?.id;
                return (
                  <li key={x.id} className="shrink-0">
                    <Link
                      href={menuTabHref(r.slug, locale, x.id)}
                      aria-current={current ? 'page' : undefined}
                      className={
                        current
                          ? 'inline-block rounded-full border-2 border-[var(--accent-text)] bg-[var(--accent)] px-4 py-2 font-bold text-[var(--on-accent)]'
                          : 'inline-block rounded-full border-2 border-neutral-300 px-4 py-2 font-bold hover:border-neutral-500'
                      }
                    >
                      {textFor(x.names, locale)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {view ? (
          <>
            {view.kind !== 'carta' && (
              <div className="rounded-xl border-2 border-[var(--accent)] p-4">
                <p className="text-sm font-bold uppercase tracking-wide text-[var(--accent-text)]">
                  {view.kind === 'daily' ? m.dailyMenu : m.specialMenu}
                </p>
                <p className="text-2xl font-extrabold">
                  {view.title}
                  {view.priceText && <span className="whitespace-nowrap"> · {view.priceText}</span>}
                </p>
                {view.includes && (
                  <p className="mt-1 text-neutral-700">
                    <span className="font-semibold">{m.menuIncludes}:</span> {view.includes}
                  </p>
                )}
              </div>
            )}
            <PublicMenu view={view} labels={menuLabels(m, itemCount)} />
          </>
        ) : (
          <p className="text-neutral-600">{m.menuEmpty}</p>
        )}

        <p className="text-sm text-neutral-600">{m.vatIncluded}</p>
      </main>
    </PublicShell>
  );
}
