import { describe, expect, it } from 'vitest';
import type { BookingTable } from './availability';
import {
  blockLabel,
  buildGrid,
  focusTarget,
  freeCellLabel,
  gridColumns,
  gridTimeText,
  moveFocus,
  reservationBarLabel,
  reservationBarText,
  segmentAt,
  type GridLayout,
  type GridReservation,
  type GridRow,
} from './grid';
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
      tables: [t('t1'), t('off', false), t('off2', false), t('lunch', false)],
      reservations: [res('r', ['off'], 1440, 1470), res('noon', ['lunch'], 780, 870)],
      blocks: [],
    });
    expect(layout.rows.map((r) => r.tableId)).toEqual(['t1', 'off']);
    expect(layout.rows[1].segments.at(-1)).toEqual({ kind: 'reservation', col: 8, span: 2, reservationId: 'r' });
  });

  it('los huecos de una mesa desactivada no se ofrecen para reservar; los de una activa, sí', () => {
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1'), t('off', false)],
      reservations: [res('r', ['off'], 1290, 1380)],
      blocks: [],
    });
    const free = (row: GridRow) => row.segments.filter((s) => s.kind === 'free');
    expect(free(layout.rows[0]).every((s) => s.bookable)).toBe(true);
    expect(free(layout.rows[1])).toHaveLength(4);
    expect(free(layout.rows[1]).some((s) => s.bookable)).toBe(false);
  });

  it('reservas que no empiezan en punto: las dos que comparten columna conservan su barra', () => {
    const layout = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1'), t('t2')],
      reservations: [
        res('before', ['t1'], 1200, 1267), // 20:00–21:07, solo asoma en la columna de las 21:00
        res('walkin', ['t1'], 1267, 1357), // 21:07–22:37
        res('a', ['t2'], 1200, 1270), // 20:00–21:10: se queda la columna de las 21:00 (la ocupa más rato)
        res('b', ['t2'], 1270, 1320), // 21:10–22:00
      ],
      blocks: [],
    });
    expect(layout.rows[0].segments.slice(0, 3)).toEqual([
      { kind: 'reservation', col: 0, span: 1, reservationId: 'before' },
      { kind: 'reservation', col: 1, span: 6, reservationId: 'walkin' },
      { kind: 'free', col: 7, span: 1, minute: 1365, bookable: true },
    ]);
    expect(layout.rows[1].segments.slice(0, 3)).toEqual([
      { kind: 'reservation', col: 0, span: 1, reservationId: 'a' },
      { kind: 'reservation', col: 1, span: 3, reservationId: 'b' },
      { kind: 'free', col: 4, span: 1, minute: 1320, bookable: true },
    ]);
  });
});

