import type { Metadata } from 'next';
import Link from 'next/link';
import { DishForm } from '@/components/menu/DishForm';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { MENU_LIMITS } from '@/lib/menu/codes';
import { getMenuTree } from '@/lib/menu/data';
import { nameEs } from '@/lib/menu/tree';

export const metadata: Metadata = { title: 'Nuevo plato' };

export default async function NewDishPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ restaurantId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePanelAccess(restaurantId, 'menu.edit');
  const tree = await getMenuTree(restaurantId);
  const sectionId = typeof sp.seccion === 'string' ? sp.seccion : '';
  const menu = tree.menus.find((m) => m.sections.some((s) => s.id === sectionId)) ?? null;
  const section = menu?.sections.find((s) => s.id === sectionId) ?? null;
  const back = menu ? `/panel/${restaurantId}/menu/${menu.id}` : `/panel/${restaurantId}/menu/platos`;
  const full = tree.dishes.length >= MENU_LIMITS.dishes;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={back} className="text-sm font-bold text-navy hover:underline">
          ← {menu ? nameEs(menu.names) : 'Platos'}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Nuevo plato</h1>
        {menu && section && (
          <p className="mt-1 text-muted">
            Se añadirá al final de «{nameEs(section.names)}» en «{nameEs(menu.names)}». Después podrás subirle una foto.
          </p>
        )}
      </header>
      {full ? (
        <Notice tone="info">Ya tienes 500 platos, que es el máximo. Borra los que no uses para crear otros.</Notice>
      ) : (
        <SectionCard title="Datos del plato">
          <DishForm
            restaurantId={restaurantId}
            dish={null}
            enabled={tree.enabledLocales}
            hidden={menu && section ? { sectionId: section.id, menuId: menu.id } : {}}
            readOnly={ctx.readOnly}
          />
        </SectionCard>
      )}
    </div>
  );
}
