import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/forms/ActionForm';
import { ConfirmDeleteForm } from '@/components/menu/ConfirmDeleteForm';
import { I18nFields } from '@/components/menu/I18nFields';
import { MenuSettingsForm } from '@/components/menu/MenuSettingsForm';
import { SectionEditor } from '@/components/menu/SectionEditor';
import { SortableList } from '@/components/menu/SortableList';
import { SectionCard } from '@/components/ui/SectionCard';
import { addSection, deleteMenu } from '@/lib/actions/menu';
import { requirePanelAccess } from '@/lib/auth/guards';
import { MENU_KIND_LABELS_ES, MENU_LIMITS } from '@/lib/menu/codes';
import { getMenuTree } from '@/lib/menu/data';
import { scheduleSummaryEs } from '@/lib/menu/schedule';
import { dishesNotInMenu, nameEs } from '@/lib/menu/tree';
import { uuidSchema } from '@/lib/validation/schemas';

export const metadata: Metadata = { title: 'Editar carta' };

export default async function MenuEditorPage({ params }: { params: Promise<{ restaurantId: string; menuId: string }> }) {
  const { restaurantId, menuId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'menu.edit');
  if (!uuidSchema.safeParse(menuId).success) notFound();
  const tree = await getMenuTree(restaurantId);
  const menu = tree.menus.find((m) => m.id === menuId);
  if (!menu) notFound();

  const readOnly = ctx.readOnly;
  const name = nameEs(menu.names);
  const isCarta = menu.kind === 'carta';
  const dishes = new Map(tree.dishes.map((d) => [d.id, d]));
  const available = dishesNotInMenu(tree, menu.id);
  const sections = menu.sections.map((section) => ({
    id: section.id,
    label: nameEs(section.names),
    content: (
      <SectionEditor
        restaurantId={restaurantId}
        menu={menu}
        section={section}
        dishes={dishes}
        available={available}
        enabled={tree.enabledLocales}
        readOnly={readOnly}
      />
    ),
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={`/panel/${restaurantId}/menu`} className="text-sm font-bold text-navy hover:underline">
          ← Menú
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{name}</h1>
        <p className="mt-1 text-muted">
          {MENU_KIND_LABELS_ES[menu.kind]} · {menu.active ? scheduleSummaryEs(menu) : 'Oculta en tu web'}
          {ctx.restaurant.status === 'active' && menu.active && (
            <>
              {' · '}
              <Link href={`/${ctx.restaurant.slug}/menu?carta=${menu.id}`} target="_blank" className="font-bold text-navy hover:underline">
                Verla en tu web
              </Link>
            </>
          )}
        </p>
      </header>

      <SectionCard
        title="Datos de la carta"
        intro={isCarta ? 'El nombre sale en la pestaña de tu carta.' : 'Precio cerrado, qué incluye y cuándo se ve. Fuera de esos días y horas no sale en tu web.'}
      >
        <MenuSettingsForm restaurantId={restaurantId} enabled={tree.enabledLocales} menu={menu} readOnly={readOnly} />
      </SectionCard>

      <SectionCard
        title={isCarta ? 'Categorías y platos' : 'Secciones y platos'}
        intro="Arrastra o usa Subir y Bajar para ordenar. Un plato no puede estar dos veces en la misma carta."
      >
        {sections.length > 0 ? (
          <SortableList restaurantId={restaurantId} entity="sections" parentId={menu.id} entries={sections} label={`Secciones de ${name}`} readOnly={readOnly} />
        ) : (
          <p className="text-sm text-muted">
            Añade la primera {isCarta ? 'categoría (por ejemplo, Entrantes)' : 'sección (por ejemplo, Primeros)'}.
          </p>
        )}
        {!readOnly && menu.sections.length < MENU_LIMITS.sections && (
          <ActionForm action={addSection} hidden={{ restaurantId, menuId: menu.id }} submitLabel={isCarta ? 'Añadir categoría' : 'Añadir sección'} pendingLabel="Añadiendo…">
            <I18nFields
              prefix="name"
              label={isCarta ? 'Nueva categoría' : 'Nueva sección'}
              enabled={tree.enabledLocales}
              maxLength={60}
              required
              idPrefix="seccion-nueva"
            />
          </ActionForm>
        )}
      </SectionCard>

      {!readOnly && (
        <SectionCard title="Borrar esta carta" intro="Se borran sus secciones. Los platos siguen en tu lista de platos.">
          <ConfirmDeleteForm
            action={deleteMenu}
            hidden={{ restaurantId, menuId: menu.id }}
            confirmLabel={`Sí, quiero borrar «${name}»`}
            submitLabel="Borrar carta"
          />
        </SectionCard>
      )}
    </div>
  );
}
