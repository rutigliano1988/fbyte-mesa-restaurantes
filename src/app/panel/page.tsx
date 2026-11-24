import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/layout/AppHeader';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getMyRestaurants, isPlatformAdmin, requireUser } from '@/lib/auth/guards';
import { ROLE_LABELS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Panel' };

export default async function PanelIndex() {
  const user = await requireUser('/panel');
  const restaurants = await getMyRestaurants();
  if (restaurants.length === 1) redirect(`/panel/${restaurants[0].id}`);
  if (restaurants.length === 0 && (await isPlatformAdmin())) redirect('/admin');

  return (
    <>
      <AppHeader userEmail={user.email} homeHref="/panel" />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Tus restaurantes</h1>
        {restaurants.length === 0 ? (
          <Card>
            <p>Todavía no formas parte de ningún restaurante. Si te han invitado, abre el enlace del email.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {restaurants.map((r) => (
              <li key={r.id}>
                <Link href={`/panel/${r.id}`} className="flex items-center justify-between rounded-[6px] border-2 border-ink bg-white px-4 py-3 hover:bg-peach-soft">
                  <span>
                    <strong>{r.name}</strong> <span className="text-sm text-muted">· {ROLE_LABELS[r.role]}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
