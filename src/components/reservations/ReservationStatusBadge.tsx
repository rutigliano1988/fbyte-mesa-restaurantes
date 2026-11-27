import { STATUS_LABELS_ES, STATUS_STYLES, type ReservationStatus } from '@/lib/reservations/codes';

/** Estado con color y texto (nunca solo color). */
export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className={`inline-flex rounded-full border-2 px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[status]}`}>{STATUS_LABELS_ES[status]}</span>
  );
}
