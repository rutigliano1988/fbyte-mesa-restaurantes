import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { signOut } from '@/lib/auth/actions';
import { getUser } from '@/lib/auth/guards';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { AcceptButton, NewAccountForm } from './AcceptForms';

// no-referrer: el token va en la URL y no debe filtrarse a otros sitios.
export const metadata: Metadata = { title: 'Invitación', robots: { index: false }, referrer: 'no-referrer' };

type Invitation = { restaurant_id: string; restaurant_name: string; email: string; role: Role; has_account: boolean };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_invitation', { p_token: token });
  const invitation = ((data as Invitation[] | null) ?? [])[0];
  const user = await getUser();

  let body: React.ReactNode;
  if (!invitation) {
    body = (
      <>
        <h1 className="text-2xl font-extrabold">Esta invitación ya no es válida</h1>
        <p className="text-muted">Puede que haya caducado o que ya se haya usado. Pide que te la reenvíen.</p>
      </>
    );
  } else {
    const intro = (
      <>
        <h1 className="text-2xl font-extrabold">Te esperamos en {invitation.restaurant_name}</h1>
        <p className="text-muted">
          Entrarás como <strong className="text-ink">{ROLE_LABELS[invitation.role]}</strong>.
        </p>
      </>
    );
    if (user && user.email.toLowerCase() === invitation.email) {
      body = (
        <>
          {intro}
          <AcceptButton token={token} restaurantName={invitation.restaurant_name} />
        </>
      );
    } else if (user) {
      body = (
        <>
          {intro}
          <p>
            Has entrado como <strong>{user.email}</strong>, pero la invitación es para <strong>{invitation.email}</strong>.
          </p>
          <form action={signOut}>
            <button type="submit" className={buttonClass('secondary')}>
              Salir y entrar con la otra cuenta
            </button>
          </form>
        </>
      );
    } else if (invitation.has_account) {
      body = (
        <>
          {intro}
          <p>Ya tienes cuenta con {invitation.email}. Entra para aceptar.</p>
          <Link href={`/login?next=${encodeURIComponent(`/invitacion/${token}`)}`} className={buttonClass('primary')}>
            Entrar
          </Link>
        </>
      );
    } else {
      body = (
        <>
          {intro}
          <NewAccountForm token={token} email={invitation.email} />
        </>
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Logo />
      <Card>
        <div className="flex flex-col gap-4">{body}</div>
      </Card>
    </main>
  );
}
