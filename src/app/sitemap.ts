import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';
import { getPublicSlugs } from '@/lib/public/data';
import { languageAlternates } from '@/lib/public/seo';

// Se genera al pedirlo (no en el build) y tira de la caché etiquetada de las mini-webs.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  const restaurants = await getPublicSlugs();
  return restaurants.map((r) => ({
    url: `${site}/${r.slug}`,
    lastModified: r.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.8,
    alternates: { languages: languageAlternates(site, `/${r.slug}`, r.enabledLocales) },
  }));
}
