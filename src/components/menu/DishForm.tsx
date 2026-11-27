import { ActionForm, FormCheckboxGroup, FormField, FormSelect } from '@/components/forms/ActionForm';
import { saveDish } from '@/lib/actions/dishes';
import type { Locale } from '@/lib/i18n/locales';
import { ALLERGEN_LABELS_ES, ALLERGENS, DISH_TAGS, PRICE_KIND_LABELS_ES, PRICE_KINDS, TAG_LABELS_ES } from '@/lib/menu/codes';
import { centsToInput } from '@/lib/menu/price';
import type { PanelDish } from '@/lib/menu/tree';
import { PRICE_ROWS } from '@/lib/menu/validation';
import { I18nFields } from './I18nFields';

/** Editor de plato: textos en cada idioma activo (con aviso si falta la traducción), precios, alérgenos y etiquetas. */
export function DishForm({
  restaurantId,
  dish,
  enabled,
  hidden = {},
  readOnly,
}: {
  restaurantId: string;
  dish: PanelDish | null;
  enabled: Locale[];
  hidden?: Record<string, string>;
  readOnly: boolean;
}) {
  const idPrefix = dish ? `plato-${dish.id}` : 'plato-nuevo';
  return (
    <ActionForm
      action={saveDish}
      hidden={{ restaurantId, ...(dish ? { dishId: dish.id } : {}), ...hidden }}
      readOnly={readOnly}
      submitLabel={dish ? 'Guardar plato' : 'Crear plato'}
      pendingLabel="Guardando…"
    >
      <I18nFields prefix="name" label="Nombre" enabled={enabled} values={dish?.names} maxLength={120} required idPrefix={idPrefix} />
      <I18nFields
        prefix="description"
        label="Descripción (opcional)"
        enabled={enabled}
        values={dish?.descriptions}
        maxLength={500}
        multiline
        idPrefix={idPrefix}
        hint="Ingredientes o cómo lo preparas. Como mucho 500 caracteres."
      />

      <fieldset className="flex flex-col gap-4 rounded-[6px] border-2 border-ink/10 p-4">
        <legend className="px-1 text-sm font-bold">Precios</legend>
        <p className="text-sm text-muted">
          Hasta 4: por ejemplo, Ración y Media, o Copa y Botella. «Según mercado» va solo y sin importe. Deja vacías las filas que no uses.
        </p>
        {PRICE_ROWS.map((n) => {
          const price = dish?.prices[n];
          return (
            <div key={n} className="grid gap-3 rounded-[6px] bg-paper p-3 sm:grid-cols-2">
              <FormSelect
                id={`${idPrefix}-price${n}_kind`}
                label={`Precio ${n + 1}: tipo`}
                name={`price${n}_kind`}
                defaultValue={price?.kind ?? 'fixed'}
                options={PRICE_KINDS.map((k) => ({ value: k, label: PRICE_KIND_LABELS_ES[k] }))}
              />
              <FormField
                id={`${idPrefix}-price${n}_amount`}
                label={`Precio ${n + 1}: importe (€)`}
                name={`price${n}_amount`}
                inputMode="decimal"
                placeholder={n === 0 ? '12,50' : undefined}
                defaultValue={price && price.priceCents !== null ? centsToInput(price.priceCents) : ''}
              />
              <div className="sm:col-span-2">
                <I18nFields
                  prefix={`price${n}_label`}
                  label={`Precio ${n + 1}: etiqueta (opcional)`}
                  enabled={enabled}
                  values={price?.labels}
                  maxLength={40}
                  idPrefix={idPrefix}
                  hint="Por ejemplo: Ración, Media, Copa o Botella."
                />
              </div>
            </div>
          );
        })}
      </fieldset>

      <FormCheckboxGroup
        legend="Alérgenos que lleva"
        name="allergens"
        options={ALLERGENS.map((a) => ({ value: a, label: ALLERGEN_LABELS_ES[a], defaultChecked: dish?.allergens.includes(a) ?? false }))}
      />
      <p className="-mt-2 text-sm text-muted">Si no marcas ninguno, en tu carta saldrá «Pregunta al personal por los alérgenos».</p>
      <FormCheckboxGroup
        legend="Etiquetas"
        name="tags"
        options={DISH_TAGS.map((t) => ({ value: t, label: TAG_LABELS_ES[t], defaultChecked: dish?.tags.includes(t) ?? false }))}
      />
    </ActionForm>
  );
}
