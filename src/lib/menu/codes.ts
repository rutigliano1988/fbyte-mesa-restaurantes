/** Los 14 alérgenos del Reglamento (UE) 1169/2011, anexo II, en el orden en que se muestran. Igual que la BD. */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DISH_TAGS = ['vegan', 'vegetarian', 'gluten_free', 'spicy', 'new', 'recommended'] as const;
export type DishTag = (typeof DISH_TAGS)[number];

export const MENU_KINDS = ['carta', 'daily', 'special'] as const;
export type MenuKind = (typeof MENU_KINDS)[number];

export const PRICE_KINDS = ['fixed', 'per_kg', 'per_100g', 'market'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export const UNAVAILABLE_MODES = ['hide', 'strike'] as const;
export type UnavailableMode = (typeof UNAVAILABLE_MODES)[number];

/** Igual que los triggers de la BD (limit_menu_rows, check_menu_item, check_dish_prices). */
export const MENU_LIMITS = { menus: 20, sections: 40, items: 100, dishes: 500, prices: 4 } as const;
/** 99 999,99 €. */
export const MAX_PRICE_CENTS = 9_999_999;

/** Nombres para el panel. Los de la carta pública salen de messages.ts (en castellano, los mismos). */
export const ALLERGEN_LABELS_ES: Record<Allergen, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustáceos',
  eggs: 'Huevos',
  fish: 'Pescado',
  peanuts: 'Cacahuetes',
  soy: 'Soja',
  milk: 'Leche',
  nuts: 'Frutos de cáscara',
  celery: 'Apio',
  mustard: 'Mostaza',
  sesame: 'Sésamo',
  sulphites: 'Sulfitos',
  lupin: 'Altramuces',
  molluscs: 'Moluscos',
};

export const TAG_LABELS_ES: Record<DishTag, string> = {
  vegan: 'Vegano',
  vegetarian: 'Vegetariano',
  gluten_free: 'Sin gluten',
  spicy: 'Picante',
  new: 'Novedad',
  recommended: 'Recomendado',
};

export const MENU_KIND_LABELS_ES: Record<MenuKind, string> = {
  carta: 'Carta',
  daily: 'Menú del día',
  special: 'Menú especial',
};

export const PRICE_KIND_LABELS_ES: Record<PriceKind, string> = {
  fixed: 'Precio fijo',
  per_kg: 'Por kilo (€/kg)',
  per_100g: 'Por 100 g (€/100 g)',
  market: 'Según mercado (S/M)',
};

/** Alérgenos que impiden la etiqueta «Vegano» (igual que dishes_tags_allergens_check). */
export const VEGAN_BLOCKERS: readonly Allergen[] = ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'];

function oneOf<T extends string>(list: readonly T[]) {
  return (value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
}

export const isAllergen = oneOf(ALLERGENS);
export const isDishTag = oneOf(DISH_TAGS);
export const isMenuKind = oneOf(MENU_KINDS);
export const isPriceKind = oneOf(PRICE_KINDS);
export const isUnavailableMode = oneOf(UNAVAILABLE_MODES);

/** Quita lo desconocido y los repetidos; orden de ALLERGENS. */
export function sortAllergens(values: readonly string[]): Allergen[] {
  return ALLERGENS.filter((a) => values.includes(a));
}

/** Quita lo desconocido y los repetidos; orden de DISH_TAGS. */
export function sortTags(values: readonly string[]): DishTag[] {
  return DISH_TAGS.filter((t) => values.includes(t));
}

/** La misma regla que la BD. null si se pueden combinar; si no, el mensaje para el panel. */
export function tagAllergenConflict(tags: readonly string[], allergens: readonly string[]): string | null {
  if (tags.includes('gluten_free') && allergens.includes('gluten')) {
    return 'Un plato con gluten no puede llevar la etiqueta «Sin gluten».';
  }
  if (tags.includes('vegan')) {
    const blocker = VEGAN_BLOCKERS.find((a) => allergens.includes(a));
    if (blocker) return `Un plato con ${ALLERGEN_LABELS_ES[blocker].toLowerCase()} no puede llevar la etiqueta «Vegano».`;
  }
  return null;
}
