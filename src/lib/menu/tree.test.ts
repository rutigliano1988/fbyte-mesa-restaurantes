import { describe, expect, it } from 'vitest';
import { dishesByName, dishesNotInMenu, menusWithDish, parseMenuTree, pricesSummaryEs, unavailableGroups } from './tree';

const dish = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  names: { es: name },
  descriptions: {},
  photo_path: null,
  allergens: [],
  tags: [],
  unavailable: false,
  prices: [],
  ...extra,
});
const schedule = { price_cents: null, includes: {}, weekdays: null, start_minute: null, end_minute: null, date_from: null, date_to: null };

const TREE = {
  enabled_locales: ['en', 'es'],
  unavailable_mode: 'strike',
  timezone: 'Atlantic/Canary',
  menus: [
    {
      id: 'carta',
      kind: 'carta',
      names: { es: 'Carta' },
      active: true,
      position: 0,
      ...schedule,
      sections: [
        {
          id: 's1',
          names: { es: 'Entrantes' },
          position: 0,
          items: [
            { id: 'i1', position: 0, dish_id: 'croquetas', inline_names: null, inline_allergens: [] },
            { id: 'i2', position: 1, dish_id: 'ensalada', inline_names: null, inline_allergens: [] },
          ],
        },
        { id: 's2', names: { es: 'Postres' }, position: 1, items: [{ id: 'i3', position: 0, dish_id: 'flan', inline_names: null, inline_allergens: [] }] },
      ],
    },
    {
      id: 'daily',
      kind: 'daily',
      names: { es: 'Menú del día' },
      active: true,
      position: 1,
      ...schedule,
      price_cents: 1450,
      weekdays: [1, 2, 3, 4, 5],
      sections: [
        {
          id: 's3',
          names: { es: 'Primeros' },
          position: 0,
          items: [
            { id: 'i4', position: 0, dish_id: null, inline_names: { es: 'Sopa' }, inline_allergens: ['fish', 'celery'] },
            { id: 'i5', position: 1, dish_id: 'croquetas', inline_names: null, inline_allergens: [] },
          ],
        },
      ],
    },
    {
      id: 'vieja',
      kind: 'carta',
      names: { es: 'Carta de verano' },
      active: false,
      position: 2,
      ...schedule,
      sections: [{ id: 's4', names: { es: 'Fríos' }, position: 0, items: [{ id: 'i6', position: 0, dish_id: 'gazpacho', inline_names: null, inline_allergens: [] }] }],
    },
  ],
  dishes: [
    dish('ensalada', 'Ensalada', { tags: ['vegan', 'gluten_free'] }),
    dish('croquetas', 'Croquetas', {
      allergens: ['milk', 'gluten'],
      unavailable: true,
      prices: [
        { kind: 'fixed', price_cents: 900, labels: { es: 'Media' } },
        { kind: 'fixed', price_cents: 1500, labels: { es: 'Ración' } },
      ],
    }),
    dish('flan', 'Flan'),
    dish('gazpacho', 'Gazpacho'),
    dish('alioli', 'Alioli'),
  ],
};

describe('árbol del menú para el panel', () => {
  it('pasa el JSON de get_menu_tree a camelCase', () => {
    const t = parseMenuTree(TREE);
    expect([t.enabledLocales, t.unavailableMode, t.timezone]).toEqual([['es', 'en'], 'strike', 'Atlantic/Canary']);
    expect(t.menus[1]).toMatchObject({ id: 'daily', kind: 'daily', priceCents: 1450, weekdays: [1, 2, 3, 4, 5], startMinute: null, active: true });
    expect(t.menus[1].sections[0].items[0]).toEqual({ id: 'i4', position: 0, dishId: null, inlineNames: { es: 'Sopa' }, inlineAllergens: ['fish', 'celery'] });
    expect(t.dishes[1]).toMatchObject({ id: 'croquetas', allergens: ['gluten', 'milk'], unavailable: true, photoPath: null });
    expect(t.dishes[1].prices[0]).toEqual({ kind: 'fixed', priceCents: 900, labels: { es: 'Media' } });
  });

  it('platos por nombre, cartas donde está un plato y platos que se pueden añadir a una carta', () => {
    const t = parseMenuTree(TREE);
    expect(dishesByName(t).map((d) => d.id)).toEqual(['alioli', 'croquetas', 'ensalada', 'flan', 'gazpacho']);
    expect(menusWithDish(t, 'croquetas').map((m) => m.id)).toEqual(['carta', 'daily']);
    expect(menusWithDish(t, 'alioli')).toEqual([]);
    expect(dishesNotInMenu(t, 'carta').map((d) => d.id)).toEqual(['alioli', 'gazpacho']);
    expect(dishesNotInMenu(t, 'daily').map((d) => d.id)).toEqual(['alioli', 'ensalada', 'flan', 'gazpacho']);
  });

  it('agotados: los platos de cada carta activa, sin repetir, y al final los que no están en ninguna', () => {
    const groups = unavailableGroups(parseMenuTree(TREE));
    expect(groups.map((g) => [g.title, g.dishes.map((d) => d.id)])).toEqual([
      ['Carta', ['croquetas', 'ensalada', 'flan']],
      ['Menú del día', ['croquetas']],
      ['Platos que no están en ninguna carta activa', ['alioli', 'gazpacho']],
    ]);
  });

  it('pricesSummaryEs resume los precios para el panel', () => {
    const t = parseMenuTree(TREE);
    expect(pricesSummaryEs(t.dishes[1].prices)).toBe('9,00 € (Media) · 15,00 € (Ración)');
    expect(pricesSummaryEs([{ kind: 'market', priceCents: null, labels: {} }])).toBe('S/M');
    expect(pricesSummaryEs([{ kind: 'per_kg', priceCents: 4500, labels: {} }])).toBe('45,00 €/kg');
    expect(pricesSummaryEs([])).toBe('Sin precio');
  });
});
