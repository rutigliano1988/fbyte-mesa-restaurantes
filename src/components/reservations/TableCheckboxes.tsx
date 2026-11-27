'use client';

import { capacityOf, type BookingTable } from '@/lib/reservations/availability';

/**
 * Mesas para elegir a mano (una o varias): las libres a esa hora y, si ya estaban elegidas, también las que no lo
 * están (avisando). Dice si entre todas caben las personas.
 */
export function TableCheckboxes({
  name = 'tableIds',
  legend,
  free,
  all,
  selected,
  onChange,
  partySize,
  error,
}: {
  name?: string;
  legend: string;
  free: readonly BookingTable[];
  all: readonly BookingTable[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  partySize: number;
  error?: string;
}) {
  const freeIds = new Set(free.map((t) => t.id));
  const extra = all.filter((t) => selected.includes(t.id) && !freeIds.has(t.id));
  const options = [...free, ...extra];
  const chosen = all.filter((t) => selected.includes(t.id));
  const capacity = capacityOf(chosen);
  const errId = `f-${name}-err`;
  const sumId = `f-${name}-sum`;
  // aria-invalid y tabIndex: ActionForm lleva aquí el foco si falta elegir mesa.
  return (
    <fieldset className="flex flex-col gap-2" aria-invalid={!!error} tabIndex={-1} aria-describedby={error ? `${errId} ${sumId}` : sumId}>
      <legend className="mb-1 text-sm font-bold">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted">No hay ninguna mesa libre a esa hora.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.map((t) => (
            <li key={t.id}>
              <label className="flex items-center gap-2 rounded-[6px] border-2 border-ink/10 px-3 py-2 focus-within:border-navy">
                <input
                  type="checkbox"
                  name={name}
                  value={t.id}
                  checked={selected.includes(t.id)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id))}
                  className="size-4 accent-navy"
                />
                <span>
                  <span className="font-bold">{t.name}</span> · {t.zoneName} · {t.minCapacity}–{t.maxCapacity} personas
                  {!freeIds.has(t.id) && <span className="font-bold text-red-700"> · ocupada o bloqueada a esa hora</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p id={sumId} className={`text-sm ${chosen.length > 0 && capacity < partySize ? 'font-bold text-red-700' : 'text-muted'}`}>
        {chosen.length === 0 ? 'Ninguna mesa elegida.' : `Sitio para ${capacity} de ${partySize} ${partySize === 1 ? 'persona' : 'personas'}.`}
      </p>
      {error && (
        <p id={errId} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
