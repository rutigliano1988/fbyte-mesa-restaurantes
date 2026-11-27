import { describe, expect, it } from 'vitest';
import { blockRange } from './blocks';
import type { ServiceConfig } from './day';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
// Viernes 2030-06-14: comida 12:00–16:00 y cena 20:00–01:00.
const withLateDinner: ServiceConfig[] = [
  { name: 'Comida', weekday: 5, startMinute: 720, endMinute: 960, lastBookingMinute: null, slotIntervalMin: 15 },
  { name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1500, lastBookingMinute: null, slotIntervalMin: 15 },
];
const noLateDinner: ServiceConfig[] = [{ name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1380, lastBookingMinute: null, slotIntervalMin: 15 }];

describe('blockRange', () => {
  it('00:30–02:00 con cena que pasa de medianoche: empieza el día siguiente a las 00:30', () => {
    const r = blockRange({ timezone: TZ, services: withLateDinner, exceptions: [] }, '2030-06-14', 30, 120);
    expect(r.startMs).toBe(zonedTimeToUtc('2030-06-14', 1470, TZ));
    expect(r.endMs).toBe(zonedTimeToUtc('2030-06-15', 120, TZ));
  });

  it('sin cena que pase de medianoche, 12:00–14:00 queda en el mismo día', () => {
    const r = blockRange({ timezone: TZ, services: noLateDinner, exceptions: [] }, '2030-06-14', 720, 840);
    expect(r).toEqual({ startMs: zonedTimeToUtc('2030-06-14', 720, TZ), endMs: zonedTimeToUtc('2030-06-14', 840, TZ) });
  });

  it('sin cena que pase de medianoche, 00:30 sigue siendo del día', () => {
    const r = blockRange({ timezone: TZ, services: noLateDinner, exceptions: [] }, '2030-06-14', 30, 120);
    expect(r.startMs).toBe(zonedTimeToUtc('2030-06-14', 30, TZ));
  });

  it('un fin anterior al inicio sigue al día siguiente (23:00–01:00)', () => {
    const r = blockRange({ timezone: TZ, services: withLateDinner, exceptions: [] }, '2030-06-14', 1380, 1500);
    expect(r).toEqual({ startMs: zonedTimeToUtc('2030-06-14', 1380, TZ), endMs: zonedTimeToUtc('2030-06-14', 1500, TZ) });
  });

  it('«Todo el día» no cambia aunque haya cena que pase de medianoche', () => {
    const r = blockRange({ timezone: TZ, services: withLateDinner, exceptions: [] }, '2030-06-14', 0, 1440);
    expect(r).toEqual({ startMs: zonedTimeToUtc('2030-06-14', 0, TZ), endMs: zonedTimeToUtc('2030-06-14', 1440, TZ) });
  });
});
