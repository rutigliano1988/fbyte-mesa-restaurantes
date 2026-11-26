import Link from 'next/link';
import { ActionForm, FormCheckboxGroup, FormSelect } from '@/components/forms/ActionForm';
import { duplicateDish } from '@/lib/actions/dishes';
import { addExistingDish, addInlineItem, deleteSection, removeItem, renameSection, updateInlineItem } from '@/lib/actions/menu';
import { LOCALE_LABELS_ES, type Locale } from '@/lib/i18n/locales';
import { ALLERGEN_LABELS_ES, ALLERGENS, MENU_LIMITS, type Allergen } from '@/lib/menu/codes';
import { missingLocales } from '@/lib/menu/i18n-text';
import { nameEs, pricesSummaryEs, type PanelDish, type PanelItem, type PanelMenu, type PanelSection } from '@/lib/menu/tree';
import { ConfirmDeleteForm } from './ConfirmDeleteForm';
import { I18nFields } from './I18nFields';
import { SortableList } from './SortableList';

const linkButton = 'text-sm font-bold text-navy hover:underline';
const allergenList = (allergens: Allergen[]) => allergens.map((a) => ALLERGEN_LABELS_ES[a]).join(', ');

/** Una sección de la carta con sus platos y todo lo necesario para añadir, ordenar, quitar o renombrar. */
export function SectionEditor({
  restaurantId,
  menu,
  section,
  dishes,
  available,
  enabled,
  readOnly,
}: {
  restaurantId: string;
  menu: PanelMenu;
  section: PanelSection;
  dishes: Map<string, PanelDish>;
  available: PanelDish[];
  enabled: Locale[];
  readOnly: boolean;
}) {
  const title = nameEs(section.names);
  const hidden = { restaurantId, menuId: menu.id, sectionId: section.id };
  const full = section.items.length >= MENU_LIMITS.items;
  const entries = section.items.map((item) => {
    const dish = item.dishId ? dishes.get(item.dishId) : undefined;
    const label = dish ? nameEs(dish.names) : nameEs(item.inlineNames);
    return {
      id: item.id,
      label,
      content: dish ? (
        <DishRow restaurantId={restaurantId} menuId={menu.id} section={section} item={item} dish={dish} enabled={enabled} readOnly={readOnly} />
      ) : (
        <InlineRow restaurantId={restaurantId} section={section} item={item} enabled={enabled} readOnly={readOnly} />
      ),
    };
  });

  return (
    <div className="flex flex-col gap-4 rounded-[6px] border-2 border-ink/10 p-4">
      <h3 className="text-lg font-extrabold">
        {title} <span className="text-sm font-normal text-muted">· {section.items.length === 1 ? '1 plato' : `${section.items.length} platos`}</span>
      </h3>
      {entries.length > 0 ? (
        <SortableList restaurantId={restaurantId} entity="items" parentId={section.id} entries={entries} label={`Platos de ${title}`} readOnly={readOnly} />
      ) : (
        <p className="text-sm text-muted">Esta sección aún no tiene platos.</p>
      )}

      {!readOnly && !full && (
        <div className="flex flex-col gap-3 border-t border-ink/10 pt-3">
          <ActionForm action={addExistingDish} hidden={hidden} inline submitLabel="Añadir" pendingLabel="Añadiendo…" submitDisabled={available.length === 0}>
            <FormSelect
              id={`anadir-${section.id}`}
              label="Añadir un plato que ya tienes"
              name="dishId"
              defaultValue=""
              options={[
                { value: '', label: available.length > 0 ? 'Elige un plato…' : 'Ya están todos tus platos en esta carta' },
                ...available.map((d) => ({ value: d.id, label: nameEs(d.names) })),
              ]}
            />
          </ActionForm>
          {menu.kind !== 'carta' && (
            <details>
              <summary className="cursor-pointer font-bold text-navy">Escribir un plato solo para este menú</summary>
              <div className="mt-3">
                <ActionForm action={addInlineItem} hidden={hidden} submitLabel="Añadir a este menú" pendingLabel="Añadiendo…">
                  <I18nFields prefix="name" label="Nombre del plato" enabled={enabled} maxLength={120} required idPrefix={`a-mano-${section.id}`} />
                  <FormCheckboxGroup legend="Alérgenos que lleva" name="allergens" options={ALLERGENS.map((a) => ({ value: a, label: ALLERGEN_LABELS_ES[a] }))} />
                </ActionForm>
              </div>
            </details>
          )}
          <Link href={`/panel/${restaurantId}/menu/platos/nuevo?seccion=${section.id}`} className={linkButton}>
            Crear un plato nuevo en «{title}»
          </Link>
        </div>
      )}
      {!readOnly && full && <p className="text-sm text-muted">Esta sección ya tiene 100 platos, que es el máximo.</p>}

      <details className="border-t border-ink/10 pt-3">
        <summary className="cursor-pointer text-sm font-bold text-navy">Cambiar el nombre o borrar «{title}»</summary>
        <div className="mt-3 flex flex-col gap-4">
          <ActionForm action={renameSection} hidden={hidden} readOnly={readOnly} submitLabel="Guardar nombre">
            <I18nFields prefix="name" label="Nombre de la sección" enabled={enabled} values={section.names} maxLength={60} required idPrefix={`seccion-${section.id}`} />
          </ActionForm>
          {!readOnly && (
            <ConfirmDeleteForm
              action={deleteSection}
              hidden={hidden}
              confirmLabel={`Sí, quiero borrar «${title}». Sus platos siguen en tu lista de platos.`}
              submitLabel="Borrar sección"
            />
          )}
        </div>
      </details>
    </div>
  );
}

