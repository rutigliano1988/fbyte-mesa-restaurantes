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
  /** bookable: false en las mesas desactivadas (el hueco se ve, pero no es un botón de nueva reserva). */
  | { kind: 'free'; col: number; span: 1; minute: number; bookable: boolean }
  | { kind: 'reservation'; col: number; span: number; reservationId: string }
  | { kind: 'block'; col: number; span: number; blockId: string };

export type GridRow = { tableId: string; segments: GridSegment[] };
/** columns: minuto de cada columna (sin las horas que no existen la noche del adelanto de hora). */
export type GridLayout = { columns: number[]; rows: GridRow[] };

/** Minutos de cada columna: del inicio al cierre del servicio, cada 15 min (el cierre no tiene columna). */
export function gridColumns(service: Pick<DayService, 'startMinute' | 'endMinute'>): number[] {
  const out: number[] = [];
  for (let m = service.startMinute; m < service.endMinute; m += GRID_STEP) out.push(m);
  return out;
}

type Occupant = { kind: 'reservation' | 'block'; id: string } | null;

/**
 * Filas (mesas activas y las desactivadas con alguna reserva a la vista en el servicio, en el orden recibido) con
 * sus tramos: reservas activas, bloqueos (rayados) y huecos de 15 min.
 *
 * Todo se mide en instantes, no en hora de reloj: cada columna cubre de su hora a la de 15 min después
 * (`zonedTimeToUtc`), y una reserva o un bloqueo la ocupa si se solapa con ella. Así, la noche en que se atrasa la
 * hora, las dos pasadas de las 02:xx no se pisan (la columna de la 01:45 llega hasta las 02:00 de invierno), y la
 * noche en que se adelanta, las horas que no existen no tienen columna (ni huecos libres).
 *
 * Si una reserva y un bloqueo se pisan, manda la reserva. Si dos reservas comparten columna (no empiezan en punto),
 * se la queda la que la ocupa más rato (a igualdad, la que empieza antes), salvo que la otra se quedara sin barra.
 */
export function buildGrid(input: {
  date: string;
  timeZone: string;
  service: Pick<DayService, 'startMinute' | 'endMinute'>;
  tables: readonly BookingTable[];
  reservations: readonly GridReservation[];
  blocks: readonly BlockSpan[];
}): GridLayout {
  const { date, timeZone } = input;
  const columns = gridColumns(input.service).filter((m) => serviceDayMinute(zonedTimeToUtc(date, m, timeZone), date, timeZone) === m);
  const bounds = columns.map((m) => [zonedTimeToUtc(date, m, timeZone), zonedTimeToUtc(date, m + GRID_STEP, timeZone)] as const);
  /** Milisegundos en que [startMs, endMs) se solapa con la columna c (0 = nada). */
  const overlap = (startMs: number, endMs: number, c: number) => Math.max(0, Math.min(endMs, bounds[c][1]) - Math.max(startMs, bounds[c][0]));
  const active = input.reservations.filter((r) => isActiveStatus(r.status)).sort((a, b) => a.startMs - b.startMs);

  const rows = input.tables.map((table): GridRow => {
    const cells: Occupant[] = columns.map(() => null);
    for (const b of input.blocks) {
      if (b.tableId !== null && b.tableId !== table.id) continue;
      for (let c = 0; c < columns.length; c++) if (!cells[c] && overlap(b.startMs, b.endMs, c) > 0) cells[c] = { kind: 'block', id: b.id };
    }

    const mine = active.filter((r) => r.tableIds.includes(table.id));
    const won = new Map<string, number>();
    const take = (c: number, r: GridReservation) => {
      const prev = cells[c];
      if (prev?.kind === 'reservation') won.set(prev.id, (won.get(prev.id) ?? 0) - 1);
      cells[c] = { kind: 'reservation', id: r.id };
      won.set(r.id, (won.get(r.id) ?? 0) + 1);
    };
    for (let c = 0; c < columns.length; c++) {
      let best: GridReservation | null = null;
      let bestMs = 0;
      for (const r of mine) {
        const ms = overlap(r.startMs, r.endMs, c);
        if (ms > bestMs) [best, bestMs] = [r, ms];
      }
      if (best) take(c, best);
    }
    // Ninguna reserva a la vista se queda sin barra: si perdió todas sus columnas, recupera una a otra que tenga más.
    for (const r of mine) {
      if (won.get(r.id)) continue;
      let pick = -1;
      let pickMs = 0;
      for (let c = 0; c < columns.length; c++) {
        const ms = overlap(r.startMs, r.endMs, c);
        const holder = cells[c];
        const canGive = holder?.kind === 'reservation' && (won.get(holder.id) ?? 0) > 1;
        if (canGive && ms > pickMs) [pick, pickMs] = [c, ms];
      }
      if (pick >= 0) take(pick, r);
    }

    const segments: GridSegment[] = [];
    for (let c = 0; c < columns.length; c++) {
      const occupant = cells[c];
      if (!occupant) {
        segments.push({ kind: 'free', col: c, span: 1, minute: columns[c], bookable: table.active });
        continue;
      }
      let end = c + 1;
      while (end < columns.length && cells[end]?.kind === occupant.kind && cells[end]?.id === occupant.id) end++;
      segments.push(
        occupant.kind === 'reservation'
          ? { kind: 'reservation', col: c, span: end - c, reservationId: occupant.id }
          : { kind: 'block', col: c, span: end - c, blockId: occupant.id },
      );
      c = end - 1;
    }
    return { tableId: table.id, segments };
  });
  return {
    columns,
    rows: rows.filter((row, i) => input.tables[i].active || row.segments.some((s) => s.kind === 'reservation')),
  };
}

