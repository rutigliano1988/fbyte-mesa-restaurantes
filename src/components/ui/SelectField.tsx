import type { SelectHTMLAttributes } from 'react';
import { inputClass } from './Field';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  error?: string;
};

export function SelectField({ label, name, options, error, id, ...select }: Props) {
  const fieldId = id ?? `f-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-bold">
        {label}
      </label>
      <select id={fieldId} name={name} aria-invalid={!!error} className={inputClass} {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}
