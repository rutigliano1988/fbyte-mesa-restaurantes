import { describe, expect, it } from 'vitest';
import {
  currentServiceDate,
  effectiveLastBooking,
  groupByService,
  keepsStart,
  resolveMinute,
  serviceAt,
  serviceDateOf,
  servicesForDate,
  slotMinutes,
  startFor,
  startForEdit,
  summarize,
  type ServiceConfig,
  unassignedByTime,
} from './day';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
// Viernes 2030-06-14: comida 13:00–16:00 (última 15:00 por defecto) y cena 20:30–00:30 con última 23:30 cada 30.
const services: ServiceConfig[] = [
  { name: 'Comida', weekday: 5, startMinute: 780, endMinute: 960, lastBookingMinute: null, slotIntervalMin: 15 },
  { name: 'Cena', weekday: 5, startMinute: 1230, endMinute: 1470, lastBookingMinute: 1410, slotIntervalMin: 30 },
  { name: 'Cena', weekday: 4, startMinute: 1260, endMinute: 1500, lastBookingMinute: null, slotIntervalMin: 15 },
];

describe('servicios de una fecha', () => {
  it('los de su día de la semana, en orden', () => {
    expect(servicesForDate('2030-06-14', services, []).map((s) => [s.name, s.startMinute, s.lastBookingMinute, s.slotIntervalMin])).toEqual([
      ['Comida', 780, 900, 15],
      ['Cena', 1230, 1410, 30],
    ]);
  });

  it('un cierre los quita y un horario especial los sustituye (con los valores por defecto)', () => {
    const closed = [{ dateFrom: '2030-06-10', dateTo: '2030-06-16', kind: 'closed' as const, customServices: [] }];
    expect(servicesForDate('2030-06-14', services, closed)).toEqual([]);
    const custom = [{ dateFrom: '2030-06-14', dateTo: '2030-06-14', kind: 'custom' as const, customServices: [{ name: 'Gala', startMinute: 1260, endMinute: 1560 }] }];
    expect(servicesForDate('2030-06-14', services, custom)).toEqual([
      { key: '1260', name: 'Gala', startMinute: 1260, endMinute: 1560, lastBookingMinute: 1500, slotIntervalMin: 15 },
    ]);
  });

  it('la última hora por defecto no baja del inicio', () => {
    expect(effectiveLastBooking(780, 810, null)).toBe(780);
    expect(effectiveLastBooking(780, 960, 930)).toBe(930);
  });

  it('horas candidatas del inicio a la última, cada intervalo', () => {
    const [comida, cena] = servicesForDate('2030-06-14', services, []);
    expect(slotMinutes(comida)).toHaveLength(9);
    expect(slotMinutes(cena)).toEqual([1230, 1260, 1290, 1320, 1350, 1380, 1410]);
  });
});

describe('hora escrita y servicio que la contiene', () => {
  const today = servicesForDate('2030-06-14', services, []);

  it('00:15 en un día con cena hasta las 00:30 es de esa noche; 03:00, no', () => {
    expect(resolveMinute(15, today)).toBe(1455);
    expect(resolveMinute(180, today)).toBe(180);
    expect(resolveMinute(1300, today)).toBe(1300);
  });

  it('serviceAt: inicio incluido, fin excluido', () => {
    expect(serviceAt(780, today)?.name).toBe('Comida');
    expect(serviceAt(960, today)).toBeNull();
  });
});

describe('reparto de reservas por servicio', () => {
  const at = (date: string, minute: number) => ({ id: `${date}@${minute}`, startMs: zonedTimeToUtc(date, minute, TZ) });
  const today = servicesForDate('2030-06-14', services, []);
  const yesterday = servicesForDate('2030-06-13', services, []);

  it('cada una en su servicio; las de fuera, aparte; la madrugada siguiente cuenta para la cena', () => {
    const items = [at('2030-06-14', 800), at('2030-06-14', 1320), at('2030-06-15', 10), at('2030-06-14', 1000), at('2030-06-15', 200)];
    const { groups, outside } = groupByService(items, '2030-06-14', TZ, today, yesterday);
    expect(groups.map((g) => [g.service.name, g.items.map((i) => i.id)])).toEqual([
      ['Comida', ['2030-06-14@800']],
      ['Cena', ['2030-06-14@1320', '2030-06-15@10']],
    ]);
    expect(outside.map((i) => i.id)).toEqual(['2030-06-14@1000']);
  });

  it('la madrugada que es de la cena de la víspera no sale en este día', () => {
    const { groups, outside } = groupByService([at('2030-06-14', 30)], '2030-06-14', TZ, today, yesterday);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
    expect(outside).toEqual([]);
  });

  it('un día cerrado: todo sale fuera de horario', () => {
    const { groups, outside } = groupByService([at('2030-06-14', 800)], '2030-06-14', TZ, [], yesterday);
    expect(groups).toEqual([]);
    expect(outside).toHaveLength(1);
  });
});

it('resumen: reservas y personas sin canceladas ni no-shows, y pendientes', () => {
  expect(
    summarize([
      { status: 'confirmed', partySize: 2 },
      { status: 'pending', partySize: 4 },
      { status: 'completed', partySize: 3 },
      { status: 'no_show', partySize: 6 },
      { status: 'cancelled_customer', partySize: 2 },
    ]),
  ).toEqual({ reservations: 3, covers: 9, pending: 1 });
});

