'use server';

import { dbError, mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { blockRange } from '@/lib/reservations/blocks';
import { loadBookingConfig } from '@/lib/reservations/data';
import { BLOCK_FORM_FIELDS, blockFormSchema } from '@/lib/reservations/validation';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError } from './run';

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

/** Bloquea una mesa (o todo el restaurante) en una franja, con las horas del reloj del restaurante. */
export async function createBlock(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = blockFormSchema.safeParse(formStrings(fd, BLOCK_FORM_FIELDS));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const b = parsed.data;
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const config = await loadBookingConfig(supabase, restaurantId);
      const { startMs, endMs } = blockRange(config, b.date, b.startMinute, b.endMinute);
      // La mesa tiene que ser de este restaurante: lo garantiza la clave foránea compuesta (table_id, restaurant_id).
      const { error } = await supabase.from('blocks').insert({
        restaurant_id: restaurantId,
        table_id: b.tableId,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(endMs).toISOString(),
        reason: b.reason,
      });
      return error ? { error: dbError('createBlock', error) } : { success: 'Bloqueo guardado.' };
    },
    { publicData: false },
  );
}

export async function deleteBlock(fd: FormData): Promise<void> {
  const blockId = field(fd, 'blockId');
  if (!uuidSchema.safeParse(blockId).success) return;
  const restaurantId = field(fd, 'restaurantId');
  const result = await runPanelAction(
    restaurantId,
    'settings.booking',
    async (supabase) => {
      const { data, error } = await supabase.from('blocks').delete().eq('id', blockId).eq('restaurant_id', restaurantId).select('id');
      if (error) return { error: dbError('deleteBlock', error) };
      return data?.length ? { success: 'Bloqueo quitado.' } : { error: mapDbError('FORBIDDEN') };
    },
    { publicData: false },
  );
  throwIfError(result);
}
