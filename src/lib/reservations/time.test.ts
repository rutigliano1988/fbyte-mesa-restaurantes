import { describe, expect, it } from 'vitest';
import { addDays, dateParam, formatDayEs, formatTime, localParts, serviceDayMinute, serviceDayWindow, weekdayOf, zonedTimeToUtc } from './time';

const iso = (ms: number) => new Date(ms).toISOString();

describe('fechas', () => {
  it('addDays cruza meses, años y años bisiestos', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('weekdayOf: 1 = lunes … 7 = domingo', () => {
    expect(weekdayOf('2026-11-23')).toBe(1);
    expect(weekdayOf('2026-11-29')).toBe(7);
  });

  it('formatDayEs', () => {
    expect(formatDayEs('2030-06-14')).toBe('Viernes 14/06/2030');
  });
});

describe('zonedTimeToUtc', () => {
  it('Madrid en invierno (+1) y en verano (+2); Canarias una hora menos', () => {
    expect(iso(zonedTimeToUtc('2026-11-27', 21 * 60, 'Europe/Madrid'))).toBe('2026-11-27T20:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-10', 21 * 60, 'Europe/Madrid'))).toBe('2026-07-10T19:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-10', 21 * 60, 'Atlantic/Canary'))).toBe('2026-07-10T20:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-11-27', 21 * 60, 'Atlantic/Canary'))).toBe('2026-11-27T21:00:00.000Z');
  });

  it('pasada la medianoche (minuto 1470) es del día siguiente', () => {
    expect(iso(zonedTimeToUtc('2026-12-31', 1470, 'Europe/Madrid'))).toBe('2026-12-31T23:30:00.000Z');
  });

  it('cambio de hora: la que no existe y la que existe dos veces, como PostgreSQL', () => {
    expect(iso(zonedTimeToUtc('2026-03-29', 150, 'Europe/Madrid'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-10-25', 150, 'Europe/Madrid'))).toBe('2026-10-25T01:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', 13 * 60, 'Europe/Madrid'))).toBe('2026-03-29T11:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', 13 * 60, 'Atlantic/Canary'))).toBe('2026-03-29T12:00:00.000Z');
  });
});

describe('hora local de un instante', () => {
  it('localParts y formatTime', () => {
    const ms = Date.parse('2026-07-10T19:15:00Z');
    expect(localParts(ms, 'Europe/Madrid')).toEqual({ date: '2026-07-10', minute: 21 * 60 + 15 });
    expect(formatTime(ms, 'Atlantic/Canary')).toBe('20:15');
  });

  it('serviceDayMinute: la madrugada sigue contando para el día anterior', () => {
    const late = Date.parse('2026-12-31T23:30:00Z');
    expect(serviceDayMinute(late, '2026-12-31', 'Europe/Madrid')).toBe(1470);
    expect(serviceDayMinute(late, '2027-01-01', 'Europe/Madrid')).toBe(30);
    expect(serviceDayMinute(late, '2026-12-29', 'Europe/Madrid')).toBeNull();
  });

  it('serviceDayWindow va de las 00:00 a las 06:00 del día siguiente, también el día del cambio de hora', () => {
    const w = serviceDayWindow('2026-10-25', 'Europe/Madrid');
    expect(iso(w.from)).toBe('2026-10-24T22:00:00.000Z');
    expect(iso(w.to)).toBe('2026-10-26T05:00:00.000Z');
  });
});

it('dateParam: solo fechas reales; si no, la de por defecto', () => {
  expect(dateParam('2030-06-14', '2026-11-27')).toBe('2030-06-14');
  for (const bad of ['2030-02-30', '14/06/2030', '', undefined, ['2030-06-14', '2030-06-15']]) {
    expect(dateParam(bad, '2026-11-27')).toBe('2026-11-27');
  }
});
