import { describe, expect, it } from 'vitest';
import {
  blockFor,
  capacityOf,
  compareTablesForDisplay,
  freeTables,
  getAvailableSlots,
  isTableFree,
  proposeTable,
  type BlockSpan,
  type BookingTable,
  type Occupancy,
} from './availability';
import { servicesForDate, type ServiceConfig } from './day';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
const H = 3_600_000;

function table(id: string, max: number, o: Partial<BookingTable> = {}): BookingTable {
  return {
    id,
    zoneId: 'terraza',
    zoneName: 'Terraza',
    zonePosition: 0,
    name: id.toUpperCase(),
    minCapacity: 1,
    maxCapacity: max,
    onlineBookable: true,
    active: true,
    position: 0,
    ...o,
  };
}

const tables = [
  table('s2', 8, { zoneId: 'sala', zoneName: 'Sala', zonePosition: 1, minCapacity: 5 }),
  table('t2', 4, { position: 1, minCapacity: 2 }),
  table('s1', 4, { zoneId: 'sala', zoneName: 'Sala', zonePosition: 1, minCapacity: 2 }),
  table('t1', 2),
  table('off', 2, { active: false }),
];
const at = (date: string, minute: number) => zonedTimeToUtc(date, minute, TZ);
const night = at('2030-06-14', 21 * 60);

describe('mesa propuesta', () => {
  it('la más pequeña que sirve; a igualdad, la de la zona y la posición primeras', () => {
    expect(proposeTable(tables, 2, night, night + 1.5 * H, [], [])?.id).toBe('t1');
    expect(proposeTable(tables, 3, night, night + 1.5 * H, [], [])?.id).toBe('t2');
    expect(proposeTable(tables, 6, night, night + 1.5 * H, [], [])?.id).toBe('s2');
    expect(proposeTable(tables, 9, night, night + 1.5 * H, [], [])).toBeNull();
  });

  it('respeta la capacidad mínima: 4 personas no van a S2 (5–8)', () => {
    const occupied: Occupancy[] = ['t2', 's1'].map((id) => ({ reservationId: id, tableId: id, startMs: night, endMs: night + 2 * H }));
    expect(proposeTable(tables, 4, night, night + 1.5 * H, occupied, [])).toBeNull();
  });

  it('se salta las ocupadas y las bloqueadas; una reserva que acaba justo cuando empieza otra no molesta', () => {
    const occupied: Occupancy[] = [{ reservationId: 'r1', tableId: 't1', startMs: night - 1.5 * H, endMs: night + 0.5 * H }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, occupied, [])?.id).toBe('t2');
    const blocks: BlockSpan[] = [{ id: 'b', tableId: 't2', startMs: night, endMs: night + H, reason: null }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, occupied, blocks)?.id).toBe('s1');
    const touching: Occupancy[] = [{ reservationId: 'r1', tableId: 't1', startMs: night - 1.5 * H, endMs: night }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, touching, [])?.id).toBe('t1');
  });

  it('un bloqueo de todo el restaurante deja sin mesas', () => {
    const all: BlockSpan[] = [{ id: 'b', tableId: null, startMs: night - H, endMs: night + 3 * H, reason: 'Evento' }];
    expect(proposeTable(tables, 2, night, night + 1.5 * H, [], all)).toBeNull();
    expect(blockFor('s1', night, night + H, all)?.reason).toBe('Evento');
  });

  it('al modificar una reserva, su propia ocupación no cuenta', () => {
    const own: Occupancy[] = [{ reservationId: 'mine', tableId: 't1', startMs: night, endMs: night + 1.5 * H }];
    expect(isTableFree('t1', night + 0.5 * H, night + 2 * H, own, [])).toBe(false);
    expect(isTableFree('t1', night + 0.5 * H, night + 2 * H, own, [], 'mine')).toBe(true);
  });

  it('online: solo mesas reservables online, y de la zona elegida', () => {
    const list = [table('t1', 2, { onlineBookable: false }), ...tables.slice(0, 3)];
    expect(proposeTable(list, 2, night, night + H, [], [], { onlineOnly: true })?.id).toBe('t2');
    expect(proposeTable(list, 2, night, night + H, [], [], { zoneId: 'sala' })?.id).toBe('s1');
  });
});

describe('varias mesas', () => {
  it('libres ordenadas de menor a mayor, sin las desactivadas; capacidad sumada', () => {
    const free = freeTables(tables, night, night + H, [], []);
    expect(free.map((t) => t.id)).toEqual(['t1', 't2', 's1', 's2']);
    expect(capacityOf(free.filter((t) => t.id !== 's2'))).toBe(10);
  });

  it('orden para pintar: por zona y posición', () => {
    expect([...tables].sort(compareTablesForDisplay).map((t) => t.id)).toEqual(['off', 't1', 't2', 's1', 's2']);
  });
});

