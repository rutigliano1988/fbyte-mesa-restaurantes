import { minutesToTime } from '@/lib/schedule';
import { isActiveStatus, STATUS_LABELS_ES, type ReservationStatus } from './codes';
import type { BlockSpan, BookingTable } from './availability';
import type { DayService } from './day';
import { serviceDayMinute, zonedTimeToUtc } from './time';

/** Cada columna de la cuadrícula son 15 minutos. */
export const GRID_STEP = 15;

export type GridReservation = {
  id: string;
  startMs: number;
  endMs: number;
  tableIds: string[];
  status: ReservationStatus;
  name: string;
  partySize: number;
};

export type GridSegment =
  | { kind: 'free'; col: number; span: 1; minute: number }
  | { kind: 'reservation'; col: number; span: number; reservationId: string }
  | { kind: 'block'; col: number; span: number; blockId: string };

export type GridRow = { tableId: string; segments: GridSegment[] };
export type GridLayout = { columns: number[]; rows: GridRow[] };

/** Minutos de cada columna: del inicio al cierre del servicio, cada 15 min (el cierre no tiene columna). */
export function gridColumns(service: Pick<DayService, 'startMinute' | 'endMinute'>): number[] {
  const out: number[] = [];
  for (let m = service.startMinute; m < service.endMinute; m += GRID_STEP) out.push(m);
  return out;
}

type Occupant = { kind: 'reservation' | 'block'; id: string } | null;

/**
 * Filas (mesas activas y las desactivadas que tienen reservas a la vista, en el orden recibido) con sus tramos:
 * reservas activas, bloqueos (rayados) y huecos de 15 min. Si una reserva y un bloqueo se pisan, manda la reserva.
 */
export function buildGrid(input: {
  date: string;
  timeZone: string;
  service: Pick<DayService, 'startMinute' | 'endMinute'>;
  tables: readonly BookingTable[];
  reservations: readonly GridReservation[];
  blocks: readonly BlockSpan[];
}): GridLayout {
  const columns = gridColumns(input.service);
  const n = columns.length;
  const dayStart = zonedTimeToUtc(input.date, 0, input.timeZone);
  const minuteOf = (ms: number) => serviceDayMinute(ms, input.date, input.timeZone) ?? (ms < dayStart ? -Infinity : Infinity);
  const span = (startMs: number, endMs: number): [number, number] | null => {
    const from = Math.max(0, Math.floor((minuteOf(startMs) - input.service.startMinute) / GRID_STEP));
    const to = Math.min(n, Math.ceil((minuteOf(endMs) - input.service.startMinute) / GRID_STEP));
    return to > from ? [from, to] : null;
  };
  const active = input.reservations.filter((r) => isActiveStatus(r.status));
  const tables = input.tables.filter((t) => t.active || active.some((r) => r.tableIds.includes(t.id)));

  const rows = tables.map((table): GridRow => {
    const cells: Occupant[] = Array.from({ length: n }, () => null);
    for (const b of input.blocks) {
      if (b.tableId !== null && b.tableId !== table.id) continue;
      const s = span(b.startMs, b.endMs);
      if (s) for (let c = s[0]; c < s[1]; c++) cells[c] = { kind: 'block', id: b.id };
    }
    for (const r of active) {
      if (!r.tableIds.includes(table.id)) continue;
      const s = span(r.startMs, r.endMs);
      if (s) for (let c = s[0]; c < s[1]; c++) cells[c] = { kind: 'reservation', id: r.id };
    }
    const segments: GridSegment[] = [];
    for (let c = 0; c < n; c++) {
      const occupant = cells[c];
      if (!occupant) {
        segments.push({ kind: 'free', col: c, span: 1, minute: columns[c] });
        continue;
      }
      let end = c + 1;
      while (end < n && cells[end]?.kind === occupant.kind && cells[end]?.id === occupant.id) end++;
      segments.push(
        occupant.kind === 'reservation'
          ? { kind: 'reservation', col: c, span: end - c, reservationId: occupant.id }
          : { kind: 'block', col: c, span: end - c, blockId: occupant.id },
      );
      c = end - 1;
    }
    return { tableId: table.id, segments };
  });
  return { columns, rows };
}

/** El tramo de la fila que cubre esa columna. */
export function segmentAt(row: GridRow, col: number): GridSegment {
  return row.segments.find((s) => col >= s.col && col < s.col + s.span) ?? row.segments[row.segments.length - 1];
}

export type GridPos = { row: number; col: number };

/**
 * Teclado de la cuadrícula (un solo punto de tabulación): flechas para ir de tramo en tramo y de mesa en mesa (se
 * mantiene la columna), Inicio y Fin para ir al primero y al último de la fila. null si la tecla no es de moverse.
 */
export function moveFocus(layout: GridLayout, pos: GridPos, key: string): GridPos | null {
  const last = layout.columns.length - 1;
  const row = layout.rows[pos.row];
  if (!row || last < 0) return null;
  const current = segmentAt(row, pos.col);
  switch (key) {
    case 'ArrowRight': {
      const next = current.col + current.span;
      return { row: pos.row, col: next <= last ? next : pos.col };
    }
    case 'ArrowLeft':
      return { row: pos.row, col: current.col > 0 ? segmentAt(row, current.col - 1).col : pos.col };
    case 'ArrowDown':
      return { row: Math.min(pos.row + 1, layout.rows.length - 1), col: pos.col };
    case 'ArrowUp':
      return { row: Math.max(pos.row - 1, 0), col: pos.col };
    case 'Home':
      return { row: pos.row, col: 0 };
    case 'End':
      return { row: pos.row, col: last };
    default:
      return null;
  }
}

/** Nombre accesible de un hueco: 'Nueva reserva en T4 a las 21:15'. */
export function freeCellLabel(tableName: string, minute: number): string {
  return `Nueva reserva en ${tableName} a las ${minutesToTime(minute)}`;
}

/** Texto visible de una barra ('García · 4') y su nombre accesible, que empieza por él. */
export function reservationBarText(r: Pick<GridReservation, 'name' | 'partySize'>): string {
  return `${r.name} · ${r.partySize}`;
}

export function reservationBarLabel(r: GridReservation, tableName: string, timeRange: string): string {
  return `${reservationBarText(r)} personas, ${tableName}, ${timeRange}, ${STATUS_LABELS_ES[r.status]}. Abrir la reserva`;
}

export function blockLabel(tableName: string, timeRange: string, reason: string | null): string {
  return `${tableName} bloqueada, ${timeRange}${reason ? `: ${reason}` : ''}`;
}
