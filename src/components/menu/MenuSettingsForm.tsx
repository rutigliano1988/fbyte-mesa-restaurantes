import { ActionForm, FormCheckbox, FormCheckboxGroup, FormField, FormSelect } from '@/components/forms/ActionForm';
import { createMenu, updateMenu } from '@/lib/actions/menu';
import type { Locale } from '@/lib/i18n/locales';
import { MENU_KIND_LABELS_ES, MENU_KINDS } from '@/lib/menu/codes';
import { centsToInput } from '@/lib/menu/price';
import type { PanelMenu } from '@/lib/menu/tree';
import { minutesToTime, WEEKDAY_LABELS_ES, WEEKDAYS } from '@/lib/schedule';
import { I18nFields } from './I18nFields';

/**
 * Datos de una carta: nombre por idioma, si se ve en la web y, en el menú del día y el especial, precio cerrado,
 * «incluye» y cuándo se ve. Sin menu, crea una (solo con el castellano: las traducciones, al editarla).
 */
export function MenuSettingsForm({
  restaurantId,
  enabled,
  menu,
  readOnly,
}: {
  restaurantId: string;
  enabled: Locale[];
  menu: PanelMenu | null;
  readOnly: boolean;
}) {
  const idPrefix = menu ? `carta-${menu.id}` : 'carta-nueva';
  const scheduled = menu === null || menu.kind !== 'carta';
  return (
    <ActionForm
      action={menu ? updateMenu : createMenu}
      hidden={menu ? { restaurantId, menuId: menu.id, kind: menu.kind } : { restaurantId }}
      readOnly={readOnly}
      submitLabel={menu ? 'Guardar' : 'Crear carta'}
      pendingLabel={menu ? 'Guardando…' : 'Creando…'}
    >
      {menu === null && (
        <FormSelect
          id={`${idPrefix}-kind`}
          label="Tipo"
          name="kind"
          defaultValue="carta"
          options={MENU_KINDS.map((k) => ({ value: k, label: MENU_KIND_LABELS_ES[k] }))}
        />
      )}
      {menu === null ? (
        <FormField
          id={`${idPrefix}-name_es`}
          label="Nombre"
          name="name_es"
          maxLength={60}
          required
          placeholder="Carta, Bebidas, Menú del día…"
          hint="Las traducciones las añades después, al editarla."
        />
      ) : (
        <I18nFields prefix="name" label="Nombre" enabled={enabled} values={menu.names} maxLength={60} required idPrefix={idPrefix} />
      )}
      <FormCheckbox name="active" label="Se ve en tu web" defaultChecked={menu ? menu.active : true} />
      {scheduled && (
        <fieldset className="flex flex-col gap-4 rounded-[6px] border-2 border-ink/10 p-4">
          <legend className="px-1 text-sm font-bold">
            {menu === null ? 'Solo para el menú del día o un menú especial' : 'Precio y cuándo se ve'}
          </legend>
          <FormField
            id={`${idPrefix}-price`}
            label="Precio del menú (€)"
            name="price"
            inputMode="decimal"
            placeholder="15,50"
            defaultValue={menu && menu.priceCents !== null ? centsToInput(menu.priceCents) : ''}
          />
          {menu === null ? (
            <FormField id={`${idPrefix}-includes_es`} label="Incluye (opcional)" name="includes_es" maxLength={300} placeholder="Pan, bebida y postre o café" />
          ) : (
            <I18nFields prefix="includes" label="Incluye (opcional)" enabled={enabled} values={menu.includes} maxLength={300} idPrefix={idPrefix} />
          )}
          <FormCheckboxGroup
            legend="Días"
            name="weekdays"
            options={WEEKDAYS.map((d) => ({
              value: String(d),
              label: WEEKDAY_LABELS_ES[d],
              defaultChecked: menu ? (menu.weekdays ?? []).includes(d) : d <= 5,
            }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${idPrefix}-start`}
              label="Desde (opcional)"
              name="start"
              type="time"
              defaultValue={menu && menu.startMinute !== null ? minutesToTime(menu.startMinute) : ''}
            />
            <FormField
              id={`${idPrefix}-end`}
              label="Hasta (opcional)"
              name="end"
              type="time"
              defaultValue={menu && menu.endMinute !== null ? minutesToTime(menu.endMinute) : ''}
              hint="Sin horas, se ve todo el día. Si acaba después de medianoche, ponlo tal cual (de 20:00 a 01:00)."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${idPrefix}-dateFrom`}
              label="Primer día (obligatorio en un menú especial)"
              name="dateFrom"
              type="date"
              defaultValue={menu?.dateFrom ?? ''}
            />
            <FormField
              id={`${idPrefix}-dateTo`}
              label="Último día"
              name="dateTo"
              type="date"
              defaultValue={menu?.dateTo ?? ''}
              hint="Déjalo vacío si es un solo día."
            />
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}
