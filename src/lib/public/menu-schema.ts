import { z } from 'zod';
import { MENU_KINDS, PRICE_KINDS, sortAllergens, sortTags, UNAVAILABLE_MODES } from '@/lib/menu/codes';
import { toI18nText } from '@/lib/menu/i18n-text';

const i18n = z.record(z.string(), z.unknown()).transform(toI18nText);
const minutes = z.number().int().nullable();

const price = z
  .object({ kind: z.enum(PRICE_KINDS), price_cents: z.number().int().nullable(), labels: i18n })
  .transform((p) => ({ kind: p.kind, priceCents: p.price_cents, labels: p.labels }));

const dish = z
  .object({
    id: z.string(),
    names: i18n,
    descriptions: i18n,
    photo_path: z.string().nullable(),
    allergens: z.array(z.string()),
    tags: z.array(z.string()),
    unavailable: z.boolean(),
    prices: z.array(price),
  })
  .transform((d) => ({
    id: d.id,
    names: d.names,
    descriptions: d.descriptions,
    photoPath: d.photo_path,
    allergens: sortAllergens(d.allergens),
    tags: sortTags(d.tags),
    unavailable: d.unavailable,
    prices: d.prices,
  }));

const item = z
  .object({ id: z.string(), inline_names: i18n.nullable(), inline_allergens: z.array(z.string()), dish: dish.nullable() })
  .transform((i) =>
    i.dish
      ? { id: i.id, kind: 'dish' as const, dish: i.dish }
      : { id: i.id, kind: 'inline' as const, names: i.inline_names ?? {}, allergens: sortAllergens(i.inline_allergens) },
  );

const section = z.object({ id: z.string(), names: i18n, items: z.array(item) });

const menu = z
  .object({
    id: z.string(),
    kind: z.enum(MENU_KINDS),
    names: i18n,
    price_cents: z.number().int().nullable(),
    includes: i18n,
    weekdays: z.array(z.number().int()).nullable(),
    start_minute: minutes,
    end_minute: minutes,
    date_from: z.string().nullable(),
    date_to: z.string().nullable(),
    sections: z.array(section),
  })
  .transform((m) => ({
    id: m.id,
    kind: m.kind,
    names: m.names,
    priceCents: m.price_cents,
    includes: m.includes,
    weekdays: m.weekdays,
    startMinute: m.start_minute,
    endMinute: m.end_minute,
    dateFrom: m.date_from,
    dateTo: m.date_to,
    sections: m.sections,
  }));

/** JSON de public.get_public_menu() (snake_case) → objeto de la app (camelCase). */
const publicMenuSchema = z
  .object({ unavailable_mode: z.enum(UNAVAILABLE_MODES), menus: z.array(menu) })
  .transform((d) => ({ unavailableMode: d.unavailable_mode, menus: d.menus }));

export type PublicMenuData = z.output<typeof publicMenuSchema>;
export type PublicMenu = PublicMenuData['menus'][number];
export type PublicSection = PublicMenu['sections'][number];
export type PublicItem = PublicSection['items'][number];
export type PublicDish = Extract<PublicItem, { kind: 'dish' }>['dish'];

/** null si el restaurante no está activo (o no existe). Lanza si la forma no es la esperada. */
export function parsePublicMenu(data: unknown): PublicMenuData | null {
  if (data === null || data === undefined) return null;
  return publicMenuSchema.parse(data);
}
