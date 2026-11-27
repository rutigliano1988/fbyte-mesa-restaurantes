import 'server-only';
import type { RestaurantStatus } from '@/lib/auth/guards';
import { sortLocales, type Locale } from '@/lib/i18n/locales';
import type { ScheduleException, ServiceSlot } from '@/lib/schedule';
import { createClient } from '@/lib/supabase/server';

export type RestaurantProfile = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  timezone: 'Europe/Madrid' | 'Atlantic/Canary';
  enabledLocales: Locale[];
  cuisine: string | null;
  priceRange: number | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  accentColor: string;
  logoPath: string | null;
  coverPath: string | null;
  legalName: string | null;
  taxId: string | null;
  publishedAt: string | null;
};

const PROFILE_COLUMNS =
  'id, name, slug, status, timezone, enabled_locales, cuisine, price_range, address_line, postal_code, city, phone, ' +
  'contact_email, website, instagram, facebook, tiktok, accent_color, logo_path, cover_path, legal_name, tax_id, published_at';

type ProfileRow = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  timezone: 'Europe/Madrid' | 'Atlantic/Canary';
  enabled_locales: string[];
  cuisine: string | null;
  price_range: number | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  contact_email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  accent_color: string;
  logo_path: string | null;
  cover_path: string | null;
  legal_name: string | null;
  tax_id: string | null;
  published_at: string | null;
};

export type RestaurantLocal = {
  profile: RestaurantProfile;
  descriptions: Partial<Record<Locale, string>>;
  photos: { id: string; path: string }[];
  oldSlugs: string[];
};

/** Ficha completa para el panel, con la sesión del usuario (RLS). */
export async function getRestaurantLocal(restaurantId: string): Promise<RestaurantLocal> {
  const supabase = await createClient();
  const [restaurant, translations, photos, redirects] = await Promise.all([
    supabase.from('restaurants').select(PROFILE_COLUMNS).eq('id', restaurantId).single(),
    supabase.from('restaurant_translations').select('locale, description').eq('restaurant_id', restaurantId),
    supabase.from('restaurant_photos').select('id, path').eq('restaurant_id', restaurantId).order('position').order('created_at'),
    supabase.from('slug_redirects').select('old_slug').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`restaurants: ${restaurant.error?.message ?? 'sin datos'}`);
  for (const [table, res] of [['restaurant_translations', translations], ['restaurant_photos', photos], ['slug_redirects', redirects]] as const) {
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
  }
  const r = restaurant.data as unknown as ProfileRow;
  const descriptions: Partial<Record<Locale, string>> = {};
  for (const t of (translations.data ?? []) as { locale: Locale; description: string }[]) descriptions[t.locale] = t.description;
  return {
    profile: {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
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
      publishedAt: r.published_at,
    },
    descriptions,
    photos: (photos.data ?? []) as { id: string; path: string }[],
    oldSlugs: ((redirects.data ?? []) as { old_slug: string }[]).map((s) => s.old_slug),
  };
}

/** Servicio con la última hora de reserva (null = una hora antes del cierre) y el intervalo (Hito 4A). */
export type ScheduleService = ServiceSlot & { id: string; lastBookingMinute: number | null; slotIntervalMin: number };

export type RestaurantSchedule = {
  timezone: string;
  services: ScheduleService[];
  exceptions: (ScheduleException & { id: string })[];
};

export async function getRestaurantSchedule(restaurantId: string): Promise<RestaurantSchedule> {
  const supabase = await createClient();
  const [restaurant, services, exceptions] = await Promise.all([
    supabase.from('restaurants').select('timezone').eq('id', restaurantId).single(),
    supabase
      .from('services')
      .select('id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min')
      .eq('restaurant_id', restaurantId)
      .order('weekday')
      .order('start_minute'),
    supabase
      .from('schedule_exceptions')
      .select('id, date_from, date_to, kind, custom_services, note')
      .eq('restaurant_id', restaurantId)
      .order('date_from'),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`restaurants: ${restaurant.error?.message ?? 'sin datos'}`);
  if (services.error) throw new Error(`services: ${services.error.message}`);
  if (exceptions.error) throw new Error(`schedule_exceptions: ${exceptions.error.message}`);
  type ExceptionRow = {
    id: string;
    date_from: string;
    date_to: string;
    kind: 'closed' | 'custom';
    custom_services: { name: string; start_minute: number; end_minute: number }[];
    note: string | null;
  };
  return {
    timezone: (restaurant.data as { timezone: string }).timezone,
    services: (
      (services.data ?? []) as {
        id: string;
        name: string;
        weekday: number;
        start_minute: number;
        end_minute: number;
        last_booking_minute: number | null;
        slot_interval_min: number;
      }[]
    ).map((s) => ({
      id: s.id,
      name: s.name,
      weekday: s.weekday,
      startMinute: s.start_minute,
      endMinute: s.end_minute,
      lastBookingMinute: s.last_booking_minute,
      slotIntervalMin: s.slot_interval_min,
    })),
    exceptions: ((exceptions.data ?? []) as ExceptionRow[]).map((e) => ({
      id: e.id,
      dateFrom: e.date_from,
      dateTo: e.date_to,
      kind: e.kind,
      customServices: e.custom_services.map((s) => ({ name: s.name, startMinute: s.start_minute, endMinute: s.end_minute })),
      note: e.note,
    })),
  };
}

/** Códigos de lo que falta para publicar (public.restaurant_missing_fields). */
export async function getMissingFields(restaurantId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('restaurant_missing_fields', { p_restaurant_id: restaurantId });
  if (error) throw new Error(`restaurant_missing_fields: ${error.message}`);
  return (data ?? []) as string[];
}
