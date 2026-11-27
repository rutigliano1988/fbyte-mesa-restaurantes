import { formatDateEs, isWeekday, MINUTES_PER_DAY, WEEKDAY_LABELS_ES } from '@/lib/schedule';

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** La hora de pared de un instante, como si fuera UTC (ms, sin segundos). */
function wallClock(ms: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
}

function offsetAt(ms: number, timeZone: string): number {
  return wallClock(ms, timeZone) - Math.floor(ms / MINUTE) * MINUTE;
}

/** '2026-03-28' + 1 → '2026-03-29'. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Día ISO de una fecha: 1 = lunes … 7 = domingo. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Fecha local + minuto (puede pasar de 1440: es del día siguiente) → instante (ms) en esa zona horaria.
 * Como PostgreSQL: una hora que no existe (al adelantar el reloj) usa la diferencia de antes del cambio, y una
 * que existe dos veces (al atrasarlo), la de la hora de invierno.
 */
export function zonedTimeToUtc(date: string, minute: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d) + minute * MINUTE;
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const valid = [...new Set([before, after])].filter((o) => wallClock(wall - o, timeZone) === wall);
  if (valid.length === 1) return wall - valid[0];
  if (valid.length > 1) return wall - Math.min(...valid);
  return wall - before;
}

/** Fecha local (AAAA-MM-DD) y minuto del día de un instante. */
export function localParts(ms: number, timeZone: string): { date: string; minute: number } {
  const wall = wallClock(ms, timeZone);
  return { date: new Date(wall).toISOString().slice(0, 10), minute: Math.floor((wall % DAY) / MINUTE) };
}

/**
 * Minuto de un instante contado desde el inicio de `date` (zona del restaurante): los de la madrugada del día
 * siguiente siguen contando (1470 = 00:30). null si es de otro día.
 */
export function serviceDayMinute(ms: number, date: string, timeZone: string): number | null {
  const p = localParts(ms, timeZone);
  if (p.date === date) return p.minute;
  if (p.date === addDays(date, 1)) return p.minute + MINUTES_PER_DAY;
  return null;
}

/** Instante → '21:30' en la zona del restaurante. */
export function formatTime(ms: number, timeZone: string): string {
  const { minute } = localParts(ms, timeZone);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** '2030-06-14' → 'Viernes 14/06/2030'. */
export function formatDayEs(date: string): string {
  const weekday = weekdayOf(date);
  return `${isWeekday(weekday) ? WEEKDAY_LABELS_ES[weekday] : ''} ${formatDateEs(date)}`.trim();
}

/** Desde las 00:00 de `date` hasta las 06:00 del día siguiente: ahí empiezan todas las reservas de sus servicios. */
export function serviceDayWindow(date: string, timeZone: string): { from: number; to: number } {
  return { from: zonedTimeToUtc(date, 0, timeZone), to: zonedTimeToUtc(date, 1800, timeZone) };
}

/** ?fecha= de la URL: una fecha real AAAA-MM-DD o, si no, la de por defecto (también si llega repetida). */
export function dateParam(value: string | string[] | undefined, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : fallback;
}
