'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { LOCALES } from '@/lib/i18n/locales';
import {
  accentColorSchema,
  basicsSchema,
  changeSlugSchema,
  contactSchema,
  languagesSchema,
  legalSchema,
  socialSchema,
} from '@/lib/validation/local';
import { runPanelAction, type SupabaseServerClient } from './run';

const SAVED = 'Guardado.';

function restaurantIdOf(fd: FormData): string {
  return String(fd.get('restaurantId') ?? '');
}

/** UPDATE con la sesión del usuario; si la RLS no deja tocar la fila, devuelve 0 filas → sin permiso. */
async function updateRestaurant(
  supabase: SupabaseServerClient,
  restaurantId: string,
  values: Record<string, unknown>,
): Promise<FormState> {
  const { data, error } = await supabase.from('restaurants').update(values).eq('id', restaurantId).select('id');
  if (error) return { error: mapDbError(error.message) };
  if (!data?.length) return { error: mapDbError('FORBIDDEN') };
  return { success: SAVED };
}

const BASICS_FIELDS = [
  'name',
  'cuisine',
  'priceRange',
  'timezone',
  ...LOCALES.map((l) => `description_${l}` as const),
] as const;

export async function saveBasics(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = basicsSchema.safeParse(formStrings(fd, BASICS_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { name, cuisine, priceRange, timezone } = parsed.data;
  // Solo los idiomas que venían en el formulario (los activos); el resto no se toca.
  const descriptions: Record<string, string> = {};
  for (const locale of LOCALES) {
    const key = `description_${locale}` as const;
    if (fd.has(key)) descriptions[locale] = parsed.data[key];
  }
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const saved = await updateRestaurant(supabase, restaurantId, { name, cuisine, price_range: priceRange, timezone });
    if (saved.error) return saved;
    const { error } = await supabase.rpc('save_restaurant_translations', {
      p_restaurant_id: restaurantId,
      p_descriptions: descriptions,
    });
    if (error) return { error: mapDbError(error.message) };
    return { success: 'Datos básicos guardados.' };
  });
}

export async function saveContact(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = contactSchema.safeParse(formStrings(fd, ['addressLine', 'postalCode', 'city', 'phone', 'contactEmail', 'website']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) =>
    updateRestaurant(supabase, restaurantId, {
      address_line: d.addressLine,
      postal_code: d.postalCode,
      city: d.city,
      phone: d.phone,
      contact_email: d.contactEmail,
      website: d.website,
    }),
  );
}

export async function saveSocial(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = socialSchema.safeParse(formStrings(fd, ['instagram', 'facebook', 'tiktok']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) => updateRestaurant(supabase, restaurantId, parsed.data));
}

export async function saveAccentColor(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = accentColorSchema.safeParse(formStrings(fd, ['accentColor']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) =>
    updateRestaurant(supabase, restaurantId, { accent_color: parsed.data.accentColor }),
  );
}

export async function saveLanguages(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = languagesSchema.safeParse({ locales: fd.getAll('locales') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  // Los idiomas salen en el sitemap y en los hreflang: se invalida todo lo público.
  return runPanelAction(
    restaurantId,
    'restaurant.edit',
    async (supabase) => {
      const saved = await updateRestaurant(supabase, restaurantId, { enabled_locales: parsed.data.locales });
      return saved.error ? saved : { success: 'Idiomas guardados. Escribe la descripción en cada uno en «Datos básicos».' };
    },
    { allPublic: true },
  );
}

export async function changeSlug(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = changeSlugSchema.safeParse(formStrings(fd, ['slug']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(
    restaurantId,
    'restaurant.edit',
    async (supabase) => {
      const { error } = await supabase.rpc('change_slug', { p_restaurant_id: restaurantId, p_new_slug: parsed.data.slug });
      if (error) return { error: mapDbError(error.message) };
      return { success: 'Dirección cambiada. La antigua sigue funcionando y lleva a la nueva.' };
    },
    { allPublic: true },
  );
}

export async function saveLegal(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = legalSchema.safeParse(formStrings(fd, ['legalName', 'taxId']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = restaurantIdOf(fd);
  return runPanelAction(restaurantId, 'restaurant.edit', (supabase) =>
    updateRestaurant(supabase, restaurantId, { legal_name: parsed.data.legalName, tax_id: parsed.data.taxId }),
  );
}
