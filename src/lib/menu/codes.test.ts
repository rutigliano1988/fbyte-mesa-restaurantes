import { describe, expect, it } from 'vitest';
import {
  ALLERGEN_LABELS_ES,
  ALLERGENS,
  DISH_TAGS,
  isAllergen,
  isDishTag,
  isMenuKind,
  isPriceKind,
  isUnavailableMode,
  MAX_PRICE_CENTS,
  MENU_LIMITS,
  sortAllergens,
  sortTags,
  TAG_LABELS_ES,
  tagAllergenConflict,
} from './codes';

describe('códigos del menú', () => {
  it('14 alérgenos y 6 etiquetas con nombre en castellano, y los límites de la BD', () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(DISH_TAGS).toHaveLength(6);
    expect(Object.keys(ALLERGEN_LABELS_ES)).toEqual([...ALLERGENS]);
    expect(Object.keys(TAG_LABELS_ES)).toEqual([...DISH_TAGS]);
    expect(MENU_LIMITS).toEqual({ menus: 20, sections: 40, items: 100, dishes: 500, prices: 4 });
    expect(MAX_PRICE_CENTS).toBe(9_999_999);
  });

  it('las comprobaciones de tipo solo aceptan códigos conocidos', () => {
    expect(isAllergen('sulphites')).toBe(true);
    expect(isAllergen('pollen')).toBe(false);
    expect(isDishTag('gluten_free')).toBe(true);
    expect(isDishTag('halal')).toBe(false);
    expect(isMenuKind('daily')).toBe(true);
    expect(isMenuKind('brunch')).toBe(false);
    expect(isPriceKind('per_100g')).toBe(true);
    expect(isPriceKind(12)).toBe(false);
    expect(isUnavailableMode('hide')).toBe(true);
    expect(isUnavailableMode('blur')).toBe(false);
  });

  it('sortAllergens y sortTags quitan lo desconocido y los repetidos, en el orden de siempre', () => {
    expect(sortAllergens(['molluscs', 'gluten', 'pollen', 'gluten', 'milk'])).toEqual(['gluten', 'milk', 'molluscs']);
    expect(sortTags(['recommended', 'vegan', 'halal', 'vegan'])).toEqual(['vegan', 'recommended']);
  });

  it('tagAllergenConflict sigue la misma regla que la BD', () => {
    expect(tagAllergenConflict(['gluten_free'], ['gluten'])).toBe('Un plato con gluten no puede llevar la etiqueta «Sin gluten».');
    expect(tagAllergenConflict(['vegan'], ['soy', 'eggs'])).toBe('Un plato con huevos no puede llevar la etiqueta «Vegano».');
    expect(tagAllergenConflict(['vegan'], ['crustaceans'])).toBe('Un plato con crustáceos no puede llevar la etiqueta «Vegano».');
    expect(tagAllergenConflict(['vegan', 'gluten_free'], ['nuts', 'sesame'])).toBeNull();
    expect(tagAllergenConflict(['vegetarian'], ['milk', 'eggs'])).toBeNull();
  });
});
