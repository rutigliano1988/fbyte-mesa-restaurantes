'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from '@/lib/public/tags';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';

const STATUSES = ['setup', 'active', 'disabled'] as const;

export async function setRestaurantStatus(fd: FormData): Promise<void> {
  await requirePlatformAdmin();
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const status = String(fd.get('status') ?? '') as (typeof STATUSES)[number];
  if (!uuidSchema.safeParse(restaurantId).success || !STATUSES.includes(status)) return;
  const supabase = await createClient();
  const { data: restaurant } = await supabase.from('restaurants').select('slug').eq('id', restaurantId).maybeSingle();
  const { error } = await supabase.rpc('set_restaurant_status', { p_restaurant_id: restaurantId, p_status: status });
  if (error) throw new Error(error.message);
  // La mini-web aparece o desaparece al momento.
  if (restaurant?.slug) updateTag(publicRestaurantTag(restaurant.slug as string));
  updateTag(PUBLIC_ALL_TAG);
  revalidatePath('/admin');
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
}
