import Link from 'next/link';
import { CustomerWarnings } from '@/components/reservations/CustomerWarnings';
import { ReservationActions } from '@/components/reservations/ReservationActions';
import { SOURCE_LABELS_ES } from '@/lib/reservations/codes';
import { customerWarnings } from '@/lib/reservations/customers';
import { formatPhoneDisplay } from '@/lib/reservations/phone';
import type { PanelReservation } from '@/lib/reservations/rows';
import { formatTime } from '@/lib/reservations/time';

/** Nombre que se enseña: el del cliente o, en un walk-in sin datos, «Sin nombre». */
export function reservationName(r: Pick<PanelReservation, 'customer'>): string {
  return r.customer?.name ?? 'Sin nombre';
}

/** 'T4 + T5' o 'Sin mesa'. */
export function tablesText(tableIds: readonly string[], tableNames: ReadonlyMap<string, string>): string {
  return tableIds.length === 0 ? 'Sin mesa' : tableIds.map((id) => tableNames.get(id) ?? '¿?').join(' + ');
}

/** Una reserva en la lista del día: hora, nombre, personas, mesas, notas, avisos del cliente y estado con sus botones. */
export function ReservationItem({
  restaurantId,
  reservation: r,
  tableNames,
  timeZone,
  readOnly,
}: {
  restaurantId: string;
  reservation: PanelReservation;
  tableNames: ReadonlyMap<string, string>;
  timeZone: string;
  readOnly: boolean;
}) {
  const time = formatTime(r.startMs, timeZone);
  const name = reservationName(r);
  return (
    <li className="flex flex-col gap-3 rounded-[6px] border-2 border-ink/10 bg-white p-3 sm:flex-row sm:items-start">
      <p className="w-16 shrink-0 text-xl font-extrabold tabular-nums">{time}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-bold">
          <Link
            href={`/panel/${restaurantId}/reservas/${r.id}`}
            className="text-navy hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            {name}
          </Link>{' '}
          · {r.partySize} {r.partySize === 1 ? 'persona' : 'personas'} · {tablesText(r.tableIds, tableNames)}
        </p>
        <p className="text-sm text-muted">
          {SOURCE_LABELS_ES[r.source]}
          {r.customer?.phone && ` · ${formatPhoneDisplay(r.customer.phone)}`}
        </p>
        {r.notes && (
          <p className="text-sm">
            <span className="font-bold">Nota del cliente:</span> {r.notes}
          </p>
        )}
        {r.internalNotes && (
          <p className="text-sm">
            <span className="font-bold">Nota interna:</span> {r.internalNotes}
          </p>
        )}
        {r.customer && <CustomerWarnings warnings={customerWarnings(r.customer)} />}
      </div>
      <div className="sm:max-w-sm">
        <ReservationActions
          restaurantId={restaurantId}
          reservationId={r.id}
          status={r.status}
          previousStatus={r.previousStatus}
          who={`${name}, ${time}`}
          readOnly={readOnly}
        />
      </div>
    </li>
  );
}
