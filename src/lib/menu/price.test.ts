import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, formatDishPrice, parsePriceInput } from './price';

/** Los espacios del formato son duros (U+00A0): no se parten al final de línea. */
const nb = (s: string) => s.replace(/ /g, ' ');
const ES = { perKg: '/kg', per100g: '/100 g', market: 'S/M' };
const EN = { perKg: '/kg', per100g: '/100 g', market: 'Market price' };

describe('precios', () => {
  it('formatCents con el formato de cada idioma', () => {
    expect(formatCents(1250)).toBe(nb('12,50 €'));
    expect(formatCents(0, 'es')).toBe(nb('0,00 €'));
    expect(formatCents(123450, 'es')).toBe(nb('1234,50 €'));
    expect(formatCents(1234550, 'es')).toBe(nb('12.345,50 €'));
    for (const locale of ['ca', 'fr', 'de', 'it'] as const) expect(formatCents(1250, locale), locale).toBe(nb('12,50 €'));
    expect(formatCents(1250, 'en')).toBe('€12.50');
  });

  it('formatDishPrice: fijo, por kilo, por 100 g y según mercado', () => {
    expect(formatDishPrice({ kind: 'fixed', priceCents: 1250 }, 'es', ES)).toBe(nb('12,50 €'));
    expect(formatDishPrice({ kind: 'per_kg', priceCents: 4500 }, 'es', ES)).toBe(nb('45,00 €/kg'));
    expect(formatDishPrice({ kind: 'per_100g', priceCents: 600 }, 'es', ES)).toBe(nb('6,00 €/100 g'));
    expect(formatDishPrice({ kind: 'market', priceCents: null }, 'es', ES)).toBe('S/M');
    expect(formatDishPrice({ kind: 'per_kg', priceCents: 4500 }, 'en', EN)).toBe('€45.00/kg');
    expect(formatDishPrice({ kind: 'market', priceCents: null }, 'en', EN)).toBe('Market price');
  });

  it('parsePriceInput entiende cómo se escriben los precios en España', () => {
    expect(parsePriceInput('12,50')).toBe(1250);
    expect(parsePriceInput('12.5')).toBe(1250);
    expect(parsePriceInput('12')).toBe(1200);
    expect(parsePriceInput('0')).toBe(0);
    expect(parsePriceInput('0,29')).toBe(29);
    expect(parsePriceInput('1.250,00')).toBe(125000);
    expect(parsePriceInput('1.250')).toBe(125000);
    expect(parsePriceInput(' 12,50 € ')).toBe(1250);
    expect(parsePriceInput('99999,99')).toBe(9999999);
  });

  it('parsePriceInput rechaza lo que no es un importe válido', () => {
    for (const bad of ['', 'doce', '-1', '12,505', '100000', '1,2,3', '12.', '€']) expect(parsePriceInput(bad), bad).toBeNull();
  });

  it('centsToInput deja el importe listo para el formulario', () => {
    expect(centsToInput(1250)).toBe('12,50');
    expect(centsToInput(5)).toBe('0,05');
    expect(centsToInput(0)).toBe('0,00');
  });
});
