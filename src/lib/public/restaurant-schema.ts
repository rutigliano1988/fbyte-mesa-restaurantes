import { z } from 'zod';
import type { Locale } from '@/lib/i18n/locales';
import { sortLocales } from '@/lib/i18n/locales';

const minutes = z.number().int();

const service = z
  .object({ name: z.string(), weekday: z.number().int().min(1).max(7), start_minute: minutes, end_minute: minutes })
  .transform((s) => ({ name: s.name, weekday: s.weekday, startMinute: s.start_minute, endMinute: s.end_minute }));

const customService = z
  .object({ name: z.string(), start_minute: minutes, end_minute: minutes })
  .transform((s) => ({ name: s.name, startMinute: s.start_minute, endMinute: s.end_minute }));

const exception = z
  .object({
    date_from: z.string(),
    date_to: z.string(),
    kind: z.enum(['closed', 'custom']),
    custom_services: z.array(customService),
    note: z.string().nullable(),
  })
  .transform((e) => ({
    dateFrom: e.date_from,
    dateTo: e.date_to,
    kind: e.kind,
    customServices: e.custom_services,
    note: e.note,
  }));

const text = z.string().nullable();

/** JSON de public.get_public_restaurant() (snake_case) → objeto de la app (camelCase). */
const restaurantSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    enabled_locales: z.array(z.string()),
    cuisine: text,
    price_range: z.number().int().min(1).max(4).nullable(),
    address_line: text,
    postal_code: text,
    city: text,
    phone: text,
    contact_email: text,
    website: text,
    instagram: text,
    facebook: text,
    tiktok: text,
    accent_color: z.string(),
    logo_path: text,
    cover_path: text,
    legal_name: text,
    tax_id: text,
    descriptions: z.record(z.string(), z.string()),
    photos: z.array(z.string()),
    services: z.array(service),
    exceptions: z.array(exception),
  })
  .transform((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    timezone: r.timezone,
    enabledLocales: sortLocales(r.enabled_locales),
    cuisine: r.cuisine,
    priceRange: r.price_range,
    addressLine: r.address_line,
    postalCode: r.postal_code,
    city: r.city,
    phone: r.phone,
    contactEmail: r.contact_email,
    website: r.website,
    instagram: r.instagram,
    facebook: r.facebook,
    tiktok: r.tiktok,
    accentColor: r.accent_color,
    logoPath: r.logo_path,
    coverPath: r.cover_path,
    legalName: r.legal_name,
    taxId: r.tax_id,
    descriptions: r.descriptions as Partial<Record<Locale, string>>,
    photos: r.photos,
    services: r.services,
    exceptions: r.exceptions,
  }));

export type PublicRestaurant = z.output<typeof restaurantSchema>;
export type PublicLookup = { kind: 'restaurant'; restaurant: PublicRestaurant } | { kind: 'redirect'; slug: string } | null;

const redirectSchema = z.object({ redirect: z.string() });

export function parsePublicLookup(data: unknown): PublicLookup {
  if (data === null || data === undefined) return null;
  const redirect = redirectSchema.safeParse(data);
  if (redirect.success) return { kind: 'redirect', slug: redirect.data.redirect };
  return { kind: 'restaurant', restaurant: restaurantSchema.parse(data) };
}

/** Descripción en el idioma pedido o, si falta, en castellano. */
export function descriptionFor(r: PublicRestaurant, locale: Locale): string | null {
  return r.descriptions[locale] ?? r.descriptions.es ?? null;
}
