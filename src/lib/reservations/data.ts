import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseServerClient } from '@/lib/actions/run';
import type { BookingTable } from './availability';
import type { ExceptionConfig, ServiceConfig } from './day';
import {
  parseBookingDay,
  toBookingSettings,
  toBookingTables,
  toExceptionConfigs,
  toServiceConfigs,
  type BookingDayData,
  type ExceptionRow,
  type ServiceRow,
  type SettingsRow,
  type TableRow,
  type ZoneRow,
} from './rows';
import type { BookingSettings } from './settings';
import { serviceDayWindow } from './time';

export type RestaurantTimeZone = 'Europe/Madrid' | 'Atlantic/Canary';

export type BookingConfig = {
  timezone: RestaurantTimeZone;
  zones: ZoneRow[];
  tables: BookingTable[];
  settings: BookingSettings;
  services: ServiceConfig[];
  exceptions: ExceptionConfig[];
};

/** Zonas, mesas (también las desactivadas), ajustes, servicios y excepciones, con la sesión del usuario (RLS). */
export async function loadBookingConfig(supabase: SupabaseServerClient, restaurantId: string): Promise<BookingConfig> {
  const [restaurant, zones, tables, settings, services, exceptions] = await Promise.all([
    supabase.from('restaurants').select('timezone').eq('id', restaurantId).single(),
    supabase.from('zones').select('id, name, position').eq('restaurant_id', restaurantId).order('position').order('name'),
    supabase
      .from('tables')
      .select('id, zone_id, name, min_capacity, max_capacity, online_bookable, active, position')
      .eq('restaurant_id', restaurantId)
      .order('position')
      .order('name'),
    supabase
      .from('booking_settings')
      .select('default_duration_min, duration_rules, min_advance_min, max_advance_days, max_online_party, cancel_limit_hours, auto_confirm')
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
    supabase
      .from('services')
      .select('id, name, weekday, start_minute, end_minute, last_booking_minute, slot_interval_min')
      .eq('restaurant_id', restaurantId)
      .order('weekday')
      .order('start_minute'),
    supabase.from('schedule_exceptions').select('date_from, date_to, kind, custom_services').eq('restaurant_id', restaurantId).order('date_from'),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`restaurants: ${restaurant.error?.message ?? 'sin datos'}`);
  for (const [table, res] of [
    ['zones', zones],
    ['tables', tables],
    ['booking_settings', settings],
    ['services', services],
    ['schedule_exceptions', exceptions],
  ] as const) {
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
  }
  const zoneRows = (zones.data ?? []) as ZoneRow[];
  return {
    timezone: (restaurant.data as { timezone: RestaurantTimeZone }).timezone,
    zones: zoneRows,
    tables: toBookingTables(zoneRows, (tables.data ?? []) as TableRow[]),
    settings: toBookingSettings((settings.data ?? null) as SettingsRow | null),
    services: toServiceConfigs((services.data ?? []) as ServiceRow[]),
    exceptions: toExceptionConfigs((exceptions.data ?? []) as ExceptionRow[]),
  };
}

export async function getBookingConfig(restaurantId: string): Promise<BookingConfig> {
  return loadBookingConfig(await createClient(), restaurantId);
}

/** Reservas que empiezan en el día de servicio `date` (de las 00:00 a las 06:00 del día siguiente) y lo que ocupa mesas. */
export async function getBookingDay(restaurantId: string, date: string, timeZone: string): Promise<BookingDayData> {
  const supabase = await createClient();
  const window = serviceDayWindow(date, timeZone);
  const { data, error } = await supabase.rpc('get_booking_day', {
    p_restaurant_id: restaurantId,
    p_from: new Date(window.from).toISOString(),
    p_to: new Date(window.to).toISOString(),
  });
  if (error) throw new Error(`get_booking_day: ${error.message}`);
  return parseBookingDay(data);
}

/** Inicio de una reserva del restaurante (para saber de qué día es), o null si no es suya. */
export async function getReservationStart(restaurantId: string, reservationId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reservations')
    .select('starts_at')
    .eq('id', reservationId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error) throw new Error(`reservations: ${error.message}`);
  return data ? Date.parse((data as { starts_at: string }).starts_at) : null;
}

/** Cuántas mesas tiene el restaurante (para el asistente de bienvenida). */
export async function countTables(restaurantId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId);
  if (error) throw new Error(`tables: ${error.message}`);
  return count ?? 0;
}
