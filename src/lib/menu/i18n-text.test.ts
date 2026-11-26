import { describe, expect, it } from 'vitest';
import { i18nFromForm, localeKeys, missingLocales, textFor, toI18nText } from './i18n-text';

describe('textos por idioma', () => {
  it('textFor usa el idioma pedido y, si falta, el castellano', () => {
    const names = { es: 'Croquetas', en: 'Croquettes' };
    expect(textFor(names, 'en')).toBe('Croquettes');
    expect(textFor(names, 'de')).toBe('Croquetas');
    expect(textFor({ es: 'Croquetas', en: '  ' }, 'en')).toBe('Croquetas');
    expect(textFor({}, 'es')).toBeNull();
    expect(textFor(null, 'ca')).toBeNull();
  });

  it('missingLocales dice qué idiomas activos no tienen traducción', () => {
    expect(missingLocales({ es: 'Croquetas', ca: 'Croquetes' }, ['es', 'en', 'ca'])).toEqual(['en']);
    expect(missingLocales(undefined, ['es'])).toEqual(['es']);
  });

  it('campos de formulario por idioma ↔ texto por idioma', () => {
    expect(localeKeys('name')).toEqual(['name_es', 'name_en', 'name_ca', 'name_fr', 'name_de', 'name_it']);
    expect(i18nFromForm({ name_es: ' Croquetas ', name_en: '', name_xx: 'Nope', name_de: 'Kroketten' }, 'name')).toEqual({
      es: 'Croquetas',
      de: 'Kroketten',
    });
    expect(toI18nText({ es: 'Pan', en: 3, xx: 'No', fr: ' ' })).toEqual({ es: 'Pan' });
    expect(toI18nText(null)).toEqual({});
    expect(toI18nText(['es'])).toEqual({});
  });
});