describe('getAvailableSlots', () => {
  const week: ServiceConfig[] = [
    { name: 'Comida', weekday: 5, startMinute: 780, endMinute: 900, lastBookingMinute: 840, slotIntervalMin: 30 },
    { name: 'Cena', weekday: 5, startMinute: 1320, endMinute: 1500, lastBookingMinute: 1440, slotIntervalMin: 30 },
  ];
  const services = servicesForDate('2030-06-14', week, []);
  const base = { date: '2030-06-14', timeZone: TZ, services, partySize: 2, durationMin: 90, tables: [table('t1', 2)], occupancy: [], blocks: [] };

  it('horas de cada servicio hasta la última, con la mesa propuesta, también pasada la medianoche', () => {
    const slots = getAvailableSlots(base);
    expect(slots.map((s) => [s.serviceName, s.minute])).toEqual([
      ['Comida', 780],
      ['Comida', 810],
      ['Comida', 840],
      ['Cena', 1320],
      ['Cena', 1350],
      ['Cena', 1380],
      ['Cena', 1410],
      ['Cena', 1440],
    ]);
    expect(new Date(slots.at(-1)!.startMs).toISOString()).toBe('2030-06-14T22:00:00.000Z');
    expect(slots.every((s) => s.table?.id === 't1')).toBe(true);
  });

  it('una reserva tapa las horas cuya duración se solapa con ella', () => {
    const occupancy: Occupancy[] = [{ reservationId: 'r', tableId: 't1', startMs: at('2030-06-14', 1380), endMs: at('2030-06-14', 1470) }];
    const free = getAvailableSlots({ ...base, occupancy }).filter((s) => s.serviceName === 'Cena').map((s) => [s.minute, s.table !== null]);
    expect(free).toEqual([
      [1320, false],
      [1350, false],
      [1380, false],
      [1410, false],
      [1440, false],
    ]);
    const shorter = getAvailableSlots({ ...base, occupancy, durationMin: 60 }).filter((s) => s.serviceName === 'Cena');
    expect(shorter.map((s) => [s.minute, s.table !== null])).toEqual([
      [1320, true],
      [1350, false],
      [1380, false],
      [1410, false],
      [1440, false],
    ]);
  });

  it('la antelación quita las horas de antes y de después de la ventana', () => {
    const slots = getAvailableSlots({ ...base, notBeforeMs: at('2030-06-14', 840), notAfterMs: at('2030-06-14', 1350) });
    expect(slots.map((s) => s.minute)).toEqual([840, 1320, 1350]);
  });

  it('en Canarias, la misma hora local es una hora más tarde en UTC', () => {
    const [slot] = getAvailableSlots({ ...base, timeZone: 'Atlantic/Canary' });
    expect(new Date(slot.startMs).toISOString()).toBe('2030-06-14T12:00:00.000Z');
  });

  it('el día del cambio de hora, las horas siguen siendo las del reloj del restaurante', () => {
    const sunday: ServiceConfig[] = [{ name: 'Comida', weekday: 7, startMinute: 780, endMinute: 900, lastBookingMinute: 840, slotIntervalMin: 30 }];
    const slots = getAvailableSlots({ ...base, date: '2026-03-29', services: servicesForDate('2026-03-29', sunday, []) });
    expect(slots.map((s) => new Date(s.startMs).toISOString())).toEqual([
      '2026-03-29T11:00:00.000Z',
      '2026-03-29T11:30:00.000Z',
      '2026-03-29T12:00:00.000Z',
    ]);
  });

  it('la noche del adelanto de hora no salen las horas que no existen (ni duplicadas)', () => {
    const saturday: ServiceConfig[] = [{ name: 'Copas', weekday: 6, startMinute: 1380, endMinute: 1680, lastBookingMinute: 1620, slotIntervalMin: 30 }];
    const night = { ...base, date: '2026-03-28', services: servicesForDate('2026-03-28', saturday, []), durationMin: 60 };
    const madrid = getAvailableSlots(night);
    // 02:00 y 02:30 no existen en Madrid (a las 02:00 pasa a ser las 03:00).
    expect(madrid.map((s) => s.minute)).toEqual([1380, 1410, 1440, 1470, 1500, 1530, 1620]);
    expect(new Set(madrid.map((s) => s.startMs)).size).toBe(madrid.length);
    expect(new Date(madrid.at(-1)!.startMs).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // En Canarias el salto es a la 01:00: no existen ni la 01:00 ni la 01:30.
    const canary = getAvailableSlots({ ...night, timeZone: 'Atlantic/Canary' });
    expect(canary.map((s) => s.minute)).toEqual([1380, 1410, 1440, 1470, 1560, 1590, 1620]);
    expect(new Set(canary.map((s) => s.startMs)).size).toBe(canary.length);
    expect(new Date(canary.find((s) => s.minute === 1560)!.startMs).toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });
});
