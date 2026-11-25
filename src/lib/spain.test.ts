import { describe, expect, it } from 'vitest';
import { formatPhone, isValidPhone, isValidPostalCode, isValidTaxId, normalizePhone, normalizeTaxId } from './spain';

describe('CIF, NIF y NIE', () => {
  it('acepta documentos con el control correcto', () => {
    for (const ok of ['12345678Z', 'X1234567L', 'Y1234567X', 'Z1234567R', 'B12345674', 'A28015865', 'Q1234567D', 'G12345674', 'G1234567D', 'K1234567L']) {
      expect(isValidTaxId(ok), ok).toBe(true);
    }
  });

  it('rechaza controles incorrectos y formatos raros', () => {
    for (const bad of ['12345678A', 'X1234567A', 'B12345675', 'B1234567D', 'Q12345674', '1234567Z', 'I12345674', '']) {
      expect(isValidTaxId(bad), bad).toBe(false);
    }
  });

  it('normaliza espacios, puntos, guiones y minúsculas', () => {
    expect(normalizeTaxId(' b-12.345.674 ')).toBe('B12345674');
    expect(isValidTaxId('12.345.678-z')).toBe(true);
  });
});

describe('código postal', () => {
  it('5 cifras con provincia 01–52', () => {
    expect(isValidPostalCode('28013')).toBe(true);
    expect(isValidPostalCode('07001')).toBe(true);
    expect(isValidPostalCode('52001')).toBe(true);
    for (const bad of ['00123', '53001', '2801', '280130', 'abcde']) expect(isValidPostalCode(bad), bad).toBe(false);
  });
});

describe('teléfono', () => {
  it('normaliza y valida', () => {
    expect(normalizePhone('910 00 00 00')).toBe('910000000');
    expect(normalizePhone('0034 (910) 000-000')).toBe('+34910000000');
    expect(isValidPhone('+34 600 11 22 33')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
  });

  it('formatea los números españoles de 9 cifras', () => {
    expect(formatPhone('910000000')).toBe('910 000 000');
    expect(formatPhone('+34600112233')).toBe('+34 600 112 233');
    expect(formatPhone('+4930123456')).toBe('+4930123456');
  });
});
