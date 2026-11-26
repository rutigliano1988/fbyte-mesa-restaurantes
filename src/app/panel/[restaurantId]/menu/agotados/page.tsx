import type { Metadata } from 'next';
import Link from 'next/link';
import { UnavailableBoard } from '@/components/menu/UnavailableBoard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { getMenuTree } from '@/lib/menu/data';
import { unavailableGroups } from '@/lib/menu/tree';

export const metadata: Metadata = { title: 'Agotados' };

export default async function UnavailablePage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'menu.toggle_unavailable');
  const tree = await getMenuTree(restaurantId);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={`/panel/${restaurantId}/menu`} className="text-sm font-bold text-navy hover:underline">
          ← Menú
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Agotados</h1>
        <p className="mt-1 text-muted">Toca un plato para marcarlo como agotado. En la carta de tu web se ve al momento.</p>
      </header>
      <UnavailableBoard restaurantId={restaurantId} groups={unavailableGroups(tree)} readOnly={ctx.readOnly} />
    </div>
  );
}
