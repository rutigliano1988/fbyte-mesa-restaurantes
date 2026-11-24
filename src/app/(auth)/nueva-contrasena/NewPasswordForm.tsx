'use client';

import { useActionState } from 'react';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SubmitButton } from '@/components/ui/SubmitButton';
import type { FormState } from '@/lib/forms';
import { setNewPassword } from './actions';

export function NewPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="Contraseña nueva" name="password" type="password" autoComplete="new-password" hint="Mínimo 8 caracteres." error={state.fieldErrors?.password} required />
      <Field label="Repite la contraseña" name="confirm" type="password" autoComplete="new-password" error={state.fieldErrors?.confirm} required />
      <SubmitButton pendingText="Guardando…">Guardar contraseña</SubmitButton>
    </form>
  );
}
