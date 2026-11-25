'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SelectField } from '@/components/ui/SelectField';
import type { FormState } from '@/lib/forms';

export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: {}, pending: false });

export function useActionForm() {
  return useContext(FormContext);
}

/**
 * Formulario del panel con una server action (prev, fd) => FormState.
 * Se envía con onSubmit + startTransition en vez de action={…}: así React no vacía los campos
 * y, si hay errores, lo escrito se conserva. Los campos Form* leen sus errores del contexto.
 */
export function ActionForm({
  action,
  hidden = {},
  readOnly = false,
  inline = false,
  submitLabel = 'Guardar',
  pendingLabel = 'Guardando…',
  submitDisabled = false,
  children,
}: {
  action: FormAction;
  hidden?: Record<string, string>;
  readOnly?: boolean;
  inline?: boolean;
  submitLabel?: string;
  pendingLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [state]);
  const layout = inline ? 'flex flex-wrap items-end gap-3' : 'flex flex-col gap-4';
  return (
    <FormContext value={{ state, pending }}>
      <form
        ref={formRef}
        method="post"
        className={layout}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => dispatch(fd));
        }}
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <fieldset disabled={readOnly} className={`min-w-0 ${layout}`}>
          {children}
        </fieldset>
        {!readOnly && (
          <div>
            <Button type="submit" disabled={pending || submitDisabled} aria-busy={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        )}
        {state.error && (
          <div className="basis-full">
            <Notice tone="error">{state.error}</Notice>
          </div>
        )}
        {state.success && !pending && (
          <div className="basis-full">
            <Notice tone="success">{state.success}</Notice>
          </div>
        )}
      </form>
    </FormContext>
  );
}

export function FormField(props: Omit<ComponentProps<typeof Field>, 'error'>) {
  const { state } = useActionForm();
  return <Field {...props} error={state.fieldErrors?.[props.name]} />;
}

export function FormSelect(props: Omit<ComponentProps<typeof SelectField>, 'error'>) {
  const { state } = useActionForm();
  return <SelectField {...props} error={state.fieldErrors?.[props.name]} />;
}

export function FormFieldError({ name, id }: { name: string; id?: string }) {
  const { state } = useActionForm();
  const error = state.fieldErrors?.[name];
  return error ? <p id={id} className="text-sm font-medium text-red-700">{error}</p> : null;
}

export function FormTextArea({
  label,
  name,
  hint,
  id: idProp,
  ...textarea
}: ComponentProps<'textarea'> & { label: string; name: string; hint?: string }) {
  const { state } = useActionForm();
  const error = state.fieldErrors?.[name];
  const id = idProp ?? `f-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={inputClass}
        {...textarea}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormCheckbox({ name, label, defaultChecked }: { name: string; label: ReactNode; defaultChecked?: boolean }) {
  const { state } = useActionForm();
  const errId = `f-${name}-err`;
  const invalid = !!state.fieldErrors?.[name];
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-invalid={invalid}
          aria-describedby={invalid ? errId : undefined}
          className="mt-1 size-4 accent-navy"
        />
        <span>{label}</span>
      </label>
      <FormFieldError name={name} id={errId} />
    </div>
  );
}

export function FormCheckboxGroup({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; defaultChecked?: boolean; disabled?: boolean }[];
}) {
  const { state } = useActionForm();
  const errId = `f-${name}-err`;
  const invalid = !!state.fieldErrors?.[name];
  return (
    <fieldset className="flex flex-col gap-2" aria-invalid={invalid} aria-describedby={invalid ? errId : undefined}>
      <legend className="mb-1 text-sm font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={o.defaultChecked}
              disabled={o.disabled}
              className="size-4 accent-navy"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FormFieldError name={name} id={errId} />
    </fieldset>
  );
}