describe('cuadrícula en el cambio de hora (Madrid)', () => {
  const UTC = (iso: string) => Date.parse(iso);
  const small = { startMinute: 60, endMinute: 240 }; // 01:00–04:00 del mismo día
  const gres = (id: string, tableId: string, startIso: string, endIso: string): GridReservation => ({
    id,
    startMs: UTC(startIso),
    endMs: UTC(endIso),
    tableIds: [tableId],
    status: 'confirmed',
    name: 'García',
    partySize: 2,
  });
  const bars = (layout: GridLayout, row: number) =>
    layout.rows[row].segments.filter((s) => s.kind === 'reservation').map((s) => [s.reservationId, layout.columns[s.col], s.span]);

  it('al atrasar la hora (27/10/2030), una reserva de 02:30 de verano a 02:30 de invierno sigue a la vista', () => {
    const layout = buildGrid({
      date: '2030-10-27',
      timeZone: TZ,
      service: small,
      tables: [t('t1')],
      // 02:30 CEST = 00:30 UTC; 02:30 CET = 01:30 UTC: una hora de verdad, con la misma hora de reloj.
      reservations: [gres('r', 't1', '2030-10-27T00:30:00Z', '2030-10-27T01:30:00Z')],
      blocks: [],
    });
    // La columna de la 01:45 llega hasta las 02:00 de invierno: recoge la primera pasada de las 02:xx.
    expect(bars(layout, 0)).toEqual([['r', 105, 3]]);
  });

  it('al atrasar la hora, dos reservas de la misma mesa, una en cada pasada de las 02:xx, no se pisan', () => {
    const layout = buildGrid({
      date: '2030-10-27',
      timeZone: TZ,
      service: small,
      tables: [t('t1')],
      reservations: [
        gres('summer', 't1', '2030-10-27T00:00:00Z', '2030-10-27T00:45:00Z'), // 02:00–02:45 de verano
        gres('winter', 't1', '2030-10-27T01:00:00Z', '2030-10-27T01:45:00Z'), // 02:00–02:45 de invierno
      ],
      blocks: [],
    });
    expect(bars(layout, 0)).toEqual([
      ['summer', 105, 1],
      ['winter', 120, 3],
    ]);
  });

  it('al adelantar la hora (31/03/2030), las 02:xx no existen: sin columnas ni huecos libres; la reserva que cruza sigue entera', () => {
    const layout = buildGrid({
      date: '2030-03-31',
      timeZone: TZ,
      service: small,
      tables: [t('t1'), t('t2')],
      // 01:30 CET = 00:30 UTC; 03:30 CEST = 01:30 UTC.
      reservations: [gres('r', 't1', '2030-03-31T00:30:00Z', '2030-03-31T01:30:00Z')],
      blocks: [],
    });
    expect(layout.columns).toEqual([60, 75, 90, 105, 180, 195, 210, 225]);
    expect(bars(layout, 0)).toEqual([['r', 90, 4]]);
    const freeMinutes = layout.rows.flatMap((row) => row.segments.flatMap((s) => (s.kind === 'free' ? [s.minute] : [])));
    expect(freeMinutes.filter((m) => m >= 120 && m < 180)).toEqual([]);
    expect(layout.rows[1].segments.map((s) => s.kind === 'free' && s.minute)).toEqual([60, 75, 90, 105, 180, 195, 210, 225]);
  });

  it('un servicio de noche que cruza el adelanto de hora (sábado 30/03/2030, 23:00–04:00)', () => {
    const layout = buildGrid({
      date: '2030-03-30',
      timeZone: TZ,
      service: { startMinute: 1380, endMinute: 1680 },
      tables: [t('t1')],
      reservations: [],
      blocks: [],
    });
    expect(layout.columns.filter((m) => m >= 1560 && m < 1620)).toEqual([]);
    expect(layout.columns).toHaveLength(16);
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

  it('al caer en mitad de una barra (Abajo, Fin), el foco va al inicio de la barra', () => {
    const bars = buildGrid({
      date: DATE,
      timeZone: TZ,
      service,
      tables: [t('t1'), t('t2')],
      reservations: [res('r2', ['t2'], 1290, 1335), res('r3', ['t2'], 1365, 1410)],
      blocks: [],
    });
    const down = moveFocus(bars, { row: 0, col: 3 }, 'ArrowDown')!;
    expect(down).toEqual({ row: 1, col: 3 }); // se recuerda la columna para seguir bajando
    expect(focusTarget(bars, down)).toEqual({ row: 1, col: 2 });
    const end = moveFocus(bars, { row: 1, col: 0 }, 'End')!;
    expect(end).toEqual({ row: 1, col: 7 });
    expect(focusTarget(bars, end)).toEqual({ row: 1, col: 7 });
    expect(focusTarget(bars, { row: 1, col: 9 })).toEqual({ row: 1, col: 7 });
    // Si la cuadrícula ha cambiado (menos mesas o columnas), la posición se ajusta a lo que hay.
    expect(focusTarget(bars, { row: 5, col: 40 })).toEqual({ row: 1, col: 7 });
    expect(moveFocus(bars, { row: 5, col: 40 }, 'ArrowUp')).toEqual({ row: 0, col: 9 });
  });

  it('sin mesas o sin columnas no se mueve nada ni falla', () => {
    const empty: GridLayout = { columns: [], rows: [] };
    const noColumns: GridLayout = { columns: [], rows: [{ tableId: 't1', segments: [] }] };
    const noRows: GridLayout = { columns: [1260, 1275], rows: [] };
    for (const l of [empty, noColumns, noRows]) {
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter']) {
        expect(moveFocus(l, { row: 0, col: 0 }, key)).toBeNull();
      }
      expect(focusTarget(l, { row: 0, col: 0 })).toBeNull();
    }
    expect(buildGrid({ date: DATE, timeZone: TZ, service: { startMinute: 1260, endMinute: 1260 }, tables: [t('t1')], reservations: [], blocks: [] })).toEqual({
      columns: [],
      rows: [{ tableId: 't1', segments: [] }],
    });
  });
});

it('nombres accesibles: el de la barra empieza por su texto visible', () => {
  expect(freeCellLabel('T4', 1275)).toBe('Nueva reserva en T4 a las 21:15');
  expect(freeCellLabel('T4', 1470)).toBe('Nueva reserva en T4 a las 00:30 del día siguiente');
  expect(gridTimeText(1440)).toBe('00:00 del día siguiente');
  expect(gridTimeText(1425)).toBe('23:45');
  const r = res('r', ['t4'], 1260, 1350);
  expect(reservationBarText(r)).toBe('García · 4');
  expect(reservationBarLabel(r, 'T4', '21:00–22:30')).toBe('García · 4 personas, T4, 21:00–22:30, Confirmada. Abrir la reserva');
  const one = { ...r, partySize: 1 };
  expect(reservationBarText(one)).toBe('García · 1');
  expect(reservationBarLabel(one, 'T4', '21:00–22:30')).toBe('García · 1 persona, T4, 21:00–22:30, Confirmada. Abrir la reserva');
  expect(blockLabel('T4', '13:00–16:00', 'Obras')).toBe('T4 bloqueada, 13:00–16:00: Obras');
});
