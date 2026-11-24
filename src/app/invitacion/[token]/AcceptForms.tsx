'use client';

import { useActionState } from 'react';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SubmitButton } from '@/components/ui/SubmitButton';
import type { FormState } from '@/lib/forms';
import { acceptAsCurrentUser, createAccountAndAccept } from './actions';

export function NewAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<FormState, FormData>(createAccountAndAccept, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field label="Email" name="email-display" value={email} readOnly disabled />
      <Field label="Tu nombre" name="fullName" autoComplete="name" error={state.fieldErrors?.fullName} required />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="Mínimo 8 caracteres."
        error={state.fieldErrors?.password}
        required
      />
      <SubmitButton pendingText="Creando tu acceso…">Crear mi acceso</SubmitButton>
    </form>
  );
}

export function AcceptButton({ token, restaurantName }: { token: string; restaurantName: string }) {
  const [state, action] = useActionState<FormState, FormData>(acceptAsCurrentUser, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pendingText="Un momento…">Unirme a {restaurantName}</SubmitButton>
    </form>
  );
}
