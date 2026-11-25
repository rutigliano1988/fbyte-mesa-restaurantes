import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  findOverlap,
  formatDateEs,
  formatRange,
  groupByWeekday,
  minutesToTime,
  timeToMinutes,
  todayInTimeZone,
  toServiceRange,
  upcomingExceptions,
  type ServiceSlot,
} from './schedule';

describe('minutos ↔ HH:MM', () => {
  it('convierte en los dos sentidos', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(785)).toBe('13:05');
    expect(minutesToTime(1439)).toBe('23:59');
    expect(timeToMinutes('13:05')).toBe(785);
    expect(timeToMinutes(' 00:00 ')).toBe(0);
  });

  it('pasada la medianoche muestra la hora del día siguiente', () => {
    expect(minutesToTime(1440)).toBe('00:00');
    expect(minutesToTime(1470)).toBe('00:30');
    expect(minutesToTime(1800)).toBe('06:00');
  });

  it('rechaza horas mal escritas', () => {
    for (const bad of ['24:00', '9:30', '12:60', 'mediodía', '']) expect(timeToMinutes(bad)).toBeNull();
  });
});

describe('toServiceRange', () => {
  it('un servicio normal', () => {
    expect(toServiceRange('13:00', '16:00')).toEqual({ startMinute: 780, endMinute: 960 });
  });

  it('una cena que acaba después de medianoche', () => {
    expect(toServiceRange('20:00', '00:30')).toEqual({ startMinute: 1200, endMinute: 1470 });
    expect(toServiceRange('22:00', '06:00')).toEqual({ startMinute: 1320, endMinute: 1800 });
  });

  it('rechaza horas iguales, finales después de las 06:00 y horas mal escritas', () => {
    expect(toServiceRange('13:00', '13:00')).toBeNull();
    expect(toServiceRange('22:00', '06:30')).toBeNull();
    expect(toServiceRange('13', '16:00')).toBeNull();
  });

  it('formatRange lo muestra con guion', () => {
    expect(formatRange(1200, 1470)).toBe('20:00–00:30');
  });
});

describe('findOverlap', () => {
  const comida: ServiceSlot = { id: 'a', name: 'Comida', weekday: 1, startMinute: 780, endMinute: 960 };

  it('detecta solapes el mismo día y permite que se toquen', () => {
    expect(findOverlap([comida], { name: 'X', weekday: 1, startMinute: 900, endMinute: 1000 })).toBe(comida);
    expect(findOverlap([comida], { name: 'X', weekday: 1, startMinute: 960, endMinute: 1000 })).toBeNull();
    expect(findOverlap([comida], { name: 'X', weekday: 2, startMinute: 780, endMinute: 960 })).toBeNull();
  });

  it('una cena que pasa de medianoche choca con un servicio de madrugada del día siguiente', () => {
    const cena: ServiceSlot = { name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1530 };
    expect(findOverlap([cena], { name: 'Madrugada', weekday: 6, startMinute: 0, endMinute: 120 })).toBe(cena);
    expect(findOverlap([cena], { name: 'Desayuno', weekday: 6, startMinute: 90, endMinute: 200 })).toBeNull();
  });

  it('el domingo por la noche choca con el lunes de madrugada', () => {
    const domingo: ServiceSlot = { name: 'Cena', weekday: 7, startMinute: 1380, endMinute: 1500 };
    expect(findOverlap([domingo], { name: 'X', weekday: 1, startMinute: 0, endMinute: 30 })).toBe(domingo);
  });

  it('al editar, no se compara consigo mismo', () => {
    expect(findOverlap([comida], { ...comida, endMinute: 990 })).toBeNull();
  });
});

describe('agrupar y fechas', () => {
  it('groupByWeekday ordena por hora', () => {
    const g = groupByWeekday([
      { weekday: 1, startMinute: 1200 },
      { weekday: 1, startMinute: 780 },
      { weekday: 3, startMinute: 600 },
    ]);
    expect(g[1].map((s) => s.startMinute)).toEqual([780, 1200]);
    expect(g[3]).toHaveLength(1);
    expect(g[7]).toEqual([]);
  });

  it('todayInTimeZone usa la zona del restaurante', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(todayInTimeZone('Europe/Madrid', now)).toBe('2027-01-01');
    expect(todayInTimeZone('Atlantic/Canary', now)).toBe('2026-12-31');
  });

  it('formatDateEs y daysBetween', () => {
    expect(formatDateEs('2026-12-24')).toBe('24/12/2026');
    expect(daysBetween('2026-12-24', '2026-12-26')).toBe(2);
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2);
  });

  it('upcomingExceptions quita lo pasado y ordena', () => {
    const list = [
      { dateFrom: '2026-12-31', dateTo: '2026-12-31' },
      { dateFrom: '2026-11-01', dateTo: '2026-11-02' },
      { dateFrom: '2026-11-24', dateTo: '2026-11-26' },
    ];
    expect(upcomingExceptions(list, '2026-11-25').map((e) => e.dateFrom)).toEqual(['2026-11-24', '2026-12-31']);
  });
});
