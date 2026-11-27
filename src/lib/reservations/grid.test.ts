import { describe, expect, it } from 'vitest';
import type { BookingTable } from './availability';
import { blockLabel, buildGrid, freeCellLabel, gridColumns, moveFocus, reservationBarLabel, reservationBarText, segmentAt, type GridReservation } from './grid';
import { zonedTimeToUtc } from './time';

const TZ = 'Europe/Madrid';
const DATE = '2030-06-14';
const at = (minute: number) => zonedTimeToUtc(DATE, minute, TZ);
const service = { startMinute: 1260, endMinute: 1410 }; // 21:00–23:30 → 10 columnas
const t = (id: string, active = true): BookingTable => ({
  id,
  zoneId: 'z',
  zoneName: 'Sala',
  zonePosition: 0,
  name: id.toUpperCase(),
  minCapacity: 1,
  maxCapacity: 4,
  onlineBookable: true,
  active,
  position: 0,
});
const res = (id: string, tableIds: string[], from: number, to: number, status: GridReservation['status'] = 'confirmed'): GridReservation => ({
  id,
  startMs: at(from),
  endMs: at(to),
  tableIds,
  status,
  name: 'García',
  partySize: 4,
});

describe('cuadrícula', () => {
  it('columnas cada 15 min del inicio al cierre', () => {
    expect(gridColumns(service)).toEqual([1260, 1275, 1290, 1305, 1320, 1335, 1350, 1365, 1380, 1395]);
  });

  it('reservas como barras, huecos de 15 min y bloqueos; una reserva con dos mesas sale en las dos', () => {
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1'), t('t2')],
      reservations: [res('r1', ['t1', 't2'], 1290, 1380)],
      blocks: [{ id: 'b1', tableId: 't2', startMs: at(1380), endMs: at(1500), reason: 'Reparación' }],
    });
    expect(layout.rows[0].segments.map((s) => [s.kind, s.col, s.span])).toEqual([
      ['free', 0, 1],
      ['free', 1, 1],
      ['reservation', 2, 6],
      ['free', 8, 1],
      ['free', 9, 1],
    ]);
    expect(layout.rows[1].segments.slice(-2).map((s) => [s.kind, s.col, s.span])).toEqual([
      ['reservation', 2, 6],
      ['block', 8, 2],
    ]);
  });

  it('recorta lo que empieza antes o acaba después; no pinta canceladas; manda la reserva sobre el bloqueo', () => {
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1')],
      reservations: [res('early', ['t1'], 1200, 1275), res('late', ['t1'], 1395, 1500), res('gone', ['t1'], 1305, 1350, 'cancelled_customer')],
      blocks: [{ id: 'all', tableId: null, startMs: at(1260), endMs: at(1320), reason: null }],
    });
    expect(layout.rows[0].segments.map((s) => [s.kind, s.col, s.span])).toEqual([
      ['reservation', 0, 1],
      ['block', 1, 3],
      ['free', 4, 1],
      ['free', 5, 1],
      ['free', 6, 1],
      ['free', 7, 1],
      ['free', 8, 1],
      ['reservation', 9, 1],
    ]);
  });

  it('las mesas desactivadas solo salen si tienen reservas a la vista; la madrugada cuenta', () => {
    const late = { startMinute: 1320, endMinute: 1470 };
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service: late,
      tables: [t('t1'), t('off', false), t('off2', false)],
      reservations: [res('r', ['off'], 1440, 1470)],
      blocks: [],
    });
    expect(layout.rows.map((r) => r.tableId)).toEqual(['t1', 'off']);
    expect(layout.rows[1].segments.at(-1)).toEqual({ kind: 'reservation', col: 8, span: 2, reservationId: 'r' });
  });
});

describe('teclado', () => {
  const layout = buildGrid({
    date: DATE,
    timeZone: TZ,
    service,
    tables: [t('t1'), t('t2')],
    reservations: [res('r1', ['t1'], 1290, 1380)],
    blocks: [],
  });

  it('derecha e izquierda saltan la barra entera', () => {
    expect(moveFocus(layout, { row: 0, col: 1 }, 'ArrowRight')).toEqual({ row: 0, col: 2 });
    expect(moveFocus(layout, { row: 0, col: 2 }, 'ArrowRight')).toEqual({ row: 0, col: 8 });
    expect(moveFocus(layout, { row: 0, col: 8 }, 'ArrowLeft')).toEqual({ row: 0, col: 2 });
    expect(moveFocus(layout, { row: 0, col: 9 }, 'ArrowRight')).toEqual({ row: 0, col: 9 });
    expect(moveFocus(layout, { row: 0, col: 0 }, 'ArrowLeft')).toEqual({ row: 0, col: 0 });
  });

  it('arriba y abajo mantienen la columna; Inicio y Fin; otras teclas, nada', () => {
    expect(moveFocus(layout, { row: 1, col: 5 }, 'ArrowUp')).toEqual({ row: 0, col: 5 });
    expect(segmentAt(layout.rows[0], 5)).toMatchObject({ kind: 'reservation', col: 2 });
    expect(moveFocus(layout, { row: 1, col: 5 }, 'ArrowDown')).toEqual({ row: 1, col: 5 });
    expect(moveFocus(layout, { row: 0, col: 5 }, 'End')).toEqual({ row: 0, col: 9 });
    expect(moveFocus(layout, { row: 0, col: 5 }, 'Home')).toEqual({ row: 0, col: 0 });
    expect(moveFocus(layout, { row: 0, col: 5 }, 'Enter')).toBeNull();
  });
});

it('nombres accesibles: el de la barra empieza por su texto visible', () => {
  expect(freeCellLabel('T4', 1275)).toBe('Nueva reserva en T4 a las 21:15');
  const r = res('r', ['t4'], 1260, 1350);
  expect(reservationBarText(r)).toBe('García · 4');
  expect(reservationBarLabel(r, 'T4', '21:00–22:30')).toBe('García · 4 personas, T4, 21:00–22:30, Confirmada. Abrir la reserva');
  expect(blockLabel('T4', '13:00–16:00', 'Obras')).toBe('T4 bloqueada, 13:00–16:00: Obras');
});
