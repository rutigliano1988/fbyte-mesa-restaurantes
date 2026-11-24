'use server';

import { redirect } from 'next/navigation';
import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { newAccountSchema } from '@/lib/validation/schemas';

type Invitation = { restaurant_id: string; restaurant_name: string; email: string; role: string; has_account: boolean };

export type AcceptState = FormState & { loginHref?: string };

const ACCOUNT_EXISTS = 'Ya tienes cuenta con este email. Entra para aceptar la invitación.';

function loginHrefFor(token: string): string {
  return `/login?next=${encodeURIComponent(`/invitacion/${token}`)}`;
}

async function loadInvitation(token: string): Promise<Invitation | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_invitation', { p_token: token });
  return ((data as Invitation[] | null) ?? [])[0] ?? null;
}

export async function createAccountAndAccept(_prev: AcceptState, fd: FormData): Promise<AcceptState> {
  const token = String(fd.get('token') ?? '');
  const parsed = newAccountSchema.safeParse({ fullName: fd.get('fullName'), password: fd.get('password') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const invitation = await loadInvitation(token);
  if (!invitation) return { error: mapDbError('INVALID_INVITATION') };
  if (invitation.has_account) return { error: ACCOUNT_EXISTS, loginHref: loginHrefFor(token) };

  // El enlace llegó al email invitado, así que damos el email por confirmado.
  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (createError) {
    if (createError.code === 'email_exists') return { error: ACCOUNT_EXISTS, loginHref: loginHrefFor(token) };
    if (createError.code === 'weak_password') {
      return { fieldErrors: { password: 'Esa contraseña es demasiado débil. Prueba con una más larga.' } };
    }
    console.error('[invitacion] no se pudo crear la cuenta', { code: createError.code });
    return { error: mapDbError(undefined) };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: invitation.email, password: parsed.data.password });
  if (signInError) return { error: mapDbError(undefined) };

  const { data: restaurantId, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) return { error: mapDbError(error.message) };
  redirect(`/panel/${restaurantId}`);
}

export async function acceptAsCurrentUser(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get('token') ?? '');
  const supabase = await createClient();
  const { data: restaurantId, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) return { error: mapDbError(error.message) };
  redirect(`/panel/${restaurantId}`);
}
