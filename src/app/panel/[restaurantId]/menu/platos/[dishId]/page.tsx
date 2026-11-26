import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmDeleteForm } from '@/components/menu/ConfirmDeleteForm';
import { DishForm } from '@/components/menu/DishForm';
import { DishPhotoField } from '@/components/menu/DishPhotoField';
import { UnavailableSwitch } from '@/components/menu/UnavailableSwitch';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { deleteDish, duplicateDish } from '@/lib/actions/dishes';
import { requirePanelAccess } from '@/lib/auth/guards';
import { getMenuTree } from '@/lib/menu/data';
import { menusWithDish, nameEs } from '@/lib/menu/tree';
import { mediaUrl } from '@/lib/public/data';
import { uuidSchema } from '@/lib/validation/schemas';

export const metadata: Metadata = { title: 'Editar plato' };

export default async function DishPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string; dishId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ restaurantId, dishId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePanelAccess(restaurantId, 'menu.edit');
  if (!uuidSchema.safeParse(dishId).success) notFound();
  const tree = await getMenuTree(restaurantId);
  const dish = tree.dishes.find((d) => d.id === dishId);
  if (!dish) notFound();

  const readOnly = ctx.readOnly;
  const name = nameEs(dish.names);
  const menus = menusWithDish(tree, dish.id);
  const fromMenu = tree.menus.find((m) => m.id === sp.carta) ?? null;
  const back = fromMenu ? `/panel/${restaurantId}/menu/${fromMenu.id}` : `/panel/${restaurantId}/menu/platos`;
  const hidden: Record<string, string> = fromMenu ? { menuId: fromMenu.id } : {};

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={back} className="text-sm font-bold text-navy hover:underline">
          ← {fromMenu ? nameEs(fromMenu.names) : 'Platos'}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{name}</h1>
        <p className="mt-1 text-muted">
          {menus.length > 0 ? `Está en: ${menus.map((m) => nameEs(m.names)).join(', ')}.` : 'Todavía no está en ninguna carta.'} Los cambios se
          ven en todas.
        </p>
      </header>

      {sp.aviso === 'no-seccion' && (
        <Notice tone="error">El plato se ha creado, pero no se ha podido añadir a la sección. Añádelo desde la carta.</Notice>
      )}

      <SectionCard title="Agotado" intro="También lo puede cambiar Sala desde su móvil.">
        <UnavailableSwitch restaurantId={restaurantId} dishId={dish.id} dishName={name} unavailable={dish.unavailable} disabled={readOnly} />
      </SectionCard>

      <SectionCard title="Datos del plato">
        <DishForm restaurantId={restaurantId} dish={dish} enabled={tree.enabledLocales} hidden={hidden} readOnly={readOnly} />
      </SectionCard>

      <SectionCard title="Foto">
        <DishPhotoField restaurantId={restaurantId} dishId={dish.id} dishName={name} url={dish.photoPath ? mediaUrl(dish.photoPath) : null} readOnly={readOnly} />
      </SectionCard>

      {!readOnly && (
        <>
          <SectionCard title="Duplicar" intro="Crea una copia con los mismos textos, alérgenos, etiquetas y precios (sin la foto) para hacer una variante.">
            <form action={duplicateDish}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="dishId" value={dish.id} />
              {fromMenu && <input type="hidden" name="menuId" value={fromMenu.id} />}
              <button type="submit" className="font-bold text-navy hover:underline">
                Duplicar «{name}»
              </button>
            </form>
          </SectionCard>
          <SectionCard title="Borrar el plato" intro="Desaparece de todas las cartas en las que está.">
            <ConfirmDeleteForm
              action={deleteDish}
              hidden={{ restaurantId, dishId: dish.id, ...hidden }}
              confirmLabel={`Sí, quiero borrar «${name}» de todas las cartas`}
              submitLabel="Borrar plato"
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
