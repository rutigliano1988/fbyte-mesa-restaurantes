/** Días ISO: 1 = lunes … 7 = domingo. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS_ES: Record<Weekday, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const MINUTES_PER_DAY = 1440;
/** Un servicio puede acabar como muy tarde a las 06:00 del día siguiente. */
export const MAX_END_MINUTE = 1800;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export type ServiceSlot = { id?: string; name: string; weekday: number; startMinute: number; endMinute: number };
export type CustomService = { name: string; startMinute: number; endMinute: number };
export type ScheduleException = {
  dateFrom: string;
  dateTo: string;
  kind: 'closed' | 'custom';
  customServices: CustomService[];
  note: string | null;
};

export function isWeekday(value: number): value is Weekday {
  return (WEEKDAYS as readonly number[]).includes(value);
}

/** 785 → '13:05'; 1470 → '00:30' (las horas de después de medianoche se muestran como del día siguiente). */
export function minutesToTime(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** '13:05' → 785. null si no es una hora HH:MM válida. */
export function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Horas del formulario → minutos. Si el fin es anterior al inicio, es del día siguiente:
 * '20:00'–'00:30' → 1200–1470. null si alguna hora no vale, si son iguales o si acaba después de las 06:00.
 */
export function toServiceRange(start: string, end: string): { startMinute: number; endMinute: number } | null {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null || s === e) return null;
  const endMinute = e < s ? e + MINUTES_PER_DAY : e;
  if (endMinute > MAX_END_MINUTE) return null;
  return { startMinute: s, endMinute };
}

/** 1200, 1470 → '20:00–00:30'. */
export function formatRange(startMinute: number, endMinute: number): string {
  return `${minutesToTime(startMinute)}–${minutesToTime(endMinute)}`;
}

/** Primer servicio de la lista que se solapa con el candidato, contando lo que pasa de medianoche (también de domingo a lunes). */
export function findOverlap(existing: ServiceSlot[], candidate: ServiceSlot): ServiceSlot | null {
  const c0 = (candidate.weekday - 1) * MINUTES_PER_DAY + candidate.startMinute;
  const c1 = c0 + (candidate.endMinute - candidate.startMinute);
  for (const s of existing) {
    if (candidate.id && s.id === candidate.id) continue;
    const s0 = (s.weekday - 1) * MINUTES_PER_DAY + s.startMinute;
    const s1 = s0 + (s.endMinute - s.startMinute);
    for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
      if (c0 < s1 + shift && s0 + shift < c1) return s;
    }
  }
  return null;
}

/** Agrupa por día de la semana y ordena por hora de inicio. */
export function groupByWeekday<T extends { weekday: number; startMinute: number }>(items: T[]): Record<Weekday, T[]> {
  const out = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] } as Record<Weekday, T[]>;
  for (const item of items) if (isWeekday(item.weekday)) out[item.weekday].push(item);
  for (const day of WEEKDAYS) out[day].sort((a, b) => a.startMinute - b.startMinute);
  return out;
}

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria del restaurante. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** '2026-12-24' → '24/12/2026'. */
export function formatDateEs(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Cierres que no han terminado, por orden de inicio. */
export function upcomingExceptions<T extends { dateFrom: string; dateTo: string }>(items: T[], today: string, limit = 6): T[] {
  return items
    .filter((e) => e.dateTo >= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
    .slice(0, limit);
}
