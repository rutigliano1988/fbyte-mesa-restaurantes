import { describe, expect, it } from 'vitest';
import { SAMPLE_MENU_JSON } from './menu-fixtures';
import { parsePublicMenu } from './menu-schema';

describe('parsePublicMenu', () => {
  it('pasa el JSON de la BD a camelCase y ordena alérgenos y etiquetas', () => {
    const data = parsePublicMenu(SAMPLE_MENU_JSON);
    expect(data?.unavailableMode).toBe('strike');
    const carta = data!.menus[0];
    expect(carta).toMatchObject({ id: 'carta-1', kind: 'carta', priceCents: null, weekdays: null, startMinute: null, dateFrom: null });
    const first = carta.sections[0].items[0];
    expect(first.kind).toBe('dish');
    if (first.kind === 'dish') {
      expect(first.dish).toMatchObject({
        id: 'd-croquetas',
        photoPath: '11111111-1111-4111-8111-111111111111/dishes/croquetas.webp',
        allergens: ['gluten', 'milk'],
        tags: ['recommended'],
      });
      expect(first.dish.prices[0]).toEqual({ kind: 'fixed', priceCents: 900, labels: { es: 'Media', en: 'Half' } });
    }
    expect(carta.sections[0].items[1].kind === 'dish' && carta.sections[0].items[1].dish.tags).toEqual(['vegan', 'gluten_free']);
    const daily = data!.menus[1];
    expect(daily).toMatchObject({ kind: 'daily', priceCents: 1450, weekdays: [1, 2, 3, 4, 5], startMinute: 780, endMinute: 960 });
    expect(daily.sections[0].items[0]).toEqual({ id: 'i-sopa', kind: 'inline', names: { es: 'Sopa de pescado' }, allergens: ['fish', 'celery'] });
  });

  it('null si el restaurante no tiene carta pública; error si la forma no es la esperada', () => {
    expect(parsePublicMenu(null)).toBeNull();
    expect(parsePublicMenu(undefined)).toBeNull();
    expect(() => parsePublicMenu({ menus: 'nada' })).toThrow();
  });
});
