'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { changeMemberRole, removeMember } from '@/lib/actions/team';
import type { FormState } from '@/lib/forms';
import { ROLE_LABELS, ROLES, type Role } from '@/lib/permissions';

export function MemberRow({
  restaurantId,
  member,
  isSelf,
  editable,
}: {
  restaurantId: string;
  member: { user_id: string; full_name: string; email: string; role: Role };
  isSelf: boolean;
  editable: boolean;
}) {
  const [roleState, roleAction] = useActionState<FormState, FormData>(changeMemberRole, {});
  const [removeState, removeAction] = useActionState<FormState, FormData>(removeMember, {});
  const error = roleState.error ?? removeState.error;

  return (
    <li className="flex flex-col gap-2 border-b border-ink/10 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong>{member.full_name || member.email}</strong>
          {isSelf && <span className="text-muted"> (tú)</span>}
          <span className="block text-sm text-muted">{member.email}</span>
        </span>
        {editable ? (
          <div className="flex items-center gap-2">
            <form action={roleAction}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="userId" value={member.user_id} />
              <label className="sr-only" htmlFor={`role-${member.user_id}`}>
                Rol de {member.full_name || member.email}
              </label>
              <select
                id={`role-${member.user_id}`}
                name="role"
                defaultValue={member.role}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded-[6px] border-2 border-ink/25 bg-white px-2 py-1.5 text-sm font-bold"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </form>
            {!isSelf && (
              <form action={removeAction}>
                <input type="hidden" name="restaurantId" value={restaurantId} />
                <input type="hidden" name="userId" value={member.user_id} />
                <Button type="submit" variant="ghost" className="px-2 py-1 text-sm">
                  Quitar
                </Button>
              </form>
            )}
          </div>
        ) : (
          <span className="text-sm font-bold">{ROLE_LABELS[member.role]}</span>
        )}
      </div>
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
    </li>
  );
}
