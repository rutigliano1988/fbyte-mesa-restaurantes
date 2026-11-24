import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { RestaurantStatus } from '@/lib/auth/guards';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Restaurantes' };

type Row = { id: string; name: string; slug: string; status: RestaurantStatus; created_at: string };

export default async function AdminHome() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from('restaurants').select('id, name, slug, status, created_at').order('created_at', { ascending: false });
  const rows = (data ?? []) as Row[];
  const count = (s: RestaurantStatus) => rows.filter((r) => r.status === s).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Restaurantes</h1>
        <Link href="/admin/restaurantes/nuevo" className={buttonClass('primary')}>
          Nuevo restaurante
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(['active', 'setup', 'disabled'] as RestaurantStatus[]).map((s) => (
          <Card key={s}>
            <StatusBadge status={s} />
            <p className="mt-3 text-4xl font-black">{count(s)}</p>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-muted">Todavía no hay restaurantes. Crea el primero con el botón de arriba.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/restaurantes/${r.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border-2 border-ink bg-white px-4 py-3 hover:bg-peach-soft"
              >
                <span className="flex flex-col">
                  <span className="font-bold">{r.name}</span>
                  <span className="text-sm text-muted">/{r.slug} · alta {new Date(r.created_at).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' })}</span>
                </span>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
