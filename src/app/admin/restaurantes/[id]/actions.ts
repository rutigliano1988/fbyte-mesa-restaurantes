'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';

const STATUSES = ['setup', 'active', 'disabled'] as const;

export async function setRestaurantStatus(fd: FormData): Promise<void> {
  await requirePlatformAdmin();
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const status = String(fd.get('status') ?? '') as (typeof STATUSES)[number];
  if (!uuidSchema.safeParse(restaurantId).success || !STATUSES.includes(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_restaurant_status', { p_restaurant_id: restaurantId, p_status: status });
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
}
