'use server';

import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/forms';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';
import { loginSchema } from '@/lib/validation/schemas';

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) return { error: 'Revisa el email y la contraseña.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'Email o contraseña incorrectos.' };
  redirect(safeNext(String(formData.get('next') ?? '')));
}
