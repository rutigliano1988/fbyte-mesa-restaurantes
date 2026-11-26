import type { Locale } from '@/lib/i18n/locales';
import type { PublicMessages } from '@/lib/i18n/messages';
import type { Allergen, DishTag, MenuKind, UnavailableMode } from '@/lib/menu/codes';
import { textFor } from '@/lib/menu/i18n-text';
import { formatCents, formatDishPrice } from '@/lib/menu/price';
import { visibleMenus } from '@/lib/menu/schedule';
import type { PublicMenu, PublicMenuData } from './menu-schema';

export type MenuViewPrice = { label: string | null; text: string; market: boolean };
export type MenuViewItem = {
  id: string;
  name: string;
  description: string | null;
  prices: MenuViewPrice[];
  allergens: Allergen[];
  tags: DishTag[];
  photoUrl: string | null;
  photoAlt: string;
  enlargeLabel: string;
  unavailable: boolean;
};
export type MenuViewSection = { id: string; title: string; items: MenuViewItem[] };
/** Una carta lista para pintar. Todo es serializable: la recibe el componente cliente de la carta. */
export type MenuView = {
  id: string;
  kind: MenuKind;
  title: string;
  priceText: string | null;
  includes: string | null;
  sections: MenuViewSection[];
};

/**
 * Textos en el idioma (o en castellano si falta), precios con formato y agotados ocultos o marcados según el
 * ajuste del restaurante. Las secciones que se quedan sin platos no salen.
 */
export function buildMenuView(
  menu: PublicMenu,
  opts: { locale: Locale; unavailableMode: UnavailableMode; messages: PublicMessages; mediaUrl: (path: string) => string },
): MenuView {
  const { locale, messages: m } = opts;
  const units = { perKg: m.perKg, per100g: m.per100g, market: m.marketPrice };
  const sections = menu.sections
    .map((s) => ({
      id: s.id,
      title: textFor(s.names, locale) ?? '',
      items: s.items.flatMap((item): MenuViewItem[] => {
        if (item.kind === 'inline') {
          const name = textFor(item.names, locale) ?? '';
          return [
            {
              id: item.id,
              name,
              description: null,
              prices: [],
              allergens: item.allergens,
              tags: [],
              photoUrl: null,
              photoAlt: m.dishPhotoAlt(name),
              enlargeLabel: m.enlargePhoto(name),
              unavailable: false,
            },
          ];
        }
        const d = item.dish;
        if (d.unavailable && opts.unavailableMode === 'hide') return [];
        const name = textFor(d.names, locale) ?? '';
        return [
          {
            id: item.id,
            name,
            description: textFor(d.descriptions, locale),
            prices: d.prices.map((p) => ({ label: textFor(p.labels, locale), text: formatDishPrice(p, locale, units), market: p.kind === 'market' })),
            allergens: d.allergens,
            tags: d.tags,
            photoUrl: d.photoPath ? opts.mediaUrl(d.photoPath) : null,
            photoAlt: m.dishPhotoAlt(name),
            enlargeLabel: m.enlargePhoto(name),
            unavailable: d.unavailable,
          },
        ];
      }),
    }))
    .filter((s) => s.items.length > 0);
  return {
    id: menu.id,
    kind: menu.kind,
    title: textFor(menu.names, locale) ?? '',
    priceText: menu.priceCents === null ? null : formatCents(menu.priceCents, locale),
    includes: textFor(menu.includes, locale),
    sections,
  };
}

/** Cartas que se ven ahora y tienen algún plato, en el orden de las pestañas (menús del día y especiales primero). */
export function menusToShow(data: PublicMenuData | null, now: Date, timeZone: string): PublicMenu[] {
  if (!data) return [];
  return visibleMenus(data.menus, now, timeZone).filter((m) => m.sections.some((s) => s.items.length > 0));
}
