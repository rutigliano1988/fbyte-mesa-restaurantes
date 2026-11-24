'use server';

import { redirect } from 'next/navigation';
import { fieldErrorsFrom, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { newPasswordSchema } from '@/lib/validation/schemas';

export async function setNewPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({ password: formData.get('password'), confirm: formData.get('confirm') });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: 'No pudimos guardar la contraseña. Pide un enlace nuevo y vuelve a probar.' };
  redirect('/panel');
}
