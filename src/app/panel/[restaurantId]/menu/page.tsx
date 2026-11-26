import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, FormSelect } from '@/components/forms/ActionForm';
import { MenuSettingsForm } from '@/components/menu/MenuSettingsForm';
import { SortableList } from '@/components/menu/SortableList';
import { UnavailableBoard } from '@/components/menu/UnavailableBoard';
import { buttonClass } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import { saveUnavailableMode, setMenuActive } from '@/lib/actions/menu';
import { requirePanelAccess } from '@/lib/auth/guards';
import { MENU_KIND_LABELS_ES, MENU_LIMITS } from '@/lib/menu/codes';
import { getMenuTree } from '@/lib/menu/data';
import { formatCents } from '@/lib/menu/price';
import { scheduleSummaryEs } from '@/lib/menu/schedule';
import { nameEs, unavailableGroups, type PanelMenu } from '@/lib/menu/tree';
import { can } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Menú' };

function MenuCard({ restaurantId, menu, readOnly }: { restaurantId: string; menu: PanelMenu; readOnly: boolean }) {
  const name = nameEs(menu.names);
  const count = menu.sections.reduce((n, s) => n + s.items.length, 0);
  const href = `/panel/${restaurantId}/menu/${menu.id}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border-2 border-ink/10 p-4">
      <div className="min-w-0">
        <p className="text-lg font-extrabold">
          <Link href={href} className="hover:underline">
            {name}
          </Link>
        </p>
        <p className="text-sm text-muted">
          {MENU_KIND_LABELS_ES[menu.kind]} · {count === 1 ? '1 plato' : `${count} platos`} ·{' '}
          {menu.active ? scheduleSummaryEs(menu) : 'Oculta en tu web'}
          {menu.priceCents !== null && ` · ${formatCents(menu.priceCents)}`}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Link href={href} aria-label={`Editar «${name}»`} className="text-sm font-bold text-navy hover:underline">
          Editar
        </Link>
        {!readOnly && (
          <form action={setMenuActive}>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="menuId" value={menu.id} />
            <input type="hidden" name="active" value={menu.active ? '0' : '1'} />
            <button
              type="submit"
              aria-label={menu.active ? `Ocultar «${name}» de tu web` : `Mostrar «${name}» en tu web`}
              className="text-sm font-bold text-navy hover:underline"
            >
              {menu.active ? 'Ocultar' : 'Mostrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default async function MenuPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'menu.toggle_unavailable');
  const tree = await getMenuTree(restaurantId);
  const readOnly = ctx.readOnly;

  // Sala: solo la pantalla de agotados.
  if (!can(ctx.role, 'menu.edit')) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight">Agotados</h1>
          <p className="mt-1 text-muted">Toca un plato para marcarlo como agotado. En la carta de tu web se ve al momento.</p>
        </header>
        <UnavailableBoard restaurantId={restaurantId} groups={unavailableGroups(tree)} readOnly={readOnly} />
      </div>
    );
  }

  const base = `/panel/${restaurantId}/menu`;
  const entries = tree.menus.map((menu) => ({
    id: menu.id,
    label: nameEs(menu.names),
    content: <MenuCard restaurantId={restaurantId} menu={menu} readOnly={readOnly} />,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Menú</h1>
        <p className="mt-1 text-muted">
          Tus cartas, el menú del día y los platos.{' '}
          {ctx.restaurant.status === 'active' ? (
            <Link href={`/${ctx.restaurant.slug}/menu`} target="_blank" className="font-bold text-navy hover:underline">
              Ver mi carta
            </Link>
          ) : (
            'Se verán en tu web cuando la publiques.'
          )}
        </p>
        <nav aria-label="Más del menú" className="mt-4 flex flex-wrap gap-3">
          <Link href={`${base}/platos`} className={buttonClass('secondary')}>
            Platos
          </Link>
          <Link href={`${base}/agotados`} className={buttonClass('secondary')}>
            Agotados
          </Link>
          <Link href={`${base}/qr`} className={buttonClass('secondary')}>
            Código QR
          </Link>
        </nav>
      </header>

      <SectionCard title="Tus cartas" intro="Salen como pestañas en tu web, en este orden. El menú del día o el especial sale primero cuando toca.">
        {entries.length > 0 ? (
          <SortableList restaurantId={restaurantId} entity="menus" parentId={restaurantId} entries={entries} label="Orden de tus cartas" readOnly={readOnly} />
        ) : (
          <p className="text-sm text-muted">Aún no tienes ninguna carta. Crea la primera aquí abajo.</p>
        )}
      </SectionCard>

      {!readOnly && tree.menus.length < MENU_LIMITS.menus && (
        <SectionCard
          title="Crear una carta"
          intro="Una carta (Carta, Bebidas, Postres…) se ve siempre. El menú del día y los especiales, solo los días y las horas que elijas."
        >
          <MenuSettingsForm restaurantId={restaurantId} enabled={tree.enabledLocales} menu={null} readOnly={false} />
        </SectionCard>
      )}

      <SectionCard title="Platos agotados en tu web" intro="Elige cómo los ven tus clientes.">
        <ActionForm action={saveUnavailableMode} hidden={{ restaurantId }} readOnly={readOnly}>
          <FormSelect
            label="Los platos agotados…"
            name="mode"
            defaultValue={tree.unavailableMode}
            options={[
              { value: 'strike', label: 'Se ven tachados, con «Agotado»' },
              { value: 'hide', label: 'No se ven' },
            ]}
          />
        </ActionForm>
      </SectionCard>
    </div>
  );
}
