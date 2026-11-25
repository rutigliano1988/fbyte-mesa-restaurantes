import { minutesToTime } from '@/lib/schedule';
import { priceLabel } from './format';
import type { PublicRestaurant } from './restaurant-schema';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Datos estructurados schema.org/Restaurant. Si "closes" es anterior a "opens", schema.org lo entiende como del día siguiente. */
export function restaurantJsonLd(
  r: PublicRestaurant,
  opts: { url: string; mediaUrl: (path: string) => string },
): Record<string, unknown> {
  const ld: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, url: opts.url };
  if (r.cuisine) ld.servesCuisine = r.cuisine;
  const price = priceLabel(r.priceRange);
  if (price) ld.priceRange = price;
  if (r.phone) ld.telephone = r.phone;
  if (r.contactEmail) ld.email = r.contactEmail;
  const images = [r.coverPath, ...r.photos].filter((p): p is string => Boolean(p)).map(opts.mediaUrl);
  if (images.length) ld.image = images;
  if (r.logoPath) ld.logo = opts.mediaUrl(r.logoPath);
  const sameAs = [r.instagram, r.facebook, r.tiktok].filter(Boolean);
  if (sameAs.length) ld.sameAs = sameAs;
  if (r.addressLine || r.city) {
    ld.address = {
      '@type': 'PostalAddress',
      ...(r.addressLine && { streetAddress: r.addressLine }),
      ...(r.postalCode && { postalCode: r.postalCode }),
      ...(r.city && { addressLocality: r.city }),
      addressCountry: 'ES',
    };
  }
  if (r.services.length) {
    ld.openingHoursSpecification = r.services.map((s) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${DAYS[s.weekday - 1]}`,
      opens: minutesToTime(s.startMinute),
      closes: minutesToTime(s.endMinute),
    }));
  }
  const special = r.exceptions.flatMap((e) =>
    e.kind === 'closed'
      ? [{ '@type': 'OpeningHoursSpecification', validFrom: e.dateFrom, validThrough: e.dateTo, opens: '00:00', closes: '00:00' }]
      : e.customServices.map((s) => ({
          '@type': 'OpeningHoursSpecification',
          validFrom: e.dateFrom,
          validThrough: e.dateTo,
          opens: minutesToTime(s.startMinute),
          closes: minutesToTime(s.endMinute),
        })),
  );
  if (special.length) ld.specialOpeningHoursSpecification = special;
  return ld;
}

/** JSON para <script type="application/ld+json">, sin '<' para que no se pueda cerrar la etiqueta. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
