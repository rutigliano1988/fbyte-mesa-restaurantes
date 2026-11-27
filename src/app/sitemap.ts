import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';
import { getPublicMenuSlugs, getPublicSlugs } from '@/lib/public/data';
import { menuPath } from '@/lib/public/format';
import { languageAlternates } from '@/lib/public/seo';

// Se genera al pedirlo (no en el build) y tira de la caché etiquetada de las mini-webs.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  // Si fallan las cartas, el sitemap sale igual con las mini-webs.
  const [restaurants, menus] = await Promise.all([
    getPublicSlugs(),
    getPublicMenuSlugs().catch((e: unknown) => {
      console.error('[sitemap] no se pudieron cargar las cartas', e instanceof Error ? e.message : e);
      return [];
    }),
  ]);
  return [
    ...restaurants.map((r) => ({
      url: `${site}/${r.slug}`,
      lastModified: r.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      alternates: { languages: languageAlternates(site, `/${r.slug}`, r.enabledLocales) },
    })),
    ...menus.map((r) => ({
      url: `${site}${menuPath(r.slug)}`,
      lastModified: r.updatedAt,
      changeFrequency: 'daily' as const,
      priority: 0.7,
      alternates: { languages: languageAlternates(site, menuPath(r.slug), r.enabledLocales) },
    })),
  ];
}
