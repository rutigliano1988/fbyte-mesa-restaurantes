import { formatDateEs, formatRange, isWeekday, MINUTES_PER_DAY, WEEKDAY_LABELS_ES } from '@/lib/schedule';
import type { MenuKind } from './codes';

/** Programación de una carta (la carta, «carta», no tiene). Días ISO 1 = lunes … 7 = domingo. */
export type MenuSchedule = {
  kind: MenuKind;
  weekdays: number[] | null;
  startMinute: number | null;
  endMinute: number | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type LocalMoment = { date: string; weekday: number; minute: number };

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Fecha (AAAA-MM-DD), día ISO y minuto del día de un instante en una zona horaria (con el cambio de hora). */
export function localMoment(now: Date, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_INDEX[get('weekday')],
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function previousDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** ¿Ese día (fecha y día de la semana) entra en la programación? */
function dayMatches(s: MenuSchedule, date: string, weekday: number): boolean {
  if (s.dateFrom && s.dateTo && (date < s.dateFrom || date > s.dateTo)) return false;
  return (s.weekdays ?? []).includes(weekday);
}

/**
 * ¿Se ve ahora? La carta, siempre. El menú del día y el especial, si hoy (en la zona del restaurante) está en sus
 * fechas, es uno de sus días y la hora está en su franja (de inicio incluido a fin excluido). Una franja que pasa
 * de medianoche cuenta para el día en que empieza.
 */
export function isMenuVisibleAt(s: MenuSchedule, now: Date, timeZone: string): boolean {
  if (s.kind === 'carta') return true;
  const t = localMoment(now, timeZone);
  if (s.startMinute === null || s.endMinute === null) return dayMatches(s, t.date, t.weekday);
  if (dayMatches(s, t.date, t.weekday) && t.minute >= s.startMinute && t.minute < s.endMinute) return true;
  // De madrugada: la franja de ayer que pasa de medianoche.
  if (s.endMinute > MINUTES_PER_DAY && t.minute < s.endMinute - MINUTES_PER_DAY) {
    const yesterday = t.weekday === 1 ? 7 : t.weekday - 1;
    return dayMatches(s, previousDate(t.date), yesterday);
  }
  return false;
}

/** Cartas que se ven ahora: primero los menús del día y especiales, luego las cartas; cada grupo, en su orden. */
export function visibleMenus<T extends MenuSchedule>(menus: readonly T[], now: Date, timeZone: string): T[] {
  const visible = menus.filter((m) => isMenuVisibleAt(m, now, timeZone));
  return [...visible.filter((m) => m.kind !== 'carta'), ...visible.filter((m) => m.kind === 'carta')];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** [1,2,3,4,5] → 'De lunes a viernes'; [6,7] → 'Sábado y domingo'; [1,3,5] → 'Lunes, miércoles y viernes'. */
export function weekdaysSummaryEs(weekdays: readonly number[]): string {
  const days = [...new Set(weekdays)].filter(isWeekday).sort((a, b) => a - b);
  if (days.length === 7) return 'Todos los días';
  if (days.length === 0) return 'Ningún día';
  const names = days.map((d) => WEEKDAY_LABELS_ES[d].toLowerCase());
  const consecutive = days.length >= 3 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive) return `De ${names[0]} a ${names[names.length - 1]}`;
  if (names.length === 1) return capitalize(names[0]);
  return capitalize(`${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`);
}

/** Para el panel: 'De lunes a viernes · 13:00–16:00 · Del 01/12/2026 al 31/12/2026'. */
export function scheduleSummaryEs(s: MenuSchedule): string {
  if (s.kind === 'carta') return 'Siempre visible';
  const parts = [weekdaysSummaryEs(s.weekdays ?? [])];
  parts.push(s.startMinute !== null && s.endMinute !== null ? formatRange(s.startMinute, s.endMinute) : 'Todo el día');
  if (s.dateFrom && s.dateTo) {
    parts.push(s.dateFrom === s.dateTo ? `El ${formatDateEs(s.dateFrom)}` : `Del ${formatDateEs(s.dateFrom)} al ${formatDateEs(s.dateTo)}`);
  }
  return parts.join(' · ');
}
