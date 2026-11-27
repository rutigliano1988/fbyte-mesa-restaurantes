import { describe, expect, it } from 'vitest';
import { parseBookingDay, toBookingSettings, toBookingTables, toExceptionConfigs, toServiceConfigs } from './rows';
import { DEFAULT_BOOKING_SETTINGS } from './settings';

const day = {
  reservations: [
    {
      id: 'r1',
      starts_at: '2030-06-14T19:00:00+00:00',
      ends_at: '2030-06-14T20:30:00+00:00',
      party_size: 4,
      status: 'confirmed',
      previous_status: null,
      source: 'phone',
      notes: 'Trona',
      internal_notes: null,
      created_at: '2030-06-01T10:00:00+00:00',
      table_ids: ['t1'],
      customer: { id: 'c1', name: 'Ana', phone: '+34612345678', email: null, tags: ['vip', 'raro'], visits_count: 3, no_show_count: 1, cancel_count: 0 },
    },
  ],
  occupancy: [{ reservation_id: 'r1', table_id: 't1', starts_at: '2030-06-14T19:00:00+00:00', ends_at: '2030-06-14T20:30:00+00:00' }],
  blocks: [{ id: 'b1', table_id: null, starts_at: '2030-06-14T12:00:00+00:00', ends_at: '2030-06-14T15:00:00+00:00', reason: null }],
};

describe('parseBookingDay', () => {
  it('pasa el JSON de la BD a objetos con instantes en ms', () => {
    const d = parseBookingDay(day);
    expect(d.reservations[0]).toEqual({
      id: 'r1',
      startMs: Date.parse('2030-06-14T19:00:00Z'),
      endMs: Date.parse('2030-06-14T20:30:00Z'),
      partySize: 4,
      status: 'confirmed',
      previousStatus: null,
      source: 'phone',
      notes: 'Trona',
      internalNotes: null,
      tableIds: ['t1'],
      customer: { id: 'c1', name: 'Ana', phone: '+34612345678', email: null, tags: ['vip'], visitsCount: 3, noShowCount: 1, cancelCount: 0 },
    });
    expect(d.occupancy).toEqual([{ reservationId: 'r1', tableId: 't1', startMs: Date.parse('2030-06-14T19:00:00Z'), endMs: Date.parse('2030-06-14T20:30:00Z') }]);
    expect(d.blocks[0]).toMatchObject({ id: 'b1', tableId: null, reason: null });
  });

  it('lanza si falta algo o un estado no existe', () => {
    expect(() => parseBookingDay({ ...day, blocks: undefined })).toThrow();
    expect(() => parseBookingDay({ ...day, reservations: [{ ...day.reservations[0], status: 'perdida' }] })).toThrow();
    expect(() => parseBookingDay({ ...day, occupancy: [{ ...day.occupancy[0], starts_at: 'ayer' }] })).toThrow();
  });
});

describe('filas de configuración', () => {
  it('mesas con su zona; sin zona, fuera', () => {
    const tables = toBookingTables(
      [{ id: 'z1', name: 'Terraza', position: 2 }],
      [
        { id: 't1', zone_id: 'z1', name: 'T1', min_capacity: 1, max_capacity: 2, online_bookable: true, active: true, position: 0 },
        { id: 't2', zone_id: 'zx', name: 'T2', min_capacity: 1, max_capacity: 2, online_bookable: true, active: true, position: 1 },
      ],
    );
    expect(tables).toEqual([
      { id: 't1', zoneId: 'z1', zoneName: 'Terraza', zonePosition: 2, name: 'T1', minCapacity: 1, maxCapacity: 2, onlineBookable: true, active: true, position: 0 },
    ]);
  });

  it('ajustes: sin fila, los de por defecto; con fila, sus valores y tramos', () => {
    expect(toBookingSettings(null)).toEqual(DEFAULT_BOOKING_SETTINGS);
    expect(
      toBookingSettings({
        default_duration_min: 105,
        duration_rules: [{ min_party: 1, max_party: 2, duration_min: 60 }],
        min_advance_min: 0,
        max_advance_days: 30,
        max_online_party: 6,
        cancel_limit_hours: 24,
        auto_confirm: false,
      }),
    ).toEqual({
      defaultDurationMin: 105,
      durationRules: [{ minParty: 1, maxParty: 2, durationMin: 60 }],
      minAdvanceMin: 0,
      maxAdvanceDays: 30,
      maxOnlineParty: 6,
      cancelLimitHours: 24,
      autoConfirm: false,
    });
  });

  it('servicios y excepciones', () => {
    expect(toServiceConfigs([{ id: 's', name: 'Cena', weekday: 5, start_minute: 1200, end_minute: 1440, last_booking_minute: null, slot_interval_min: 30 }])).toEqual([
      { id: 's', name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1440, lastBookingMinute: null, slotIntervalMin: 30 },
    ]);
    expect(
      toExceptionConfigs([{ date_from: '2030-12-24', date_to: '2030-12-24', kind: 'custom', custom_services: [{ name: 'Gala', start_minute: 1260, end_minute: 1560 }] }]),
    ).toEqual([{ dateFrom: '2030-12-24', dateTo: '2030-12-24', kind: 'custom', customServices: [{ name: 'Gala', startMinute: 1260, endMinute: 1560 }] }]);
  });
});
