'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import { dbError, mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { STATUS_LABELS_ES } from '@/lib/reservations/codes';
import { customerWarnings, type CustomerWarning } from '@/lib/reservations/customers';
import { loadBookingConfig } from '@/lib/reservations/data';
import { serviceDateOf, startFor, startForEdit } from '@/lib/reservations/day';
import { normalizePhoneE164 } from '@/lib/reservations/phone';
import { durationFor } from '@/lib/reservations/settings';
import { phoneReservationSchema, readReservationForm, reservationEditSchema, statusSchema, walkInSchema, type TableMode } from '@/lib/reservations/validation';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction } from './run';

// Las reservas no salen en la web pública: solo se refresca el panel.
const PANEL_ONLY = { publicData: false };
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidSchema.safeParse(value).success;

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}


/** Modo de mesa del formulario → argumentos de la BD: la propuesta (null), las elegidas o forzar sin mesa. */
function tableArgs(mode: TableMode, tableIds: string[]): { p_table_ids: string[] | null; p_force: boolean } {
  if (mode === 'none') return { p_table_ids: null, p_force: true };
  if (mode === 'auto') return { p_table_ids: null, p_force: false };
  return { p_table_ids: [...new Set(tableIds)], p_force: false };
}

function createdId(data: unknown): string {
  const id = (data as { id?: unknown } | null)?.id;
  return isUuid(id) ? id : '';
}

/** Nueva reserva por teléfono: nace confirmada. Si va bien, vuelve a la vista del día. */
export async function createPhoneReservation(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = phoneReservationSchema.safeParse(readReservationForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const created = { id: '' };
  const result = await runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const config = await loadBookingConfig(supabase, restaurantId);
      const { data, error } = await supabase.rpc('create_panel_reservation', {
        p_restaurant_id: restaurantId,
        p_starts_at: new Date(startFor(config, d.date, d.time)).toISOString(),
        p_duration_min: d.duration,
        p_party_size: d.partySize,
        ...tableArgs(d.tableMode, d.tableIds),
        p_customer_name: d.name,
        p_customer_phone: d.phone,
        p_customer_email: d.email,
        p_notes: d.notes,
        p_internal_notes: d.internalNotes,
      });
      if (error) return { error: dbError('reservas.createPhoneReservation', error) };
      created.id = createdId(data);
      if (!created.id) console.error('[reservas.createPhoneReservation] la BD no ha devuelto un id válido');
      return created.id ? { success: 'Reserva guardada.' } : { error: mapDbError(undefined) };
    },
    PANEL_ONLY,
  );
  if (created.id) redirect(`/panel/${restaurantId}/reservas?fecha=${d.date}&aviso=creada`);
  return result;
}

/** Cambia hora, personas, duración, mesas y notas. Duración vacía = la de su tramo. */
export async function updateReservation(_prev: FormState, fd: FormData): Promise<FormState> {
  const reservationId = field(fd, 'reservationId');
  if (!isUuid(reservationId)) return { error: mapDbError('INVALID_INPUT') };
  const parsed = reservationEditSchema.safeParse(readReservationForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const saved = { ok: false };
  const result = await runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const config = await loadBookingConfig(supabase, restaurantId);
      // Sin cambiar fecha ni hora, se queda en el instante que ya tiene (no se fía del cliente: se lee de la BD).
      const current = await supabase.from('reservations').select('starts_at').eq('id', reservationId).eq('restaurant_id', restaurantId).maybeSingle();
      if (current.error) return { error: dbError('reservas.updateReservation', current.error) };
      const currentMs = current.data ? Date.parse((current.data as { starts_at: string }).starts_at) : NaN;
      const startsAt = startForEdit(config, Number.isFinite(currentMs) ? currentMs : null, d.date, d.time);
      const { error } = await supabase.rpc('update_panel_reservation', {
        p_restaurant_id: restaurantId,
        p_reservation_id: reservationId,
        p_starts_at: new Date(startsAt).toISOString(),
        p_duration_min: d.duration ?? durationFor(d.partySize, config.settings),
        p_party_size: d.partySize,
        ...tableArgs(d.tableMode, d.tableIds),
        p_notes: d.notes,
        p_internal_notes: d.internalNotes,
      });
      if (error) return { error: dbError('reservas.updateReservation', error) };
      saved.ok = true;
      return { success: 'Cambios guardados.' };
    },
    PANEL_ONLY,
  );
  if (saved.ok) redirect(`/panel/${restaurantId}/reservas/${reservationId}?aviso=guardada`);
  return result;
}

