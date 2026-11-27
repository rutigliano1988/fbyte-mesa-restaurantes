import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOKING_SETTINGS, DURATION_OPTIONS, durationFor, formatDuration, overlappingRules } from './settings';

const settings = {
  defaultDurationMin: 90,
  durationRules: [
    { minParty: 1, maxParty: 2, durationMin: 75 },
    { minParty: 7, maxParty: 50, durationMin: 150 },
  ],
};

describe('duración por tamaño de grupo', () => {
  it('la del tramo que contiene el grupo, con los extremos incluidos', () => {
    expect(durationFor(1, settings)).toBe(75);
    expect(durationFor(2, settings)).toBe(75);
    expect(durationFor(7, settings)).toBe(150);
    expect(durationFor(50, settings)).toBe(150);
  });

  it('si ningún tramo lo contiene, la de por defecto', () => {
    expect(durationFor(4, settings)).toBe(90);
    expect(durationFor(4, DEFAULT_BOOKING_SETTINGS)).toBe(90);
  });

  it('detecta tramos solapados', () => {
    expect(overlappingRules(settings.durationRules)).toBeNull();
    expect(overlappingRules([...settings.durationRules, { minParty: 2, maxParty: 4, durationMin: 90 }])).toEqual([0, 2]);
  });
});

it('opciones de duración de 30 min a 6 h y formato corto', () => {
  expect(DURATION_OPTIONS[0]).toBe(30);
  expect(DURATION_OPTIONS.at(-1)).toBe(360);
  expect(formatDuration(90)).toBe('1 h 30 min');
  expect(formatDuration(120)).toBe('2 h');
  expect(formatDuration(45)).toBe('45 min');
});
