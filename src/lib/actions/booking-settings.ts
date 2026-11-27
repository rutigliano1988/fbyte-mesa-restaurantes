'use server';

import { dbError, mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { confirmSchema } from '@/lib/menu/validation';
import { bookingSettingsSchema, readSettingsForm, TABLE_FORM_FIELDS, tableFormSchema, zoneFormSchema } from '@/lib/reservations/validation';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, type SupabaseServerClient } from './run';

// Nada de esto sale en la web pública: solo se refresca el panel.
const PANEL_ONLY = { publicData: false };
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidSchema.safeParse(value).success;

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

type Table = 'zones' | 'tables';

/** UPDATE o DELETE de una fila del restaurante con la sesión del usuario; 0 filas → sin permiso. */
async function changeOne(
  supabase: SupabaseServerClient,
  context: string,
  table: Table,
  id: string,
  restaurantId: string,
  values: Record<string, unknown> | null,
  success: string,
): Promise<FormState> {
  const query = values ? supabase.from(table).update(values) : supabase.from(table).delete();
  const { data, error } = await query.eq('id', id).eq('restaurant_id', restaurantId).select('id');
  if (error) return { error: dbError(context, error) };
  if (!data?.length) return { error: mapDbError('FORBIDDEN') };
  return { success };
}

// Zonas -----------------------------------------------------------------------------------------------------
export async function createZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = zoneFormSchema.safeParse(formStrings(fd, ['name', 'position']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const { error } = await supabase.from('zones').insert({ restaurant_id: restaurantId, ...parsed.data });
      return error ? { error: dbError('createZone', error) } : { success: 'Zona creada.' };
    },
    PANEL_ONLY,
  );
}

export async function updateZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const zoneId = field(fd, 'zoneId');
  if (!isUuid(zoneId)) return { error: mapDbError(undefined) };
  const parsed = zoneFormSchema.safeParse(formStrings(fd, ['name', 'position']));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'updateZone', 'zones', zoneId, restaurantId, parsed.data, 'Zona guardada.'), PANEL_ONLY);
}

export async function deleteZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const zoneId = field(fd, 'zoneId');
  if (!isUuid(zoneId)) return { error: mapDbError(undefined) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'deleteZone', 'zones', zoneId, restaurantId, null, 'Zona borrada.'), PANEL_ONLY);
}

// Mesas -----------------------------------------------------------------------------------------------------
/** La zona elegida (del restaurante: lo garantiza la clave foránea compuesta) o, si el restaurante aún no tiene ninguna, «Sala», que se crea al momento. */
async function zoneForNewTable(
  supabase: SupabaseServerClient,
  restaurantId: string,
  zoneId: string | null,
): Promise<{ id: string } | { error: FormState }> {
  if (zoneId) return { id: zoneId };
  const { data, error } = await supabase.from('zones').select('id').eq('restaurant_id', restaurantId).limit(1);
  if (error) return { error: { error: dbError('createTable', error) } };
  if (data?.length) return { error: { fieldErrors: { zoneId: 'Elige una zona.' } } };
  const created = await supabase.from('zones').insert({ restaurant_id: restaurantId, name: 'Sala', position: 0 }).select('id').single();
  if (created.error) return { error: { error: dbError('createTable', created.error) } };
  return { id: (created.data as { id: string }).id };
}

export async function createTable(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = tableFormSchema.safeParse(formStrings(fd, TABLE_FORM_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const t = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const zone = await zoneForNewTable(supabase, restaurantId, t.zoneId);
      if ('error' in zone) return zone.error;
      const { error } = await supabase.from('tables').insert({
        restaurant_id: restaurantId,
        zone_id: zone.id,
        name: t.name,
        min_capacity: t.minCapacity,
        max_capacity: t.maxCapacity,
        position: t.position,
        online_bookable: t.onlineBookable,
        active: t.active,
      });
      return error ? { error: dbError('createTable', error) } : { success: `Mesa ${t.name} creada.` };
    },
    PANEL_ONLY,
  );
}

export async function updateTable(_prev: FormState, fd: FormData): Promise<FormState> {
  const tableId = field(fd, 'tableId');
  if (!isUuid(tableId)) return { error: mapDbError(undefined) };
  const parsed = tableFormSchema.safeParse(formStrings(fd, TABLE_FORM_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const t = parsed.data;
  if (!t.zoneId) return { fieldErrors: { zoneId: 'Elige una zona.' } };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    (supabase) =>
      changeOne(
        supabase,
        'updateTable',
        'tables',
        tableId,
        restaurantId,
        {
          zone_id: t.zoneId,
          name: t.name,
          min_capacity: t.minCapacity,
          max_capacity: t.maxCapacity,
          position: t.position,
          online_bookable: t.onlineBookable,
          active: t.active,
        },
        'Mesa guardada.',
      ),
    PANEL_ONLY,
  );
}

export async function deleteTable(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const tableId = field(fd, 'tableId');
  if (!isUuid(tableId)) return { error: mapDbError(undefined) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'settings.booking', (supabase) => changeOne(supabase, 'deleteTable', 'tables', tableId, restaurantId, null, 'Mesa borrada.'), PANEL_ONLY);
}

// Duración y reglas -----------------------------------------------------------------------------------------
export async function saveBookingSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = bookingSettingsSchema.safeParse(readSettingsForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const s = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  const values = {
    default_duration_min: s.defaultDurationMin,
    duration_rules: s.durationRules.map((r) => ({ min_party: r.minParty, max_party: r.maxParty, duration_min: r.durationMin })),
    min_advance_min: s.minAdvanceMin,
    max_advance_days: s.maxAdvanceDays,
    max_online_party: s.maxOnlineParty,
    cancel_limit_hours: s.cancelLimitHours,
    auto_confirm: s.autoConfirm,
  };
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      // La fila se crea al guardar por primera vez (sin upsert: restaurant_id no se actualiza nunca).
      const updated = await supabase.from('booking_settings').update(values).eq('restaurant_id', restaurantId).select('restaurant_id');
      if (updated.error) return { error: dbError('saveBookingSettings', updated.error) };
      if (!updated.data?.length) {
        const { error } = await supabase.from('booking_settings').insert({ restaurant_id: restaurantId, ...values });
        if (error) return { error: dbError('saveBookingSettings', error) };
      }
      return { success: 'Ajustes guardados.' };
    },
    PANEL_ONLY,
  );
}
