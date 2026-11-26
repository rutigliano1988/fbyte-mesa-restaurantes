import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { ALLERGEN_LABELS_ES, MENU_LIMITS } from '@/lib/menu/codes';
import { getMenuTree } from '@/lib/menu/data';
import { dishesByName, menusWithDish, nameEs, pricesSummaryEs } from '@/lib/menu/tree';

export const metadata: Metadata = { title: 'Platos' };

export default async function DishesPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'menu.edit');
  const tree = await getMenuTree(restaurantId);
  const dishes = dishesByName(tree);
  const base = `/panel/${restaurantId}/menu`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={base} className="text-sm font-bold text-navy hover:underline">
          ← Menú
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Platos</h1>
        <p className="mt-1 text-muted">
          Cada plato se escribe una vez y lo pones en las cartas que quieras: el precio, los alérgenos y el agotado son los mismos en todas.
        </p>
        {!ctx.readOnly && dishes.length < MENU_LIMITS.dishes && (
          <Link href={`${base}/platos/nuevo`} className={buttonClass('primary', 'mt-4')}>
            Crear un plato
          </Link>
        )}
      </header>

      <SectionCard title={`Tus platos (${dishes.length} de ${MENU_LIMITS.dishes})`}>
        {dishes.length === 0 ? (
          <p className="text-sm text-muted">Todavía no tienes platos.</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {dishes.map((dish) => {
              const name = nameEs(dish.names);
              const menus = menusWithDish(tree, dish.id).map((m) => nameEs(m.names));
              return (
                <li key={dish.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-bold">
                      <Link href={`${base}/platos/${dish.id}`} className="hover:underline">
                        {name}
                      </Link>
                      {dish.unavailable && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">Agotado</span>}
                    </p>
                    <p className="text-sm text-muted">
                      {pricesSummaryEs(dish.prices)} ·{' '}
                      {dish.allergens.length > 0 ? dish.allergens.map((a) => ALLERGEN_LABELS_ES[a]).join(', ') : 'Sin alérgenos marcados'}
                    </p>
                    <p className="text-sm text-muted">{menus.length > 0 ? `En: ${menus.join(', ')}` : 'No está en ninguna carta'}</p>
                  </div>
                  <Link href={`${base}/platos/${dish.id}`} aria-label={`Editar «${name}»`} className="text-sm font-bold text-navy hover:underline">
                    Editar
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
