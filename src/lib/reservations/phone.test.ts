import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay, normalizePhoneE164 } from './phone';

describe('normalizePhoneE164', () => {
  it.each([
    ['612 34 56 78', '+34612345678'],
    ['612-345-678', '+34612345678'],
    ['(91) 000 00 00', '+34910000000'],
    ['+34 612345678', '+34612345678'],
    ['0034 612 345 678', '+34612345678'],
    ['922 123 456', '+34922123456'],
    ['+44 20 7946 0958', '+442079460958'],
    ['0033 6 12 34 56 78', '+33612345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhoneE164(input)).toBe(expected);
  });

  it.each(['', '12', '12345', 'abc', '612 34 56 7x', '+34 12', '6123456789012345678901'])('%s no vale', (input) => {
    expect(normalizePhoneE164(input)).toBeNull();
  });
});

describe('formatPhoneDisplay', () => {
  it('los españoles sin prefijo; los extranjeros, con él', () => {
    expect(formatPhoneDisplay('+34612345678')).toBe('612 34 56 78');
    expect(formatPhoneDisplay('+442079460958')).toBe('+44 20 7946 0958');
  });

  it('si no se entiende, tal cual', () => {
    expect(formatPhoneDisplay('raro')).toBe('raro');
  });
});
