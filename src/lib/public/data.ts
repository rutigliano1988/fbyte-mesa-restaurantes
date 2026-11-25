import 'server-only';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { serverEnv } from '@/lib/env';
import { sortLocales, type Locale } from '@/lib/i18n/locales';
import { publicMediaUrl } from '@/lib/media';
import { isValidSlug } from '@/lib/slug';
import { createPublicClient } from '@/lib/supabase/public';
import { parsePublicLookup, type PublicLookup } from './restaurant-schema';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from './tags';

/** Una hora como red de seguridad; lo normal es que las acciones del panel invaliden al momento. */
const REVALIDATE_SECONDS = 3600;

/** Mini-web por dirección pública. Cacheada por slug; React cache() evita repetirla entre generateMetadata y la página. */
export const getPublicRestaurant = cache(async (rawSlug: string): Promise<PublicLookup> => {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidSlug(slug)) return null;
  return unstable_cache(
    async () => {
      const { data, error } = await createPublicClient().rpc('get_public_restaurant', { p_slug: slug });
      if (error) throw new Error(`get_public_restaurant: ${error.message}`);
      return parsePublicLookup(data);
    },
    ['public-restaurant', slug],
    { tags: [publicRestaurantTag(slug), PUBLIC_ALL_TAG], revalidate: REVALIDATE_SECONDS },
  )();
});

export type PublicSlug = { slug: string; enabledLocales: Locale[]; updatedAt: string };

export const getPublicSlugs = unstable_cache(
  async (): Promise<PublicSlug[]> => {
    const { data, error } = await createPublicClient().rpc('list_public_slugs');
    if (error) throw new Error(`list_public_slugs: ${error.message}`);
    return ((data ?? []) as { slug: string; enabled_locales: string[]; updated_at: string }[]).map((r) => ({
      slug: r.slug,
      enabledLocales: sortLocales(r.enabled_locales),
      updatedAt: r.updated_at,
    }));
  },
  ['public-slugs'],
  { tags: [PUBLIC_ALL_TAG], revalidate: REVALIDATE_SECONDS },
);

/** URL pública de una imagen del bucket restaurant-media. */
export function mediaUrl(path: string): string {
  return publicMediaUrl(serverEnv().NEXT_PUBLIC_SUPABASE_URL, path);
}
