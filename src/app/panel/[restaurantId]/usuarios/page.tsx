import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { InviteMemberForm } from '@/components/team/InviteMemberForm';
import { cancelInvitation } from '@/lib/actions/team';
import { getPanelContext } from '@/lib/auth/guards';
import { can, ROLE_LABELS, ROLES, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { MemberRow } from './MemberRow';

export const metadata: Metadata = { title: 'Equipo' };

type TeamRow = { user_id: string; full_name: string; email: string; role: Role };
type InvitationRow = { id: string; email: string; role: Role; expires_at: string };

export default async function TeamPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await getPanelContext(restaurantId);
  if (!can(ctx.role, 'users.manage')) notFound();
  const editable = !ctx.readOnly;

  const supabase = await createClient();
  const [{ data: team }, { data: invitations }] = await Promise.all([
    supabase.rpc('restaurant_team', { p_restaurant_id: restaurantId }),
    supabase
      .from('invitations')
      .select('id, email, role, expires_at')
      .eq('restaurant_id', restaurantId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Equipo</h1>

      <Card>
        <h2 className="text-xl font-extrabold">Personas con acceso</h2>
        <ul className="mt-2">
          {((team as TeamRow[] | null) ?? []).map((m) => (
            <MemberRow key={m.user_id} restaurantId={restaurantId} member={m} isSelf={m.user_id === ctx.user.id} editable={editable} />
          ))}
        </ul>
      </Card>

      {editable && (
        <Card>
          <h2 className="mb-4 text-xl font-extrabold">Invitar a alguien</h2>
          <InviteMemberForm restaurantId={restaurantId} roles={[...ROLES]} defaultRole="staff" />
        </Card>
      )}

      {((invitations as InvitationRow[] | null) ?? []).length > 0 && (
        <Card>
          <h2 className="text-xl font-extrabold">Invitaciones pendientes</h2>
          <ul className="mt-2">
            {(invitations as InvitationRow[]).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 py-3">
                <span>
                  {i.email} <span className="text-sm text-muted">· {ROLE_LABELS[i.role]} · caduca el {new Date(i.expires_at).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' })}</span>
                </span>
                {editable && (
                  <form action={cancelInvitation}>
                    <input type="hidden" name="restaurantId" value={restaurantId} />
                    <input type="hidden" name="invitationId" value={i.id} />
                    <button type="submit" className="text-sm font-bold text-navy hover:underline">
                      Cancelar
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
