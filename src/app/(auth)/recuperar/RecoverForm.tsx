'use client';

import { useActionState } from 'react';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SubmitButton } from '@/components/ui/SubmitButton';
import type { FormState } from '@/lib/forms';
import { requestReset } from './actions';

export function RecoverForm() {
  const [state, action] = useActionState<FormState, FormData>(requestReset, {});
  if (state.success) return <Notice tone="success">{state.success}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <SubmitButton pendingText="Enviando…">Enviarme el enlace</SubmitButton>
    </form>
  );
}
