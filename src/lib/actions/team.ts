'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getPanelContext, isPlatformAdmin } from '@/lib/auth/guards';
import { mapDbError } from '@/lib/db-errors';
import { sendInvitationEmail } from '@/lib/email/invitation';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { invitationUrl } from '@/lib/invitations';
import { can, ROLES, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { inviteMemberSchema, uuidSchema } from '@/lib/validation/schemas';

export type InviteState = FormState & { inviteUrl?: string; email?: string; emailSent?: boolean };

/** Puede gestionar el equipo: administrador del restaurante (no en modo soporte) o FByte. */
async function assertCanManageTeam(restaurantId: string): Promise<{ restaurantName: string }> {
  if (!uuidSchema.safeParse(restaurantId).success) throw new Error('FORBIDDEN');
  const ctx = await getPanelContext(restaurantId);
  const allowed = ctx.readOnly ? await isPlatformAdmin() : can(ctx.role, 'users.manage') && ctx.restaurant.status !== 'disabled';
  if (!allowed) throw new Error('FORBIDDEN');
  return { restaurantName: ctx.restaurant.name };
}

function revalidateTeam(restaurantId: string) {
  revalidatePath(`/panel/${restaurantId}/usuarios`);
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
}

export async function inviteMember(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const parsed = inviteMemberSchema.safeParse({ email: fd.get('email'), role: fd.get('role') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    const { restaurantName } = await assertCanManageTeam(restaurantId);
    const supabase = await createClient();
    const { data: token, error } = await supabase.rpc('create_invitation', {
      p_restaurant_id: restaurantId,
      p_email: parsed.data.email,
      p_role: parsed.data.role,
    });
    if (error || typeof token !== 'string') return { error: mapDbError(error?.message) };
    const url = invitationUrl(token);
    const sent = await sendInvitationEmail({ to: parsed.data.email, restaurantName, role: parsed.data.role, inviteUrl: url });
    revalidateTeam(restaurantId);
    return { success: 'Invitación creada.', inviteUrl: url, email: parsed.data.email, emailSent: sent.ok };
  } catch (e) {
    unstable_rethrow(e);
    return { error: mapDbError(e instanceof Error ? e.message : undefined) };
  }
}

export async function changeMemberRole(_prev: FormState, fd: FormData): Promise<FormState> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const userId = String(fd.get('userId') ?? '');
  const role = String(fd.get('role') ?? '') as Role;
  if (!ROLES.includes(role)) return { error: 'Elige un rol.' };
  if (!uuidSchema.safeParse(userId).success) return { error: mapDbError(undefined) };
  try {
    await assertCanManageTeam(restaurantId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('restaurant_members')
      .update({ role })
      .eq('restaurant_id', restaurantId)
      .eq('user_id', userId)
      .select('user_id');
    if (error) return { error: mapDbError(error.message) };
    if (!data?.length) return { error: mapDbError('FORBIDDEN') };
    revalidateTeam(restaurantId);
    return { success: 'Rol actualizado.' };
  } catch (e) {
    unstable_rethrow(e);
    return { error: mapDbError(e instanceof Error ? e.message : undefined) };
  }
}

export async function removeMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const userId = String(fd.get('userId') ?? '');
  if (!uuidSchema.safeParse(userId).success) return { error: mapDbError(undefined) };
  try {
    await assertCanManageTeam(restaurantId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('restaurant_members')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('user_id', userId)
      .select('user_id');
    if (error) return { error: mapDbError(error.message) };
    if (!data?.length) return { error: mapDbError('FORBIDDEN') };
    revalidateTeam(restaurantId);
    return { success: 'Persona quitada del equipo.' };
  } catch (e) {
    unstable_rethrow(e);
    return { error: mapDbError(e instanceof Error ? e.message : undefined) };
  }
}

export async function cancelInvitation(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const invitationId = String(fd.get('invitationId') ?? '');
  if (!uuidSchema.safeParse(invitationId).success) return;
  await assertCanManageTeam(restaurantId);
  const supabase = await createClient();
  await supabase.from('invitations').delete().eq('id', invitationId).eq('restaurant_id', restaurantId);
  revalidateTeam(restaurantId);
}
