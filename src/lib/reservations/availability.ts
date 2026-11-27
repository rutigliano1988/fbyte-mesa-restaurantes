import { slotMinutes, type DayService } from './day';
import { zonedTimeToUtc } from './time';

export type BookingTable = {
  id: string;
  zoneId: string;
  zoneName: string;
  zonePosition: number;
  name: string;
  minCapacity: number;
  maxCapacity: number;
  onlineBookable: boolean;
  active: boolean;
  position: number;
};

/** Una mesa ocupada por una reserva activa (pending, confirmed o seated) entre startMs y endMs. */
export type Occupancy = { reservationId: string; tableId: string; startMs: number; endMs: number };
/** Bloqueo de una mesa o de todo el restaurante (tableId null). */
export type BlockSpan = { id: string; tableId: string | null; startMs: number; endMs: number; reason: string | null };

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** «La más pequeña que sirve»: capacidad máxima, posición de la zona, posición, nombre (igual que la BD). */
export function compareTables(a: BookingTable, b: BookingTable): number {
  return (
    a.maxCapacity - b.maxCapacity ||
    a.zonePosition - b.zonePosition ||
    a.position - b.position ||
    byCodeUnits(a.name, b.name) ||
    byCodeUnits(a.id, b.id)
  );
}

/** Orden de las filas de la cuadrícula y de las listas: por zona y, dentro, por posición y nombre. */
export function compareTablesForDisplay(a: BookingTable, b: BookingTable): number {
  return a.zonePosition - b.zonePosition || byCodeUnits(a.zoneId, b.zoneId) || a.position - b.position || byCodeUnits(a.name, b.name);
}

/** El bloqueo que afecta a esa mesa en ese rato (el suyo o uno de todo el restaurante), si lo hay. */
export function blockFor(tableId: string, startMs: number, endMs: number, blocks: readonly BlockSpan[]): BlockSpan | null {
  return blocks.find((b) => (b.tableId === null || b.tableId === tableId) && overlaps(startMs, endMs, b.startMs, b.endMs)) ?? null;
}

export function isTableFree(
  tableId: string,
  startMs: number,
  endMs: number,
  occupancy: readonly Occupancy[],
  blocks: readonly BlockSpan[],
  ignoreReservationId?: string,
): boolean {
  if (blockFor(tableId, startMs, endMs, blocks)) return false;
  return !occupancy.some(
    (o) => o.tableId === tableId && o.reservationId !== ignoreReservationId && overlaps(startMs, endMs, o.startMs, o.endMs),
  );
}

/** Mesas activas libres y sin bloquear en ese rato, de la más pequeña a la más grande. */
export function freeTables(
  tables: readonly BookingTable[],
  startMs: number,
  endMs: number,
  occupancy: readonly Occupancy[],
  blocks: readonly BlockSpan[],
  ignoreReservationId?: string,
): BookingTable[] {
  return tables
    .filter((t) => t.active && isTableFree(t.id, startMs, endMs, occupancy, blocks, ignoreReservationId))
    .sort(compareTables);
}

export type ProposeOptions = { ignoreReservationId?: string; onlineOnly?: boolean; zoneId?: string | null };

/** La mesa más pequeña que sirve (mín ≤ personas ≤ máx), libre y sin bloquear; desempate por posición. */
export function proposeTable(
  tables: readonly BookingTable[],
  partySize: number,
  startMs: number,
  endMs: number,
  occupancy: readonly Occupancy[],
  blocks: readonly BlockSpan[],
  opts: ProposeOptions = {},
): BookingTable | null {
  return (
    freeTables(tables, startMs, endMs, occupancy, blocks, opts.ignoreReservationId).find(
      (t) =>
        t.minCapacity <= partySize &&
        partySize <= t.maxCapacity &&
        (!opts.onlineOnly || t.onlineBookable) &&
        (!opts.zoneId || t.zoneId === opts.zoneId),
    ) ?? null
  );
}

/** Personas que caben entre varias mesas (suma de sus capacidades máximas). */
export function capacityOf(tables: readonly Pick<BookingTable, 'maxCapacity'>[]): number {
  return tables.reduce((n, t) => n + t.maxCapacity, 0);
}

export type Slot = {
  serviceKey: string;
  serviceName: string;
  /** Minuto del día de servicio (1470 = 00:30 del día siguiente). */
  minute: number;
  startMs: number;
  endMs: number;
  /** La mesa que se propondría; null = no hay hueco. */
  table: BookingTable | null;
};

export type SlotsInput = {
  date: string;
  timeZone: string;
  services: readonly DayService[];
  partySize: number;
  durationMin: number;
  tables: readonly BookingTable[];
  occupancy: readonly Occupancy[];
  blocks: readonly BlockSpan[];
  zoneId?: string | null;
  onlineOnly?: boolean;
  /** Antelación: fuera quedan las horas antes de notBeforeMs o después de notAfterMs. */
  notBeforeMs?: number;
  notAfterMs?: number;
  ignoreReservationId?: string;
};

/**
 * Horas de un día con su mesa propuesta (spec §6.2): las de cada servicio del inicio a la última hora de reserva,
 * dentro de la antelación, con la mesa más pequeña que sirve libre durante toda la duración.
 */
export function getAvailableSlots(input: SlotsInput): Slot[] {
  const out: Slot[] = [];
  for (const service of input.services) {
    for (const minute of slotMinutes(service)) {
      const startMs = zonedTimeToUtc(input.date, minute, input.timeZone);
      if (input.notBeforeMs !== undefined && startMs < input.notBeforeMs) continue;
      if (input.notAfterMs !== undefined && startMs > input.notAfterMs) continue;
      const endMs = startMs + input.durationMin * 60_000;
      out.push({
        serviceKey: service.key,
        serviceName: service.name,
        minute,
        startMs,
        endMs,
        table: proposeTable(input.tables, input.partySize, startMs, endMs, input.occupancy, input.blocks, {
          onlineOnly: input.onlineOnly,
          zoneId: input.zoneId,
          ignoreReservationId: input.ignoreReservationId,
        }),
      });
    }
  }
  return out;
}
