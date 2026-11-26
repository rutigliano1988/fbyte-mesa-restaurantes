import { describe, expect, it } from 'vitest';
import { ALLERGEN_LABELS_ES, ALLERGENS, DISH_TAGS, TAG_LABELS_ES } from '@/lib/menu/codes';
import { LOCALES } from './locales';
import { getMessages, MESSAGES, QR_CARD_TEXT } from './messages';

describe('mensajes de la mini-web', () => {
  it('hay mensajes para los seis idiomas, con siete días y sin textos vacíos', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      const m = getMessages(locale);
      expect(m.weekdays, locale).toHaveLength(7);
      for (const [key, value] of Object.entries(m)) {
        if (key === 'legalSpanishOnly' && locale === 'es') continue;
        if (typeof value === 'string') expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('los textos con datos los incluyen', () => {
    expect(getMessages('es').closedOn('24/12/2026', '26/12/2026')).toBe('Cerrado del 24/12/2026 al 26/12/2026');
    expect(getMessages('es').closedOn('24/12/2026', '24/12/2026')).toBe('Cerrado el 24/12/2026');
    expect(getMessages('en').specialOn('31/12/2026', '31/12/2026')).toBe('Special hours on 31/12/2026');
    expect(getMessages('ca').poweredBy('Mesa', 'FByte Solutions')).toBe('Reserves i carta amb Mesa · FByte Solutions');
    expect(getMessages('es').poweredBy('Mesa', 'FByte Solutions')).toBe('Reservas y menú con Mesa · FByte Solutions');
  });

  it('el pie en castellano coincide con el de la marca', async () => {
    const { BRAND } = await import('@/config/brand');
    expect(getMessages('es').poweredBy(BRAND.productName, BRAND.company)).toBe(BRAND.poweredBy);
  });
});

describe('mensajes de la carta', () => {
  it('los 14 alérgenos y las 6 etiquetas en los seis idiomas; en castellano, los mismos nombres que el panel', () => {
    for (const locale of LOCALES) {
      const m = getMessages(locale);
      expect(Object.keys(m.allergens), locale).toEqual([...ALLERGENS]);
      expect(Object.keys(m.tags), locale).toEqual([...DISH_TAGS]);
      for (const text of [...Object.values(m.allergens), ...Object.values(m.tags)]) expect(text.trim(), locale).not.toBe('');
      expect(m.filterHidden(0).trim(), locale).not.toBe('');
      expect(m.filterHidden(7), locale).toContain('7');
    }
    expect(getMessages('es').allergens).toEqual(ALLERGEN_LABELS_ES);
    expect(getMessages('es').tags).toEqual(TAG_LABELS_ES);
  });

  it('los textos fijos y los que llevan datos', () => {
    const es = getMessages('es');
    expect(es.viewMenu).toBe('Ver carta');
    expect(es.menuTitle('La Taberna')).toBe('Carta de La Taberna');
    expect(es.filterHidden(1)).toBe('Hay 1 plato oculto por tu filtro.');
    expect(es.filterHidden(3)).toBe('Hay 3 platos ocultos por tu filtro.');
    expect(es.vatIncluded).toBe('Precios con IVA incluido');
    expect(es.allergenDisclaimer).toBe(
      'Esta información es orientativa. Si tienes una alergia o intolerancia, confírmalo con el personal antes de pedir.',
    );
    expect(es.askStaffAllergens).toBe('Pregunta al personal por los alérgenos');
    expect(es.unavailable).toBe('Agotado');
    expect([es.marketPrice, es.perKg, es.per100g]).toEqual(['S/M', '/kg', '/100 g']);
    expect(getMessages('en').menuTitle('La Taberna')).toBe('La Taberna menu');
    expect(getMessages('de').filterHidden(2)).toBe('2 Gerichte durch Ihren Filter ausgeblendet.');
    expect(getMessages('ca').unavailable).toBe('Exhaurit');
    expect(QR_CARD_TEXT).toBe('Escanea para ver la carta · Scan to see the menu');
  });
});
