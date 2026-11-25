import { describe, expect, it } from 'vitest';
import { LOCALES } from './locales';
import { getMessages, MESSAGES } from './messages';

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
