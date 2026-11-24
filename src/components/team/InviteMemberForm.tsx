'use client';

import { useActionState } from 'react';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SelectField } from '@/components/ui/SelectField';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { inviteMember, type InviteState } from '@/lib/actions/team';
import { ROLE_LABELS, type Role } from '@/lib/permissions';

export function InviteMemberForm({
  restaurantId,
  roles,
  defaultEmail = '',
  defaultRole,
  submitLabel = 'Enviar invitación',
}: {
  restaurantId: string;
  roles: Role[];
  defaultEmail?: string;
  defaultRole?: Role;
  submitLabel?: string;
}) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMember, {});
  return (
    <div className="flex flex-col gap-4">
      {state.inviteUrl && (
        <Notice tone={state.emailSent ? 'success' : 'info'}>
          {state.emailSent
            ? `Listo. Hemos enviado la invitación a ${state.email}.`
            : `Hemos creado la invitación, pero no pudimos enviar el email a ${state.email}.`}{' '}
          Si no le llega, pásale este enlace (caduca en 7 días):
          <label className="mt-2 block">
            <span className="sr-only">Enlace de invitación</span>
            <input
              aria-label="Enlace de invitación"
              readOnly
              value={state.inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full rounded-[6px] border-2 border-ink/25 bg-white px-3 py-2 font-mono text-xs"
            />
          </label>
        </Notice>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <form action={action} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <div className="flex-1">
          <Field label="Email" name="email" type="email" defaultValue={defaultEmail} error={state.fieldErrors?.email} required />
        </div>
        <SelectField
          label="Rol"
          name="role"
          defaultValue={defaultRole ?? roles[roles.length - 1]}
          options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          error={state.fieldErrors?.role}
        />
        <SubmitButton pendingText="Enviando…">{submitLabel}</SubmitButton>
      </form>
    </div>
  );
}
