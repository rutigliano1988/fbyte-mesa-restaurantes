import { MINUTES_PER_DAY } from '@/lib/schedule';
import { COUNTED_STATUSES, type ReservationStatus } from './codes';
import { addDays, localParts, serviceDayMinute, weekdayOf, zonedTimeToUtc } from './time';

/** Servicio de la semana tal como se guarda (Hito 2 + los dos campos del Hito 4A). */
export type ServiceConfig = {
  id?: string;
  name: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  lastBookingMinute: number | null;
  slotIntervalMin: number;
};

export type ExceptionConfig = {
  dateFrom: string;
  dateTo: string;
  kind: 'closed' | 'custom';
  customServices: { name: string; startMinute: number; endMinute: number }[];
};

/** Un servicio de un día concreto, con la última hora de reserva ya resuelta. key: su minuto de inicio. */
export type DayService = {
  key: string;
  name: string;
  startMinute: number;
  endMinute: number;
  lastBookingMinute: number;
  slotIntervalMin: number;
};

/** Última hora de reserva: la guardada o, si falta, una hora antes del cierre (sin bajar del inicio). */
export function effectiveLastBooking(startMinute: number, endMinute: number, lastBookingMinute: number | null): number {
  return lastBookingMinute ?? Math.max(startMinute, endMinute - 60);
}

function daySlot(name: string, startMinute: number, endMinute: number, last: number | null, interval: number): DayService {
  return {
    key: String(startMinute),
    name,
    startMinute,
    endMinute,
    lastBookingMinute: effectiveLastBooking(startMinute, endMinute, last),
    slotIntervalMin: interval === 30 ? 30 : 15,
  };
}

/** Servicios de una fecha: los de su día de la semana, salvo cierre (ninguno) u horario especial (los suyos). */
export function servicesForDate(date: string, services: readonly ServiceConfig[], exceptions: readonly ExceptionConfig[]): DayService[] {
  const exception = exceptions.find((e) => e.dateFrom <= date && date <= e.dateTo);
  const list = exception
    ? exception.customServices.map((s) => daySlot(s.name, s.startMinute, s.endMinute, null, 15))
    : services
        .filter((s) => s.weekday === weekdayOf(date))
        .map((s) => daySlot(s.name, s.startMinute, s.endMinute, s.lastBookingMinute, s.slotIntervalMin));
  return exception?.kind === 'closed' ? [] : list.sort((a, b) => a.startMinute - b.startMinute);
}

/** Horas en que se puede reservar: del inicio a la última hora de reserva, cada intervalo. */
export function slotMinutes(s: DayService): number[] {
  const out: number[] = [];
  for (let m = s.startMinute; m <= s.lastBookingMinute; m += s.slotIntervalMin) out.push(m);
  return out;
}

/** El servicio cuya franja contiene ese minuto del día (inicio incluido, fin excluido). */
export function serviceAt(minute: number, services: readonly DayService[]): DayService | null {
  return services.find((s) => minute >= s.startMinute && minute < s.endMinute) ?? null;
}

/**
 * Hora escrita a mano (0–1439) → minuto del día de servicio: una hora de madrugada que cae dentro de un servicio de
 * ese día que pasa de medianoche es de la noche (00:30 → 1470); si no, se queda como está.
 */
export function resolveMinute(minute: number, services: readonly DayService[]): number {
  const late = minute + MINUTES_PER_DAY;
  return services.some((s) => s.endMinute > MINUTES_PER_DAY && late >= s.startMinute && late < s.endMinute) ? late : minute;
}

export type ServiceGroup<T> = { service: DayService; items: T[] };

/**
 * Reparte las reservas de un día de servicio: cada una, en el servicio cuya franja contiene su hora de inicio; las de
 * la madrugada que son de la cena de la víspera no cuentan para este día; las que no caen en ningún servicio, a
 * «Fuera de horario». `items` puede traer de más (la ventana de 00:00 a 06:00 del día siguiente).
 */
export function groupByService<T extends { startMs: number }>(
  items: readonly T[],
  date: string,
  timeZone: string,
  today: readonly DayService[],
  yesterday: readonly DayService[],
): { groups: ServiceGroup<T>[]; outside: T[] } {
  const groups = today.map((service) => ({ service, items: [] as T[] }));
  const outside: T[] = [];
  for (const item of items) {
    const minute = serviceDayMinute(item.startMs, date, timeZone);
    if (minute === null) continue;
    if (minute < MINUTES_PER_DAY && serviceAt(minute + MINUTES_PER_DAY, yesterday)) continue;
    const service = serviceAt(minute, today);
    if (service) groups.find((g) => g.service.key === service.key)?.items.push(item);
    else if (minute < MINUTES_PER_DAY) outside.push(item);
  }
  return { groups, outside };
}

export type DaySummary = { reservations: number; covers: number; pending: number };

/** Resumen de un servicio: reservas y personas (sin canceladas, rechazadas ni no-shows) y pendientes. */
export function summarize(items: readonly { status: ReservationStatus; partySize: number }[]): DaySummary {
  const counted = items.filter((r) => COUNTED_STATUSES.includes(r.status));
  return {
    reservations: counted.length,
    covers: counted.reduce((n, r) => n + r.partySize, 0),
    pending: items.filter((r) => r.status === 'pending').length,
  };
}

/**
 * Día de servicio de una reserva: el de su fecha local, salvo si es de madrugada y cae en la cena de la víspera
 * que pasa de medianoche.
 */
export function serviceDateOf(
  startMs: number,
  timeZone: string,
  services: readonly ServiceConfig[],
  exceptions: readonly ExceptionConfig[],
): string {
  const { date, minute } = localParts(startMs, timeZone);
  const yesterday = addDays(date, -1);
  return serviceAt(minute + MINUTES_PER_DAY, servicesForDate(yesterday, services, exceptions)) ? yesterday : date;
}

type StartConfig = { timezone: string; services: readonly ServiceConfig[]; exceptions: readonly ExceptionConfig[] };

/** Fecha y hora del formulario → instante (la madrugada de una cena que pasa de medianoche es de esa noche). */
export function startFor(config: StartConfig, date: string, minute: number): number {
  return zonedTimeToUtc(date, resolveMinute(minute, servicesForDate(date, config.services, config.exceptions)), config.timezone);
}

/** ¿La fecha (día de servicio) y la hora (HH:MM local) del formulario son las del instante actual de la reserva? */
export function keepsStart(currentMs: number, currentDate: string, date: string, minute: number, timeZone: string): boolean {
  return currentDate === date && localParts(currentMs, timeZone).minute === minute;
}

/**
 * Inicio al cambiar una reserva: si no cambian ni la fecha ni la hora, el instante que ya tiene (una reserva de
 * madrugada que no es de la cena de la víspera no se mueve 24 h, y un walk-in conserva su minuto); si cambian, el
 * cálculo de siempre.
 */
export function startForEdit(config: StartConfig, currentMs: number | null, date: string, minute: number): number {
  if (currentMs !== null && keepsStart(currentMs, serviceDateOf(currentMs, config.timezone, config.services, config.exceptions), date, minute, config.timezone)) {
    return currentMs;
  }
  return startFor(config, date, minute);
}
