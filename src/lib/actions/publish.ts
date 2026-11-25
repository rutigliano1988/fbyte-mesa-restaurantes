'use server';

import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { DPA_VERSION } from '@/lib/legal/dpa';
import { publishSchema } from '@/lib/validation/local';
import { runPanelAction } from './run';

export async function publishRestaurant(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = publishSchema.safeParse({ accept: fd.get('accept') ?? undefined });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = String(fd.get('restaurantId') ?? '');
  return runPanelAction(
    restaurantId,
    'restaurant.edit',
    async (supabase) => {
      const { error } = await supabase.rpc('publish_restaurant', {
        p_restaurant_id: restaurantId,
        p_dpa_version: DPA_VERSION,
      });
      if (error) return { error: mapDbError(error.message) };
      return { success: '¡Hecho! Tu web ya está publicada.' };
    },
    { allPublic: true },
  );
}
