import { FormField, FormTextArea } from '@/components/forms/ActionForm';
import { LOCALE_LABELS_ES, LOCALES, type Locale } from '@/lib/i18n/locales';
import type { I18nText } from '@/lib/menu/i18n-text';

/**
 * Un texto en cada idioma activo del restaurante: castellano primero (obligatorio si required) y, en los demás,
 * el aviso «Falta la traducción» si está vacío. Los idiomas desactivados que tenían texto viajan ocultos para no perderlo.
 * idPrefix hace únicos los id cuando hay varios formularios iguales en la página.
 */
export function I18nFields({
  prefix,
  label,
  enabled,
  values,
  maxLength,
  multiline = false,
  required = false,
  idPrefix,
  hint,
}: {
  prefix: string;
  label: string;
  enabled: readonly Locale[];
  values?: I18nText | null;
  maxLength: number;
  multiline?: boolean;
  required?: boolean;
  idPrefix: string;
  hint?: string;
}) {
  const hidden = LOCALES.filter((l) => !enabled.includes(l) && values?.[l]);
  return (
    <div className="flex flex-col gap-3">
      {enabled.map((locale) => {
        const name = `${prefix}_${locale}`;
        const value = values?.[locale] ?? '';
        const props = {
          id: `${idPrefix}-${name}`,
          label: enabled.length > 1 ? `${label} (${LOCALE_LABELS_ES[locale]})` : label,
          name,
          defaultValue: value,
          maxLength,
          required: required && locale === 'es',
          hint: locale === 'es' ? hint : value ? undefined : 'Falta la traducción: mientras tanto se verá en castellano.',
        };
        return multiline ? <FormTextArea key={locale} {...props} rows={3} /> : <FormField key={locale} {...props} />;
      })}
      {hidden.map((l) => (
        <input key={l} type="hidden" name={`${prefix}_${l}`} value={values?.[l] ?? ''} />
      ))}
    </div>
  );
}
