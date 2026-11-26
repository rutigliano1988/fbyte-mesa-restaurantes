import { describe, expect, it } from 'vitest';
import { isMenuVisibleAt, localMoment, scheduleSummaryEs, visibleMenus, weekdaysSummaryEs, type MenuSchedule } from './schedule';

const MADRID = 'Europe/Madrid';
const CANARY = 'Atlantic/Canary';
const at = (iso: string) => new Date(iso);

function daily(over: Partial<MenuSchedule> = {}): MenuSchedule {
  return { kind: 'daily', weekdays: [1, 2, 3, 4, 5], startMinute: 780, endMinute: 960, dateFrom: null, dateTo: null, ...over };
}

describe('localMoment', () => {
  it('fecha, día y minuto en la zona del restaurante, con el cambio de hora', () => {
    expect(localMoment(at('2026-11-30T12:30:00Z'), MADRID)).toEqual({ date: '2026-11-30', weekday: 1, minute: 810 });
    expect(localMoment(at('2026-11-30T12:30:00Z'), CANARY)).toEqual({ date: '2026-11-30', weekday: 1, minute: 750 });
    expect(localMoment(at('2026-07-01T12:30:00Z'), MADRID)).toEqual({ date: '2026-07-01', weekday: 3, minute: 870 });
    expect(localMoment(at('2026-03-29T01:30:00Z'), MADRID)).toEqual({ date: '2026-03-29', weekday: 7, minute: 210 });
    expect(localMoment(at('2026-11-30T23:30:00Z'), MADRID)).toEqual({ date: '2026-12-01', weekday: 2, minute: 30 });
    expect(localMoment(at('2026-11-30T23:30:00Z'), CANARY)).toEqual({ date: '2026-11-30', weekday: 1, minute: 1410 });
  });
});

describe('isMenuVisibleAt', () => {
  it('la carta siempre se ve', () => {
    const carta: MenuSchedule = { kind: 'carta', weekdays: null, startMinute: null, endMinute: null, dateFrom: null, dateTo: null };
    expect(isMenuVisibleAt(carta, at('2026-12-05T03:00:00Z'), MADRID)).toBe(true);
  });

  it('menú del día de lunes a viernes de 13:00 a 16:00 (la hora de fin ya no cuenta)', () => {
    const m = daily();
    expect(isMenuVisibleAt(m, at('2026-11-30T12:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-11-30T12:00:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-11-30T11:59:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-11-30T15:00:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-12-05T12:30:00Z'), MADRID)).toBe(false);
  });

  it('sin franja, todo el día de los días marcados', () => {
    const m = daily({ weekdays: [6, 7], startMinute: null, endMinute: null });
    expect(isMenuVisibleAt(m, at('2026-12-05T08:00:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-12-06T22:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-12-06T23:30:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-11-30T12:00:00Z'), MADRID)).toBe(false);
  });

  it('una franja que pasa de medianoche cuenta para el día en que empieza', () => {
    const m = daily({ weekdays: [5], startMinute: 1200, endMinute: 1560 });
    expect(isMenuVisibleAt(m, at('2026-12-04T22:00:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-12-05T00:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-12-05T01:30:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-12-04T00:30:00Z'), MADRID)).toBe(false);
  });

  it('fechas: el especial solo dentro de su rango, y la madrugada del último día cuenta para ese día', () => {
    const m: MenuSchedule = {
      kind: 'special',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startMinute: 1200,
      endMinute: 1500,
      dateFrom: '2026-12-24',
      dateTo: '2026-12-24',
    };
    expect(isMenuVisibleAt(m, at('2026-12-24T22:00:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-12-24T23:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-12-25T21:00:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-12-23T22:00:00Z'), MADRID)).toBe(false);
    const allDay = { ...m, startMinute: null, endMinute: null };
    expect(isMenuVisibleAt(allDay, at('2026-12-24T08:00:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(allDay, at('2026-12-24T23:30:00Z'), MADRID)).toBe(false);
  });

  it('en Canarias va una hora por detrás', () => {
    const m = daily({ weekdays: [1] });
    expect(isMenuVisibleAt(m, at('2026-11-30T15:30:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-11-30T15:30:00Z'), CANARY)).toBe(true);
  });

  it('con el cambio de hora la franja sigue en hora local', () => {
    const m = daily({ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 780, endMinute: 840 });
    expect(isMenuVisibleAt(m, at('2026-03-28T12:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-03-29T12:30:00Z'), MADRID)).toBe(false);
    expect(isMenuVisibleAt(m, at('2026-03-29T11:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-10-25T12:30:00Z'), MADRID)).toBe(true);
    expect(isMenuVisibleAt(m, at('2026-10-25T12:30:00Z'), CANARY)).toBe(false);
  });
});

describe('visibleMenus', () => {
  it('primero los menús del día y especiales que se ven; después las cartas, cada grupo en su orden', () => {
    const carta = (id: string) => ({ id, kind: 'carta' as const, weekdays: null, startMinute: null, endMinute: null, dateFrom: null, dateTo: null });
    const menus = [
      carta('A'),
      { id: 'B', ...daily({ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: null, endMinute: null }) },
      carta('C'),
      { id: 'D', ...daily({ kind: 'special', dateFrom: '2020-01-01', dateTo: '2020-01-01' }) },
    ];
    expect(visibleMenus(menus, at('2026-11-30T12:30:00Z'), MADRID).map((m) => m.id)).toEqual(['B', 'A', 'C']);
  });
});

describe('resúmenes para el panel', () => {
  it('weekdaysSummaryEs y scheduleSummaryEs', () => {
    expect(weekdaysSummaryEs([1, 2, 3, 4, 5])).toBe('De lunes a viernes');
    expect(weekdaysSummaryEs([5, 1, 2, 3, 4, 4])).toBe('De lunes a viernes');
    expect(weekdaysSummaryEs([6, 7])).toBe('Sábado y domingo');
    expect(weekdaysSummaryEs([1, 3, 5])).toBe('Lunes, miércoles y viernes');
    expect(weekdaysSummaryEs([3])).toBe('Miércoles');
    expect(weekdaysSummaryEs([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días');
    expect(weekdaysSummaryEs([])).toBe('Ningún día');
    expect(scheduleSummaryEs({ kind: 'carta', weekdays: null, startMinute: null, endMinute: null, dateFrom: null, dateTo: null })).toBe(
      'Siempre visible',
    );
    expect(scheduleSummaryEs(daily())).toBe('De lunes a viernes · 13:00–16:00');
    expect(scheduleSummaryEs(daily({ weekdays: [5], startMinute: 1200, endMinute: 1560 }))).toBe('Viernes · 20:00–02:00');
    expect(
      scheduleSummaryEs({ kind: 'special', weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: null, endMinute: null, dateFrom: '2026-12-24', dateTo: '2026-12-26' }),
    ).toBe('Todos los días · Todo el día · Del 24/12/2026 al 26/12/2026');
    expect(scheduleSummaryEs(daily({ dateFrom: '2026-12-31', dateTo: '2026-12-31' }))).toBe('De lunes a viernes · 13:00–16:00 · El 31/12/2026');
  });
});
