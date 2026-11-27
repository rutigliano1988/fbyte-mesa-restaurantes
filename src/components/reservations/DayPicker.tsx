import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { addDays, formatDayEs } from '@/lib/reservations/time';

/** Día que se ve: anterior, hoy, siguiente y un calendario (formulario GET, funciona sin JavaScript). */
export function DayPicker({ path, date, today, keep = {} }: { path: string; date: string; today: string; keep?: Record<string, string> }) {
  const href = (d: string) => `${path}?${new URLSearchParams({ ...keep, fecha: d }).toString()}`;
  const small = buttonClass('secondary', 'px-3 py-2 text-sm');
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-extrabold tracking-tight">
        {formatDayEs(date)}
        {date === today && <span className="ml-2 align-middle text-base font-bold text-muted">(hoy)</span>}
      </h1>
      <div className="flex flex-wrap items-end gap-2">
        <Link href={href(addDays(date, -1))} className={small}>
          <span aria-hidden="true">←</span> Día anterior
        </Link>
        {date !== today && (
          <Link href={href(today)} className={small}>
            Hoy
          </Link>
        )}
        <Link href={href(addDays(date, 1))} className={small}>
          Día siguiente <span aria-hidden="true">→</span>
        </Link>
        <form method="get" action={path} className="flex items-end gap-2">
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label className="flex flex-col gap-1 text-sm font-bold">
            Ir a la fecha
            <input type="date" name="fecha" defaultValue={date} required className={`${inputClass} py-1.5`} />
          </label>
          <button type="submit" className={small}>
            Ver
          </button>
        </form>
      </div>
    </div>
  );
}
