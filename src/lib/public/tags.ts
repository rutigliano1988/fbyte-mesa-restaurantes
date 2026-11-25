/** Etiqueta de caché de todas las mini-webs (y del sitemap). */
export const PUBLIC_ALL_TAG = 'public-restaurants';

/** Etiqueta de caché de una mini-web, por su dirección pública. */
export function publicRestaurantTag(slug: string): string {
  return `public-restaurant:${slug}`;
}
