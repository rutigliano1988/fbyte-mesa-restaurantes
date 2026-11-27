import type { CustomerWarning } from '@/lib/reservations/customers';

/** Avisos del cliente en la reserva: los importantes, en rojo y con «Atención:» para los lectores de pantalla. */
export function CustomerWarnings({ warnings }: { warnings: CustomerWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul aria-label="Avisos del cliente" className="flex flex-wrap gap-1.5">
      {warnings.map((w) => (
        <li
          key={w.text}
          className={`rounded-[6px] px-2 py-0.5 text-xs font-bold ${w.tone === 'warning' ? 'bg-red-50 text-red-800' : 'bg-peach-soft text-ink'}`}
        >
          {w.tone === 'warning' && <span className="sr-only">Atención: </span>}
          {w.text}
        </li>
      ))}
    </ul>
  );
}
