import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { PublicShell } from '@/components/public/PublicShell';
import { isLocale, langParam } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { LEGAL_REVIEW_PENDING } from '@/lib/legal/dpa';
import { legalNoticeSections } from '@/lib/legal/legal-notice';
import { getPublicRestaurant } from '@/lib/public/data';
import { withLang } from '@/lib/public/format';
import { requestLocale } from '@/lib/public/locale';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicRestaurant(slug);
  if (result?.kind !== 'restaurant') return {};
  return { title: { absolute: `Aviso legal · ${result.restaurant.name}` }, robots: { index: false } };
}

export default async function LegalNoticePage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const lang = langParam(sp.lang);
  const result = await getPublicRestaurant(slug);
  if (!result) notFound();
  if (result.kind === 'redirect') permanentRedirect(withLang(`/${result.slug}/aviso-legal`, isLocale(lang) ? lang : null));

  const r = result.restaurant;
  if (slug !== r.slug) permanentRedirect(withLang(`/${r.slug}/aviso-legal`, isLocale(lang) ? lang : null));
  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getMessages(locale);
  return (
    <PublicShell restaurant={r} locale={locale} path={`/${r.slug}/aviso-legal`}>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-10">
        <Link href={withLang(`/${r.slug}`, locale)} className="text-sm font-semibold text-[var(--accent-text)] hover:underline">
          ← {m.backToRestaurant}
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">{m.legalNotice}</h1>
        {locale !== 'es' && <p className="text-neutral-600">{m.legalSpanishOnly}</p>}
        <p className="font-bold text-red-700">{LEGAL_REVIEW_PENDING}</p>
        <div lang="es" className="flex flex-col gap-5">
          {legalNoticeSections(r).map((s) => (
            <section key={s.heading}>
              <h2 className="font-bold">{s.heading}</h2>
              <p className="mt-1 leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </main>
    </PublicShell>
  );
}
