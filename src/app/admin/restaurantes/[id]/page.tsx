import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InviteMemberForm } from '@/components/team/InviteMemberForm';
import type { RestaurantStatus } from '@/lib/auth/guards';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';
import { setRestaurantStatus } from './actions';

export const metadata: Metadata = { title: 'Restaurante' };

type TeamRow = { user_id: string; full_name: string; email: string; role: Role };
type InvitationRow = { id: string; email: string; role: Role; expires_at: string; accepted_at: string | null };

export default async function AdminRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: restaurant } = await supabase.from('restaurants').select('id, name, slug, status, created_at').eq('id', id).maybeSingle();
  if (!restaurant) notFound();
  const [{ data: team }, { data: invitations }] = await Promise.all([
    supabase.rpc('restaurant_team', { p_restaurant_id: id }),
    supabase.from('invitations').select('id, email, role, expires_at, accepted_at').eq('restaurant_id', id).is('accepted_at', null).order('created_at', { ascending: false }),
  ]);
  const status = restaurant.status as RestaurantStatus;
  const pendingAdmin = (invitations as InvitationRow[] | null)?.find((i) => i.role === 'admin');

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin" className="text-sm font-bold text-navy hover:underline">
        ← Restaurantes
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">{restaurant.name}</h1>
        <StatusBadge status={status} />
      </div>
      <p className="text-muted">/{restaurant.slug}</p>

      <div className="flex flex-wrap gap-3">
        <Link href={`/panel/${id}`} className={buttonClass('secondary')}>
          Ver panel (solo lectura)
        </Link>
        <form action={setRestaurantStatus}>
          <input type="hidden" name="restaurantId" value={id} />
          {status === 'disabled' ? (
            <>
              <input type="hidden" name="status" value="active" />
              <Button type="submit">Reactivar</Button>
            </>
          ) : (
            <>
              <input type="hidden" name="status" value="disabled" />
              <Button type="submit" variant="danger">
                Desactivar
              </Button>
            </>
          )}
        </form>
        {status === 'setup' && (
          <form action={setRestaurantStatus}>
            <input type="hidden" name="restaurantId" value={id} />
            <input type="hidden" name="status" value="active" />
            <Button type="submit" variant="secondary">
              Marcar como activo
            </Button>
          </form>
        )}
      </div>

      <Card>
        <h2 className="text-xl font-extrabold">Equipo</h2>
        {(team as TeamRow[] | null)?.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {(team as TeamRow[]).map((m) => (
              <li key={m.user_id} className="flex flex-wrap justify-between gap-2 border-b border-ink/10 pb-2">
                <span>
                  <strong>{m.full_name || m.email}</strong> <span className="text-muted">· {m.email}</span>
                </span>
                <span className="text-sm font-bold">{ROLE_LABELS[m.role]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-muted">Nadie ha aceptado la invitación todavía.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-xl font-extrabold">Reenviar invitación de administrador</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Crea un enlace nuevo; el anterior deja de funcionar.</p>
        <InviteMemberForm restaurantId={id} roles={['admin']} defaultRole="admin" defaultEmail={pendingAdmin?.email} submitLabel="Reenviar invitación" />
      </Card>
    </div>
  );
}
