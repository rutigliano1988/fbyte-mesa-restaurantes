import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
};

export const inputClass =
  'w-full rounded-[6px] border-2 border-ink/25 bg-white px-3 py-2.5 text-ink ' +
  'focus:border-navy focus:outline-none aria-[invalid=true]:border-red-700';

export function Field({ label, name, error, hint, id, ...input }: Props) {
  const fieldId = id ?? `f-${name}`;
  const describedBy = error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-bold">
        {label}
      </label>
      <input id={fieldId} name={name} aria-invalid={!!error} aria-describedby={describedBy} className={inputClass} {...input} />
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-err`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
