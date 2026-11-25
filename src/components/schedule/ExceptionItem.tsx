import { deleteException } from '@/lib/actions/schedule';
import { formatDateEs, formatRange, type ScheduleException } from '@/lib/schedule';

export function ExceptionItem({
  restaurantId,
  exception,
  readOnly,
}: {
  restaurantId: string;
  exception: ScheduleException & { id: string };
  readOnly: boolean;
}) {
  const { dateFrom, dateTo, kind, customServices, note } = exception;
  const dates = dateFrom === dateTo ? formatDateEs(dateFrom) : `${formatDateEs(dateFrom)} – ${formatDateEs(dateTo)}`;
  const detail =
    kind === 'closed'
      ? 'Cerrado'
      : `Horario especial: ${customServices.map((s) => `${s.name} ${formatRange(s.startMinute, s.endMinute)}`).join(' · ')}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 py-3">
      <span>
        <strong>{dates}</strong> · {detail}
        {note && <span className="block text-sm text-muted">{note}</span>}
      </span>
      {!readOnly && (
        <form action={deleteException}>
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="exceptionId" value={exception.id} />
          <button type="submit" className="text-sm font-bold text-red-700 hover:underline">
            Quitar
          </button>
        </form>
      )}
    </li>
  );
}
