import { z } from 'zod';
import type { BlockSpan, BookingTable, Occupancy } from './availability';
import { CUSTOMER_TAGS, RESERVATION_SOURCES, RESERVATION_STATUSES, type ReservationSource, type ReservationStatus } from './codes';
import type { CustomerSummary } from './customers';
import type { ExceptionConfig, ServiceConfig } from './day';
import { DEFAULT_BOOKING_SETTINGS, type BookingSettings } from './settings';

export type PanelReservation = {
  id: string;
  startMs: number;
  endMs: number;
  partySize: number;
  status: ReservationStatus;
  previousStatus: ReservationStatus | null;
  source: ReservationSource;
  notes: string | null;
  internalNotes: string | null;
  tableIds: string[];
  customer: CustomerSummary | null;
};

export type BookingDayData = { reservations: PanelReservation[]; occupancy: Occupancy[]; blocks: BlockSpan[] };

const int = z.number().int();
const instant = z.string().transform((v, ctx) => {
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: 'custom', message: 'fecha no válida' });
    return z.NEVER;
  }
  return ms;
});

const daySchema = z.object({
  reservations: z.array(
    z.object({
      id: z.string(),
      starts_at: instant,
      ends_at: instant,
      party_size: int,
      status: z.enum(RESERVATION_STATUSES),
      previous_status: z.enum(RESERVATION_STATUSES).nullable(),
      source: z.enum(RESERVATION_SOURCES),
      notes: z.string().nullable(),
      internal_notes: z.string().nullable(),
      table_ids: z.array(z.string()),
      customer: z
        .object({
          id: z.string(),
          name: z.string(),
          phone: z.string().nullable(),
          email: z.string().nullable(),
          tags: z.array(z.string()),
          visits_count: int,
          no_show_count: int,
          cancel_count: int,
        })
        .nullable(),
    }),
  ),
  occupancy: z.array(z.object({ reservation_id: z.string(), table_id: z.string(), starts_at: instant, ends_at: instant })),
  blocks: z.array(z.object({ id: z.string(), table_id: z.string().nullable(), starts_at: instant, ends_at: instant, reason: z.string().nullable() })),
});

/** JSON de get_booking_day → objetos de la app (instantes en ms). Lanza si no tiene la forma esperada. */
export function parseBookingDay(json: unknown): BookingDayData {
  const d = daySchema.parse(json);
  return {
    reservations: d.reservations.map((r) => ({
      id: r.id,
      startMs: r.starts_at,
      endMs: r.ends_at,
      partySize: r.party_size,
      status: r.status,
      previousStatus: r.previous_status,
      source: r.source,
      notes: r.notes,
      internalNotes: r.internal_notes,
      tableIds: r.table_ids,
      customer: r.customer && {
        id: r.customer.id,
        name: r.customer.name,
        phone: r.customer.phone,
        email: r.customer.email,
        tags: CUSTOMER_TAGS.filter((t) => r.customer?.tags.includes(t)),
        visitsCount: r.customer.visits_count,
        noShowCount: r.customer.no_show_count,
        cancelCount: r.customer.cancel_count,
      },
    })),
    occupancy: d.occupancy.map((o) => ({ reservationId: o.reservation_id, tableId: o.table_id, startMs: o.starts_at, endMs: o.ends_at })),
    blocks: d.blocks.map((b) => ({ id: b.id, tableId: b.table_id, startMs: b.starts_at, endMs: b.ends_at, reason: b.reason })),
  };
}

export type ZoneRow = { id: string; name: string; position: number };
export type TableRow = {
  id: string;
  zone_id: string;
  name: string;
  min_capacity: number;
  max_capacity: number;
  online_bookable: boolean;
  active: boolean;
  position: number;
};

/** Mesas con los datos de su zona. Una mesa cuya zona no llega se descarta. */
export function toBookingTables(zones: readonly ZoneRow[], tables: readonly TableRow[]): BookingTable[] {
  const byId = new Map(zones.map((z) => [z.id, z]));
  return tables.flatMap((t) => {
    const zone = byId.get(t.zone_id);
    if (!zone) return [];
    return [
      {
        id: t.id,
        zoneId: zone.id,
        zoneName: zone.name,
        zonePosition: zone.position,
        name: t.name,
        minCapacity: t.min_capacity,
        maxCapacity: t.max_capacity,
        onlineBookable: t.online_bookable,
        active: t.active,
        position: t.position,
      },
    ];
  });
}

export type SettingsRow = {
  default_duration_min: number;
  duration_rules: { min_party: number; max_party: number; duration_min: number }[];
  min_advance_min: number;
  max_advance_days: number;
  max_online_party: number;
  cancel_limit_hours: number;
  auto_confirm: boolean;
};

/** Sin fila guardada, los valores por defecto. */
export function toBookingSettings(row: SettingsRow | null): BookingSettings {
  if (!row) return DEFAULT_BOOKING_SETTINGS;
  return {
    defaultDurationMin: row.default_duration_min,
    durationRules: row.duration_rules.map((r) => ({ minParty: r.min_party, maxParty: r.max_party, durationMin: r.duration_min })),
    minAdvanceMin: row.min_advance_min,
    maxAdvanceDays: row.max_advance_days,
    maxOnlineParty: row.max_online_party,
    cancelLimitHours: row.cancel_limit_hours,
    autoConfirm: row.auto_confirm,
  };
}

export type ServiceRow = {
  id: string;
  name: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  last_booking_minute: number | null;
  slot_interval_min: number;
};

export function toServiceConfigs(rows: readonly ServiceRow[]): ServiceConfig[] {
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    weekday: s.weekday,
    startMinute: s.start_minute,
    endMinute: s.end_minute,
    lastBookingMinute: s.last_booking_minute,
    slotIntervalMin: s.slot_interval_min,
  }));
}

export type ExceptionRow = {
  date_from: string;
  date_to: string;
  kind: 'closed' | 'custom';
  custom_services: { name: string; start_minute: number; end_minute: number }[];
};

export function toExceptionConfigs(rows: readonly ExceptionRow[]): ExceptionConfig[] {
  return rows.map((e) => ({
    dateFrom: e.date_from,
    dateTo: e.date_to,
    kind: e.kind,
    customServices: e.custom_services.map((s) => ({ name: s.name, startMinute: s.start_minute, endMinute: s.end_minute })),
  }));
}