function DishRow({
  restaurantId,
  menuId,
  section,
  item,
  dish,
  enabled,
  readOnly,
}: {
  restaurantId: string;
  menuId: string;
  section: PanelSection;
  item: PanelItem;
  dish: PanelDish;
  enabled: Locale[];
  readOnly: boolean;
}) {
  const name = nameEs(dish.names);
  const missing = missingLocales(dish.names, enabled);
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink/10 pb-3">
      <div className="min-w-0">
        <p className="font-bold">
          {name}
          {dish.unavailable && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">Agotado</span>}
        </p>
        <p className="text-sm text-muted">
          {pricesSummaryEs(dish.prices)}
          {dish.allergens.length > 0 ? ` · ${allergenList(dish.allergens)}` : ' · Sin alérgenos marcados'}
        </p>
        {missing.length > 0 && (
          <p className="text-xs font-bold text-navy">Falta la traducción: {missing.map((l) => LOCALE_LABELS_ES[l].toLowerCase()).join(', ')}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/panel/${restaurantId}/menu/platos/${dish.id}?carta=${menuId}`} aria-label={`Editar «${name}»`} className={linkButton}>
          Editar
        </Link>
        {!readOnly && (
          <>
            <form action={duplicateDish}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="dishId" value={dish.id} />
              <input type="hidden" name="sectionId" value={section.id} />
              <input type="hidden" name="menuId" value={menuId} />
              <button type="submit" aria-label={`Duplicar «${name}» en «${nameEs(section.names)}»`} className={linkButton}>
                Duplicar
              </button>
            </form>
            <form action={removeItem}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="itemId" value={item.id} />
              <button type="submit" aria-label={`Quitar «${name}» de «${nameEs(section.names)}»`} className="text-sm font-bold text-red-700 hover:underline">
                Quitar
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function InlineRow({
  restaurantId,
  section,
  item,
  enabled,
  readOnly,
}: {
  restaurantId: string;
  section: PanelSection;
  item: PanelItem;
  enabled: Locale[];
  readOnly: boolean;
}) {
  const name = nameEs(item.inlineNames);
  return (
    <div className="flex flex-col gap-2 border-b border-ink/10 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">
            {name} <span className="text-xs font-normal text-muted">(solo en este menú)</span>
          </p>
          <p className="text-sm text-muted">{item.inlineAllergens.length > 0 ? allergenList(item.inlineAllergens) : 'Sin alérgenos marcados'}</p>
        </div>
        {!readOnly && (
          <form action={removeItem}>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit" aria-label={`Quitar «${name}» de «${nameEs(section.names)}»`} className="text-sm font-bold text-red-700 hover:underline">
              Quitar
            </button>
          </form>
        )}
      </div>
      {!readOnly && (
        <details>
          <summary className="cursor-pointer text-sm font-bold text-navy">Editar «{name}»</summary>
          <div className="mt-3">
            <ActionForm action={updateInlineItem} hidden={{ restaurantId, itemId: item.id }} submitLabel="Guardar plato">
              <I18nFields prefix="name" label="Nombre del plato" enabled={enabled} values={item.inlineNames} maxLength={120} required idPrefix={`a-mano-${item.id}`} />
              <FormCheckboxGroup
                legend="Alérgenos que lleva"
                name="allergens"
                options={ALLERGENS.map((a) => ({ value: a, label: ALLERGEN_LABELS_ES[a], defaultChecked: item.inlineAllergens.includes(a) }))}
              />
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
