import { z } from 'zod';
import { sortLocales, type Locale } from '@/lib/i18n/locales';
import {
  MENU_KINDS,
  PRICE_KINDS,
  sortAllergens,
  sortTags,
  UNAVAILABLE_MODES,
  type Allergen,
  type DishTag,
  type PriceKind,
  type UnavailableMode,
} from './codes';
import { textFor, toI18nText, type I18nText } from './i18n-text';
import { formatDishPrice } from './price';
import type { MenuSchedule } from './schedule';

export type PanelDishPrice = { kind: PriceKind; priceCents: number | null; labels: I18nText };
export type PanelDish = {
  id: string;
  names: I18nText;
  descriptions: I18nText;
  photoPath: string | null;
  allergens: Allergen[];
  tags: DishTag[];
  unavailable: boolean;
  prices: PanelDishPrice[];
};
export type PanelItem = { id: string; position: number; dishId: string | null; inlineNames: I18nText | null; inlineAllergens: Allergen[] };
export type PanelSection = { id: string; names: I18nText; position: number; items: PanelItem[] };
export type PanelMenu = MenuSchedule & {
  id: string;
  names: I18nText;
  includes: I18nText;
  active: boolean;
  position: number;
  priceCents: number | null;
  sections: PanelSection[];
};
export type MenuTree = {
  enabledLocales: Locale[];
  unavailableMode: UnavailableMode;
  timezone: string;
  menus: PanelMenu[];
  dishes: PanelDish[];
};

const i18n = z.record(z.string(), z.unknown()).transform(toI18nText);
const int = z.number().int();

const treeSchema = z.object({
  enabled_locales: z.array(z.string()),
  unavailable_mode: z.enum(UNAVAILABLE_MODES),
  timezone: z.string(),
  menus: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(MENU_KINDS),
      names: i18n,
      includes: i18n,
      active: z.boolean(),
      position: int,
      price_cents: int.nullable(),
      weekdays: z.array(int).nullable(),
      start_minute: int.nullable(),
      end_minute: int.nullable(),
      date_from: z.string().nullable(),
      date_to: z.string().nullable(),
      sections: z.array(
        z.object({
          id: z.string(),
          names: i18n,
          position: int,
          items: z.array(
            z.object({
              id: z.string(),
              position: int,
              dish_id: z.string().nullable(),
              inline_names: i18n.nullable(),
              inline_allergens: z.array(z.string()),
            }),
          ),
        }),
      ),
    }),
  ),
  dishes: z.array(
    z.object({
      id: z.string(),
      names: i18n,
      descriptions: i18n,
      photo_path: z.string().nullable(),
      allergens: z.array(z.string()),
      tags: z.array(z.string()),
      unavailable: z.boolean(),
      prices: z.array(z.object({ kind: z.enum(PRICE_KINDS), price_cents: int.nullable(), labels: i18n })),
    }),
  ),
});

/** JSON de public.get_menu_tree() → objeto de la app. Lanza si la forma no es la esperada. */
export function parseMenuTree(data: unknown): MenuTree {
  const t = treeSchema.parse(data);
  return {
    enabledLocales: sortLocales(t.enabled_locales),
    unavailableMode: t.unavailable_mode,
    timezone: t.timezone,
    menus: t.menus.map((m) => ({
      id: m.id,
      kind: m.kind,
      names: m.names,
      includes: m.includes,
      active: m.active,
      position: m.position,
      priceCents: m.price_cents,
      weekdays: m.weekdays,
      startMinute: m.start_minute,
      endMinute: m.end_minute,
      dateFrom: m.date_from,
      dateTo: m.date_to,
      sections: m.sections.map((s) => ({
        id: s.id,
        names: s.names,
        position: s.position,
        items: s.items.map((i) => ({
          id: i.id,
          position: i.position,
          dishId: i.dish_id,
          inlineNames: i.inline_names,
          inlineAllergens: sortAllergens(i.inline_allergens),
        })),
      })),
    })),
    dishes: t.dishes.map((d) => ({
      id: d.id,
      names: d.names,
      descriptions: d.descriptions,
      photoPath: d.photo_path,
      allergens: sortAllergens(d.allergens),
      tags: sortTags(d.tags),
      unavailable: d.unavailable,
      prices: d.prices.map((p) => ({ kind: p.kind, priceCents: p.price_cents, labels: p.labels })),
    })),
  };
}

/** Nombre en castellano (el panel va en castellano). */
export function nameEs(names: I18nText | null | undefined): string {
  return textFor(names, 'es') ?? '';
}

/** Platos por orden alfabético (sin distinguir acentos ni mayúsculas). */
export function dishesByName(tree: MenuTree): PanelDish[] {
  return [...tree.dishes].sort((a, b) => nameEs(a.names).localeCompare(nameEs(b.names), 'es', { sensitivity: 'base' }));
}

/** Cartas en las que aparece un plato. */
export function menusWithDish(tree: MenuTree, dishId: string): PanelMenu[] {
  return tree.menus.filter((m) => m.sections.some((s) => s.items.some((i) => i.dishId === dishId)));
}

/** Platos que se pueden añadir a una carta: los que todavía no están en ella. */
export function dishesNotInMenu(tree: MenuTree, menuId: string): PanelDish[] {
  const menu = tree.menus.find((m) => m.id === menuId);
  const used = new Set(menu?.sections.flatMap((s) => s.items.map((i) => i.dishId)) ?? []);
  return dishesByName(tree).filter((d) => !used.has(d.id));
}

/** Pantalla de agotados: los platos de cada carta activa (sin repetir dentro de una carta) y, al final, el resto. */
export function unavailableGroups(tree: MenuTree): { id: string; title: string; dishes: PanelDish[] }[] {
  const byId = new Map(tree.dishes.map((d) => [d.id, d]));
  const placed = new Set<string>();
  const groups: { id: string; title: string; dishes: PanelDish[] }[] = [];
  for (const menu of tree.menus.filter((m) => m.active)) {
    const seen = new Set<string>();
    const dishes: PanelDish[] = [];
    for (const section of menu.sections) {
      for (const item of section.items) {
        const dish = item.dishId ? byId.get(item.dishId) : undefined;
        if (dish && !seen.has(dish.id)) {
          seen.add(dish.id);
          placed.add(dish.id);
          dishes.push(dish);
        }
      }
    }
    if (dishes.length > 0) groups.push({ id: menu.id, title: nameEs(menu.names), dishes });
  }
  const others = dishesByName(tree).filter((d) => !placed.has(d.id));
  if (others.length > 0) groups.push({ id: 'otros', title: 'Platos que no están en ninguna carta activa', dishes: others });
  return groups;
}

const UNITS_ES = { perKg: '/kg', per100g: '/100\u00a0g', market: 'S/M' };

/** '9,00 € (Media) · 15,00 € (Ración)', 'S/M' o 'Sin precio'. */
export function pricesSummaryEs(prices: PanelDishPrice[]): string {
  if (prices.length === 0) return 'Sin precio';
  return prices
    .map((p) => {
      const text = formatDishPrice(p, 'es', UNITS_ES);
      return p.labels.es ? `${text} (${p.labels.es})` : text;
    })
    .join(' · ');
}
