import { ActionForm, FormCheckbox, type FormAction } from '@/components/forms/ActionForm';

/** Borrar con una casilla de confirmación (sin ventanas emergentes). */
export function ConfirmDeleteForm({
  action,
  hidden,
  confirmLabel,
  submitLabel,
  readOnly = false,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  confirmLabel: string;
  submitLabel: string;
  readOnly?: boolean;
}) {
  return (
    <ActionForm action={action} hidden={hidden} readOnly={readOnly} submitLabel={submitLabel} pendingLabel="Borrando…" submitVariant="danger">
      <FormCheckbox name="confirm" label={confirmLabel} />
    </ActionForm>
  );
}