/** El tramo de la fila que cubre esa columna (undefined solo si la fila no tiene columnas). */
export function segmentAt(row: GridRow, col: number): GridSegment {
  return row.segments.find((s) => col >= s.col && col < s.col + s.span) ?? row.segments[row.segments.length - 1];
}

export type GridPos = { row: number; col: number };

/** La posición dentro de la cuadrícula (si ha cambiado y ya no cabe, la fila y la columna más cercanas); null si está vacía. */
function clampPos(layout: GridLayout, pos: GridPos): GridPos | null {
  const rows = layout.rows.length;
  const cols = layout.columns.length;
  if (rows === 0 || cols === 0) return null;
  return { row: Math.min(Math.max(pos.row, 0), rows - 1), col: Math.min(Math.max(pos.col, 0), cols - 1) };
}

/**
 * La celda que debe tener el foco para una posición: la columna de inicio del tramo en el que cae (una barra se
 * enfoca entera). La posición se ajusta si la cuadrícula ha cambiado; null si no hay mesas o no hay columnas.
 */
export function focusTarget(layout: GridLayout, pos: GridPos): GridPos | null {
  const p = clampPos(layout, pos);
  if (!p) return null;
  const segment = segmentAt(layout.rows[p.row], p.col);
  return segment ? { row: p.row, col: segment.col } : null;
}

/**
 * Teclado de la cuadrícula (un solo punto de tabulación): flechas para ir de tramo en tramo y de mesa en mesa,
 * Inicio y Fin para ir al primero y al último de la fila. null si la tecla no es de moverse o la cuadrícula está vacía.
 *
 * Derecha, Izquierda, Inicio y Fin devuelven la columna de inicio del tramo. Arriba y Abajo mantienen la columna
 * (para seguir bajando por la misma hora), que puede caer en mitad de una barra: el foco va a `focusTarget(layout, pos)`.
 */
export function moveFocus(layout: GridLayout, pos: GridPos, key: string): GridPos | null {
  const p = clampPos(layout, pos);
  if (!p) return null;
  const last = layout.columns.length - 1;
  const row = layout.rows[p.row];
  const current = segmentAt(row, p.col);
  if (!current) return null;
  switch (key) {
    case 'ArrowRight': {
      const next = current.col + current.span;
      return { row: p.row, col: next <= last ? next : p.col };
    }
    case 'ArrowLeft':
      return { row: p.row, col: current.col > 0 ? segmentAt(row, current.col - 1).col : p.col };
    case 'ArrowDown':
      return { row: Math.min(p.row + 1, layout.rows.length - 1), col: p.col };
    case 'ArrowUp':
      return { row: Math.max(p.row - 1, 0), col: p.col };
    case 'Home':
      return { row: p.row, col: 0 };
    case 'End':
      return { row: p.row, col: segmentAt(row, last).col };
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
  return `${reservationBarText(r)} ${r.partySize === 1 ? 'persona' : 'personas'}, ${tableName}, ${timeRange}, ${STATUS_LABELS_ES[r.status]}. Abrir la reserva`;
}

export function blockLabel(tableName: string, timeRange: string, reason: string | null): string {
  return `${tableName} bloqueada, ${timeRange}${reason ? `: ${reason}` : ''}`;
}