it('serviceDateOf: la madrugada de la cena de la víspera es de la víspera', () => {
  expect(serviceDateOf(zonedTimeToUtc('2030-06-14', 30, TZ), TZ, services, [])).toBe('2030-06-13');
  expect(serviceDateOf(zonedTimeToUtc('2030-06-15', 10, TZ), TZ, services, [])).toBe('2030-06-14');
  expect(serviceDateOf(zonedTimeToUtc('2030-06-15', 200, TZ), TZ, services, [])).toBe('2030-06-15');
  expect(serviceDateOf(zonedTimeToUtc('2030-06-14', 800, TZ), TZ, services, [])).toBe('2030-06-14');
});

it('«Sin mesa asignada»: las activas sin mesa, por hora de inicio (sin importar el servicio)', () => {
  const r = (id: string, startMs: number, status: 'confirmed' | 'cancelled_customer' | 'seated', tableIds: string[] = []) => ({ id, startMs, status, tableIds });
  const items = [r('cena', 3000, 'confirmed'), r('fuera', 500, 'seated'), r('comida', 1000, 'confirmed'), r('con-mesa', 200, 'confirmed', ['t1']), r('cancelada', 100, 'cancelled_customer')];
  expect(unassignedByTime(items).map((x) => x.id)).toEqual(['fuera', 'comida', 'cena']);
});

describe('«hoy» en el panel: el día de servicio de ahora', () => {
  // Sábado 2030-06-15: cena de 20:00 a 01:00 del domingo.
  const config = {
    timezone: TZ,
    services: [{ name: 'Cena', weekday: 6, startMinute: 1200, endMinute: 1500, lastBookingMinute: null, slotIntervalMin: 15 }],
    exceptions: [],
  };

  it('a las 00:30 del domingo sigue siendo el sábado (la cena aún no ha acabado)', () => {
    expect(currentServiceDate(config, zonedTimeToUtc('2030-06-16', 30, TZ))).toBe('2030-06-15');
  });

  it('a las 12:00 es hoy; y a las 01:00, ya acabada la cena, también', () => {
    expect(currentServiceDate(config, zonedTimeToUtc('2030-06-16', 720, TZ))).toBe('2030-06-16');
    expect(currentServiceDate(config, zonedTimeToUtc('2030-06-16', 60, TZ))).toBe('2030-06-16');
  });
});

describe('inicio al cambiar una reserva', () => {
  // Viernes 2030-06-14: cena 20:00–23:30. Sábado 2030-06-15: cena 20:00–01:30.
  const late: ServiceConfig[] = [
    { name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1410, lastBookingMinute: null, slotIntervalMin: 15 },
    { name: 'Cena', weekday: 6, startMinute: 1200, endMinute: 1530, lastBookingMinute: null, slotIntervalMin: 15 },
  ];
  const config = { timezone: TZ, services: late, exceptions: [] };
  const saturdayDawn = zonedTimeToUtc('2030-06-15', 30, TZ); // sábado 00:30 (walk-in o forzada): es del sábado

  it('startFor: la madrugada que cae en la cena de ese día que pasa de medianoche es de esa noche', () => {
    expect(startFor(config, '2030-06-15', 30)).toBe(zonedTimeToUtc('2030-06-16', 30, TZ));
    expect(startFor(config, '2030-06-14', 1290)).toBe(zonedTimeToUtc('2030-06-14', 1290, TZ));
  });

  it('keepsStart: mismo día de servicio y misma hora local', () => {
    expect(keepsStart(saturdayDawn, '2030-06-15', '2030-06-15', 30, TZ)).toBe(true);
    expect(keepsStart(saturdayDawn, '2030-06-15', '2030-06-15', 45, TZ)).toBe(false);
    expect(keepsStart(saturdayDawn, '2030-06-15', '2030-06-16', 30, TZ)).toBe(false);
  });

  it('startForEdit: si no cambian fecha ni hora (p. ej., solo notas), se queda en su instante, sin moverla 24 h', () => {
    expect(startForEdit(config, saturdayDawn, '2030-06-15', 30)).toBe(saturdayDawn);
    // Un walk-in a las 21:07:23 conserva hasta los segundos.
    const walkIn = zonedTimeToUtc('2030-06-14', 1267, TZ) + 23_000;
    expect(startForEdit(config, walkIn, '2030-06-14', 1267)).toBe(walkIn);
  });

  it('startForEdit: un cambio real de hora o de fecha (o sin instante actual) se calcula como siempre', () => {
    const friday = zonedTimeToUtc('2030-06-14', 1260, TZ);
    expect(startForEdit(config, friday, '2030-06-14', 1290)).toBe(zonedTimeToUtc('2030-06-14', 1290, TZ));
    expect(startForEdit(config, friday, '2030-06-15', 1260)).toBe(zonedTimeToUtc('2030-06-15', 1260, TZ));
    expect(startForEdit(config, saturdayDawn, '2030-06-15', 45)).toBe(zonedTimeToUtc('2030-06-16', 45, TZ));
    expect(startForEdit(config, null, '2030-06-15', 30)).toBe(zonedTimeToUtc('2030-06-16', 30, TZ));
  });
});
