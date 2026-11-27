'use client';

import { useEffect, useRef, useState } from 'react';
import { FormCheckboxGroup } from '@/components/forms/ActionForm';
import type { MenuKind } from '@/lib/menu/codes';
import { WEEKDAY_LABELS_ES, WEEKDAYS } from '@/lib/schedule';

/**
 * Días en que se ve un menú del día o especial. Al editar, los guardados. Al crear (saved = null), siguen al tipo
 * elegido en el formulario: de lunes a viernes y, en un menú especial, los 7 (cambiar de tipo los vuelve a poner).
 */
export function MenuWeekdays({ kind: initialKind, saved }: { kind: MenuKind; saved: number[] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState(initialKind);

  useEffect(() => {
    if (saved !== null) return;
    const select = ref.current?.closest('form')?.elements.namedItem('kind');
    if (!(select instanceof HTMLSelectElement)) return;
    const onChange = () => setKind(select.value as MenuKind);
    onChange();
    select.addEventListener('change', onChange);
    return () => select.removeEventListener('change', onChange);
  }, [saved]);

  return (
    <div ref={ref}>
      <FormCheckboxGroup
        key={saved ? 'saved' : kind}
        legend="Días"
        name="weekdays"
        hint={kind === 'special' ? 'En un menú especial, marca todos los días en que se sirve.' : undefined}
        options={WEEKDAYS.map((d) => ({
          value: String(d),
          label: WEEKDAY_LABELS_ES[d],
          defaultChecked: saved ? saved.includes(d) : kind === 'special' || d <= 5,
        }))}
      />
    </div>
  );
}
