import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, permanentRedirect } from 'next/navigation';
import { MapEmbed } from '@/components/public/MapEmbed';
import { OpeningHours } from '@/components/public/OpeningHours';
import { PublicShell } from '@/components/public/PublicShell';
import { siteUrl } from '@/lib/env';
import { isLocale, langParam } from '@/lib/i18n/locales';
import { getMessages } from '@/lib/i18n/messages';
import { getPublicRestaurant, mediaUrl } from '@/lib/public/data';
import { directionsUrl, fullAddress, mapEmbedUrl, priceLabel, withLang } from '@/lib/public/format';
import { jsonLdScript, restaurantJsonLd } from '@/lib/public/jsonld';
import { requestLocale } from '@/lib/public/locale';
import { descriptionFor } from '@/lib/public/restaurant-schema';
import { languageAlternates, metaDescription, OG_LOCALE, publicUrl } from '@/lib/public/seo';
import { todayInTimeZone, upcomingExceptions } from '@/lib/schedule';
import { formatPhone } from '@/lib/spain';
import { socialHandle } from '@/lib/social';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(props: Props) {
  const [{ slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const lang = langParam(sp.lang);
  return { slug, lang, result: await getPublicRestaurant(slug) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { lang, result } = await load(props);
  if (result?.kind !== 'restaurant') return {};
  const r = result.restaurant;
  const locale = await requestLocale(lang, r.enabledLocales);
  const site = siteUrl();
  const path = `/${r.slug}`;
  const description = metaDescription(r, locale);
  return {
    title: { absolute: r.cuisine ? `${r.name} · ${r.cuisine}` : r.name },
    description,
    alternates: { canonical: publicUrl(site, path, locale), languages: languageAlternates(site, path, r.enabledLocales) },
    openGraph: {
      type: 'website',
      title: r.name,
      description,
      url: publicUrl(site, path, locale),
      siteName: r.name,
      locale: OG_LOCALE[locale],
      images: r.coverPath ? [{ url: mediaUrl(r.coverPath) }] : undefined,
    },
  };
}

export default async function RestaurantPage(props: Props) {
  const { slug, lang, result } = await load(props);
  if (!result) notFound();
  if (result.kind === 'redirect') permanentRedirect(withLang(`/${result.slug}`, isLocale(lang) ? lang : null));

  const r = result.restaurant;
  // Forma canónica del slug (p. ej. con mayúsculas en la URL): redirección permanente conservando ?lang.
  if (slug !== r.slug) permanentRedirect(withLang(`/${r.slug}`, isLocale(lang) ? lang : null));
  const locale = await requestLocale(lang, r.enabledLocales);
  const m = getMessages(locale);
  const path = `/${r.slug}`;
  const address = fullAddress(r);
  const description = descriptionFor(r, locale);
  const price = priceLabel(r.priceRange);
  const upcoming = upcomingExceptions(r.exceptions, todayInTimeZone(r.timezone));
  const socials = [
    { network: 'Instagram', url: r.instagram },
    { network: 'Facebook', url: r.facebook },
    { network: 'TikTok', url: r.tiktok },
  ].filter((s): s is { network: string; url: string } => s.url !== null);
  const jsonLd = restaurantJsonLd(r, { url: publicUrl(siteUrl(), path, locale), mediaUrl });
  const accentButton = 'inline-flex items-center rounded-lg bg-[var(--accent)] px-5 py-3 font-bold text-[var(--on-accent)] hover:opacity-90';

  return (
    <PublicShell restaurant={r} locale={locale} path={path}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <header className="relative">
        <div className="relative h-56 w-full bg-neutral-200 sm:h-80">
          {r.coverPath && (
            <Image src={mediaUrl(r.coverPath)} alt={m.coverAlt(r.name)} fill priority unoptimized sizes="100vw" className="object-cover" />
          )}
        </div>
        <div className="mx-auto flex max-w-3xl items-end gap-4 px-4">
          {r.logoPath && (
            <div className="relative -mt-12 size-24 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white shadow-md">
              <Image src={mediaUrl(r.logoPath)} alt={m.logoAlt(r.name)} fill unoptimized sizes="96px" className="object-contain" />
            </div>
          )}
          <div className="pt-4">
            <h1 className="text-3xl font-extrabold tracking-tight">{r.name}</h1>
            {(r.cuisine || price) && (
              <p className="text-neutral-600">
                {r.cuisine}
                {r.cuisine && price && ' · '}
                {price && <span aria-label={`${m.price}: ${price}`}>{price}</span>}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pt-6">
        <div className="flex flex-wrap gap-3">
          {address && (
            <a href={directionsUrl(address)} target="_blank" rel="noopener noreferrer" className={accentButton}>
              {m.directions}
            </a>
          )}
          {r.phone && (
            <a href={`tel:${r.phone}`} className="inline-flex items-center rounded-lg border-2 border-neutral-300 px-5 py-3 font-bold hover:border-neutral-500">
              {m.call}
            </a>
          )}
        </div>

        {description && (
          <section>
            <h2 className="mb-2 text-xl font-bold text-[var(--accent-text)]">{m.about}</h2>
            <p className="whitespace-pre-line leading-relaxed">{description}</p>
          </section>
        )}

        {r.photos.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.gallery}</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {r.photos.map((p, i) => (
                <li key={p} className="relative aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100">
                  <Image src={mediaUrl(p)} alt={m.photoAlt(r.name, i + 1)} fill unoptimized loading="lazy" sizes="(min-width: 640px) 33vw, 50vw" className="object-cover" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.hours}</h2>
          <OpeningHours services={r.services} upcoming={upcoming} messages={m} />
        </section>

        {(address || r.phone || r.contactEmail || r.website) && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.contact}</h2>
            <dl className="flex flex-col gap-2">
              {address && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.address}</dt>
                  <dd>{address}</dd>
                </div>
              )}
              {r.phone && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.phone}</dt>
                  <dd>
                    <a href={`tel:${r.phone}`} className="underline">
                      {formatPhone(r.phone)}
                    </a>
                  </dd>
                </div>
              )}
              {r.contactEmail && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.email}</dt>
                  <dd>
                    <a href={`mailto:${r.contactEmail}`} className="underline">
                      {r.contactEmail}
                    </a>
                  </dd>
                </div>
              )}
              {r.website && (
                <div>
                  <dt className="text-sm text-neutral-500">{m.website}</dt>
                  <dd>
                    <a href={r.website} target="_blank" rel="noopener noreferrer" className="underline">
                      {r.website.replace(/^https:\/\//, '')}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {address && (
              <div className="mt-4">
                <MapEmbed src={mapEmbedUrl(address)} title={m.mapTitle(r.name)} buttonLabel={m.viewMap} notice={m.mapNotice} />
              </div>
            )}
          </section>
        )}

        {socials.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-[var(--accent-text)]">{m.social}</h2>
            <ul className="flex flex-wrap gap-3">
              {socials.map(({ network, url }) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-full border-2 border-neutral-300 px-4 py-2 font-semibold hover:border-neutral-500">
                    {network} · {socialHandle(url)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </PublicShell>
  );
}
