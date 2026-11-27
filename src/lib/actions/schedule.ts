'use server';

import { dbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { serviceBookingSchema } from '@/lib/reservations/validation';
import { findOverlap, formatRange, isWeekday, WEEKDAY_LABELS_ES, type ServiceSlot } from '@/lib/schedule';
import { exceptionSchema, newServicesSchema, serviceSchema } from '@/lib/validation/schedule';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError, type SupabaseServerClient } from './run';

type ServiceRow = { id: string; name: string; weekday: number; start_minute: number; end_minute: number };

async function loadServices(supabase: SupabaseServerClient, restaurantId: string): Promise<ServiceSlot[] | null> {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, weekday, start_minute, end_minute')
    .eq('restaurant_id', restaurantId);
  if (error) {
    dbError('loadServices', error);
    return null;
  }
  return ((data ?? []) as ServiceRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    weekday: s.weekday,
    startMinute: s.start_minute,
    endMinute: s.end_minute,
  }));
}

function overlapMessage(clash: ServiceSlot): string {
  const day = isWeekday(clash.weekday) ? WEEKDAY_LABELS_ES[clash.weekday].toLowerCase() : '';
  return `Se solapa con «${clash.name}» del ${day} (${formatRange(clash.startMinute, clash.endMinute)}).`;
}

/** Última hora de reserva e intervalo (Hito 4A), una vez validadas las horas del servicio. */
function parseBooking(fd: FormData, range: { startMinute: number; endMinute: number }) {
  return serviceBookingSchema(range).safeParse(formStrings(fd, ['lastBooking', 'slotInterval']));
}

export async function addServices(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = newServicesSchema.safeParse({ ...formStrings(fd, ['name', 'start', 'end']), weekdays: fd.getAll('weekdays') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { name, weekdays, startMinute, endMinute } = parsed.data;
  const booking = parseBooking(fd, parsed.data);
  if (!booking.success) return { fieldErrors: fieldErrorsFrom(booking.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const slots = await loadServices(supabase, restaurantId);
    if (!slots) return { error: dbError('addServices', undefined) };
    for (const weekday of weekdays) {
      const candidate = { name, weekday, startMinute, endMinute };
      const clash = findOverlap(slots, candidate);
      if (clash) return { fieldErrors: { start: overlapMessage(clash) } };
      slots.push(candidate);
    }
    const { error } = await supabase.from('services').insert(
      weekdays.map((weekday) => ({
        restaurant_id: restaurantId,
        name,
        weekday,
        start_minute: startMinute,
        end_minute: endMinute,
        last_booking_minute: booking.data.lastBookingMinute,
        slot_interval_min: booking.data.slotIntervalMin,
      })),
    );
    if (error) return { error: dbError('addServices', error) };
    return { success: weekdays.length === 1 ? 'Servicio añadido.' : `Servicio añadido en ${weekdays.length} días.` };
  });
}

export async function updateService(_prev: FormState, fd: FormData): Promise<FormState> {
  const serviceId = String(fd.get('serviceId') ?? '');
  if (!uuidSchema.safeParse(serviceId).success) return { error: dbError('updateService', { message: 'id de servicio no válido' }) };
  const parsed = serviceSchema.safeParse(formStrings(fd, ['name', 'start', 'end']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const booking = parseBooking(fd, parsed.data);
  if (!booking.success) return { fieldErrors: fieldErrorsFrom(booking.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const slots = await loadServices(supabase, restaurantId);
    const current = slots?.find((s) => s.id === serviceId);
    if (!slots || !current) return { error: dbError('updateService', { message: 'FORBIDDEN' }) };
    const clash = findOverlap(slots, { ...current, ...parsed.data });
    if (clash) return { fieldErrors: { start: overlapMessage(clash) } };
    const { error } = await supabase
      .from('services')
      .update({
        name: parsed.data.name,
        start_minute: parsed.data.startMinute,
        end_minute: parsed.data.endMinute,
        last_booking_minute: booking.data.lastBookingMinute,
        slot_interval_min: booking.data.slotIntervalMin,
      })
      .eq('id', serviceId)
      .eq('restaurant_id', restaurantId);
    if (error) return { error: dbError('updateService', error) };
    return { success: 'Servicio guardado.' };
  });
}

export async function deleteService(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const serviceId = String(fd.get('serviceId') ?? '');
  if (!uuidSchema.safeParse(serviceId).success) return;
  const result = await runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const { error } = await supabase.from('services').delete().eq('id', serviceId).eq('restaurant_id', restaurantId);
    return error ? { error: dbError('deleteService', error) } : { success: 'Servicio quitado.' };
  });
  throwIfError(result);
}

export async function addException(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = exceptionSchema.safeParse(
    formStrings(fd, ['dateFrom', 'dateTo', 'kind', 'note', 'name1', 'start1', 'end1', 'name2', 'start2', 'end2']),
  );
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const { error } = await supabase.from('schedule_exceptions').insert({
      restaurant_id: restaurantId,
      date_from: d.dateFrom,
      date_to: d.dateTo,
      kind: d.kind,
      custom_services: d.customServices,
      note: d.note,
    });
    if (error) return { error: dbError('addException', error) };
    return { success: d.kind === 'closed' ? 'Cierre guardado.' : 'Horario especial guardado.' };
  });
}

export async function deleteException(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const exceptionId = String(fd.get('exceptionId') ?? '');
  if (!uuidSchema.safeParse(exceptionId).success) return;
  const result = await runPanelAction(restaurantId, 'settings.booking', async (supabase) => {
    const { error } = await supabase
      .from('schedule_exceptions')
      .delete()
      .eq('id', exceptionId)
      .eq('restaurant_id', restaurantId);
    return error ? { error: dbError('deleteException', error) } : { success: 'Quitado.' };
  });
  throwIfError(result);
}
