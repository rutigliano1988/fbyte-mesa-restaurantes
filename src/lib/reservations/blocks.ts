import { MINUTES_PER_DAY } from '@/lib/schedule';
import { resolveMinute, servicesForDate, type ExceptionConfig, type ServiceConfig } from './day';
import { zonedTimeToUtc } from './time';

type BlockConfig = { timezone: string; services: readonly ServiceConfig[]; exceptions: readonly ExceptionConfig[] };

/**
 * Franja de un bloqueo → instantes. La fecha es el día de servicio: una hora de madrugada dentro de una cena que pasa
 * de medianoche es de esa noche (como en las reservas) y el fin conserva la duración. «Todo el día» (0–1440) no cambia.
 */
export function blockRange(config: BlockConfig, date: string, startMinute: number, endMinute: number): { startMs: number; endMs: number } {
  const allDay = startMinute === 0 && endMinute === MINUTES_PER_DAY;
  const start = allDay ? startMinute : resolveMinute(startMinute, servicesForDate(date, config.services, config.exceptions));
  const end = start + (endMinute - startMinute);
  return { startMs: zonedTimeToUtc(date, start, config.timezone), endMs: zonedTimeToUtc(date, end, config.timezone) };
}
