'use server';

import { revalidatePath } from 'next/cache';
import type { InviteState } from '@/lib/actions/team';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { mapDbError } from '@/lib/db-errors';
import { sendInvitationEmail } from '@/lib/email/invitation';
import { fieldErrorsFrom } from '@/lib/forms';
import { invitationUrl } from '@/lib/invitations';
import { createClient } from '@/lib/supabase/server';
import { createRestaurantSchema } from '@/lib/validation/schemas';

export type CreateRestaurantState = InviteState & { restaurantId?: string };

export async function createRestaurant(_prev: CreateRestaurantState, fd: FormData): Promise<CreateRestaurantState> {
  await requirePlatformAdmin();
  const parsed = createRestaurantSchema.safeParse({
    name: fd.get('name'),
    slug: fd.get('slug'),
    adminEmail: fd.get('adminEmail'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc('create_restaurant', { p_name: parsed.data.name, p_slug: parsed.data.slug, p_admin_email: parsed.data.adminEmail })
    .single<{ restaurant_id: string; invitation_token: string }>();
  if (error || !data) return { error: mapDbError(error?.message) };

  const url = invitationUrl(data.invitation_token);
  const sent = await sendInvitationEmail({ to: parsed.data.adminEmail, restaurantName: parsed.data.name, role: 'admin', inviteUrl: url });
  revalidatePath('/admin');
  return { success: 'Restaurante creado.', restaurantId: data.restaurant_id, inviteUrl: url, email: parsed.data.adminEmail, emailSent: sent.ok };
}
