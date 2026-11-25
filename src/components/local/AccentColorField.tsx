'use client';

import { useState } from 'react';
import { FormFieldError } from '@/components/forms/ActionForm';
import { accentTheme, normalizeHex } from '@/lib/color';

/** Selector del color de acento con vista previa del botón y aviso si no se lee bien. */
export function AccentColorField({ defaultValue }: { defaultValue: string }) {
  const [color, setColor] = useState(defaultValue);
  const theme = accentTheme(normalizeHex(color));
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="f-accentColor" className="text-sm font-bold">
        Color de tu web
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <input
          id="f-accentColor"
          type="color"
          name="accentColor"
          value={color}
          onChange={(e) => setColor(e.currentTarget.value.toUpperCase())}
          className="h-11 w-16 cursor-pointer rounded-[6px] border-2 border-ink/25 bg-white"
        />
        <span
          className="rounded-[6px] px-5 py-3 font-bold"
          style={{ backgroundColor: theme.accent, color: theme.onAccent }}
          aria-hidden="true"
        >
          Cómo llegar
        </span>
        <span className="font-mono text-sm">{normalizeHex(color) ?? color}</span>
      </div>
      {!theme.meetsAA && (
        <p className="text-sm font-medium text-red-700">Con este color el texto de los botones no se lee bien. Prueba uno más claro o más oscuro.</p>
      )}
      <FormFieldError name="accentColor" />
    </div>
  );
}