/** Walk-in: se sienta ya en la mesa o mesas elegidas. Vuelve al día de servicio de su inicio (de madrugada, la víspera). */
export async function createWalkIn(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = walkInSchema.safeParse({
    partySize: field(fd, 'partySize'),
    tableIds: fd.getAll('tableIds').filter((v): v is string => typeof v === 'string'),
    name: field(fd, 'name'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const created = { id: '', date: '' };
  const result = await runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { data, error } = await supabase.rpc('create_walk_in', {
        p_restaurant_id: restaurantId,
        p_party_size: d.partySize,
        p_table_ids: [...new Set(d.tableIds)],
        p_duration_min: null,
        p_customer_name: d.name,
      });
      if (error) return { error: dbError('reservas.createWalkIn', error) };
      created.id = createdId(data);
      if (!created.id) {
        console.error('[reservas.createWalkIn] la BD no ha devuelto un id válido');
        return { error: mapDbError(undefined) };
      }
      const config = await loadBookingConfig(supabase, restaurantId);
      const startedAt = Date.parse(String((data as { starts_at?: unknown }).starts_at));
      created.date = serviceDateOf(Number.isFinite(startedAt) ? startedAt : Date.now(), config.timezone, config.services, config.exceptions);
      return { success: 'Sentados.' };
    },
    PANEL_ONLY,
  );
  // Si el walk-in se ha creado, se vuelve a la vista del día aunque luego algo falle (sin fecha: la de hoy).
  if (created.id) redirect(`/panel/${restaurantId}/reservas?${created.date ? `fecha=${created.date}&` : ''}aviso=walk-in`);
  return result;
}

/** Botones de estado (Confirmar, Sentar, Finalizar, No ha venido, Cancelar…). */
export async function changeReservationStatus(restaurantId: string, reservationId: string, status: string): Promise<FormState> {
  const parsed = statusSchema.safeParse(status);
  if (!isUuid(reservationId) || !parsed.success) return { error: mapDbError('INVALID_INPUT') };
  return runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { error } = await supabase.rpc('set_reservation_status', {
        p_restaurant_id: restaurantId,
        p_reservation_id: reservationId,
        p_status: parsed.data,
      });
      return error ? { error: dbError('reservas.changeReservationStatus', error) } : { success: `Hecho: ${STATUS_LABELS_ES[parsed.data]}.` };
    },
    PANEL_ONLY,
  );
}

const UNDO_TABLE_TAKEN = 'No se puede deshacer: esa mesa ya está ocupada o bloqueada a esa hora. Crea una reserva nueva.';

/** «Deshacer»: vuelve al estado anterior si la mesa sigue libre. */
export async function undoReservationStatus(restaurantId: string, reservationId: string): Promise<FormState> {
  if (!isUuid(reservationId)) return { error: mapDbError('INVALID_INPUT') };
  return runPanelAction(
    restaurantId,
    'reservations.manage',
    async (supabase) => {
      const { data, error } = await supabase.rpc('undo_reservation_status', { p_restaurant_id: restaurantId, p_reservation_id: reservationId });
      if (error) {
        return { error: /SLOT_TAKEN|TABLE_BLOCKED/.test(error.message) ? UNDO_TABLE_TAKEN : dbError('reservas.undoReservationStatus', error) };
      }
      const back = statusSchema.safeParse(data);
      return { success: back.success ? `Deshecho: vuelve a «${STATUS_LABELS_ES[back.data]}».` : 'Deshecho.' };
    },
    PANEL_ONLY,
  );
}

/** `invalid`: el teléfono no se puede normalizar (no se ha buscado). */
export type CustomerLookup = { customer: { name: string; email: string | null; warnings: CustomerWarning[] } | null; error?: string; invalid?: boolean };

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tags: string[];
  visits_count: number;
  no_show_count: number;
  cancel_count: number;
};

/** Busca al cliente por su teléfono (normalizado) para rellenar el nombre y enseñar sus avisos. */
export async function lookupCustomer(restaurantId: string, phone: string): Promise<CustomerLookup> {
  const e164 = typeof phone === 'string' ? normalizePhoneE164(phone) : null;
  if (!isUuid(restaurantId)) return { customer: null };
  if (!e164) return { customer: null, invalid: true };
  try {
    await requirePermission(restaurantId, 'reservations.manage');
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, email, tags, visits_count, no_show_count, cancel_count')
      .eq('restaurant_id', restaurantId)
      .eq('phone', e164)
      .maybeSingle();
    if (error) {
      return { customer: null, error: dbError('reservas.lookupCustomer', error) };
    }
    const c = data as CustomerRow | null;
    if (!c) return { customer: null };
    const tags = (['vip', 'regular', 'problem'] as const).filter((t) => c.tags.includes(t));
    return {
      customer: {
        name: c.name,
        email: c.email,
        warnings: customerWarnings({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          tags,
          visitsCount: c.visits_count,
          noShowCount: c.no_show_count,
          cancelCount: c.cancel_count,
        }),
      },
    };
  } catch (e) {
    unstable_rethrow(e);
    return { customer: null, error: dbError('reservas.lookupCustomer', e instanceof Error ? e : undefined) };
  }
}
