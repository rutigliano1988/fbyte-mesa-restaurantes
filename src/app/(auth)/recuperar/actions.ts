'use server';

import { siteUrl } from '@/lib/env';
import type { FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { emailOnlySchema } from '@/lib/validation/schemas';

export async function requestReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailOnlySchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { error: 'Ese email no parece correcto.' };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/nueva-contrasena`,
  });
  // Mismo mensaje exista o no la cuenta, para no revelar quién está registrado.
  return { success: 'Si hay una cuenta con ese email, te hemos enviado un enlace para crear una contraseña nueva.' };
}
