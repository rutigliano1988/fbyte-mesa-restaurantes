'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { changeReservationStatus, undoReservationStatus } from '@/lib/actions/reservations';
import { GENERIC_ERROR } from '@/lib/menu/sortable';
import { STATUS_LABELS_ES, STATUS_STYLES, type ReservationStatus } from '@/lib/reservations/codes';
import { canUndo, nextActions, undoLabel } from '@/lib/reservations/transitions';

const TONES = { primary: 'primary', secondary: 'secondary', danger: 'danger' } as const;

/**
 * Estado de una reserva y sus botones (Confirmar, Sentar, Finalizar, No ha venido, Cancelar… y Deshacer).
 * El estado cambia al momento (optimista) y, si falla, vuelve al confirmado por el servidor. Mientras se guarda, los
 * botones quedan aria-disabled (sin perder el foco) y no se envía dos veces. Al acabar, el foco va a «Deshacer» o al
 * estado, y el resultado se anuncia en una región aria-live que siempre está.
 */
export function ReservationActions({
  restaurantId,
  reservationId,
  status,
  previousStatus,
  who,
  readOnly = false,
}: {
  restaurantId: string;
  reservationId: string;
  status: ReservationStatus;
  previousStatus: ReservationStatus | null;
  /** Para los nombres accesibles: 'García, 21:00'. */
  who: string;
  readOnly?: boolean;
}) {
  const [shown, setShown] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const busy = useRef(false);
  const moveFocus = useRef(false);
  const statusRef = useRef<HTMLSpanElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending || !moveFocus.current) return;
    moveFocus.current = false;
    (undoRef.current ?? statusRef.current)?.focus();
  }, [pending, status]);

  function run(next: ReservationStatus | null) {
    if (busy.current || readOnly) return;
    busy.current = true;
    setMessage({ text: '', error: false });
    startTransition(async () => {
      if (next) setShown(next);
      let result: { error?: string; success?: string };
      try {
        result = next
          ? await changeReservationStatus(restaurantId, reservationId, next)
          : await undoReservationStatus(restaurantId, reservationId);
      } catch {
        result = { error: GENERIC_ERROR };
      }
      busy.current = false;
      if (result.error) {
        setMessage({ text: result.error, error: true });
      } else {
        moveFocus.current = true;
        setMessage({ text: `${who}: ${result.success ?? 'Hecho.'}`, error: false });
      }
    });
  }

  const actions = readOnly ? [] : nextActions(status);
  const undo = !readOnly && canUndo(status, previousStatus);
  const disabledProps = pending ? { 'aria-disabled': true as const } : {};

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          ref={statusRef}
          tabIndex={-1}
          aria-busy={pending}
          className={`inline-flex rounded-full border-2 px-2.5 py-0.5 text-xs font-bold outline-offset-2 focus-visible:outline-3 focus-visible:outline-navy ${STATUS_STYLES[shown]}`}
        >
          <span className="sr-only">Estado: </span>
          {STATUS_LABELS_ES[shown]}
        </span>
        {actions.map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => run(a.to)}
            aria-label={`${a.label}: ${who}`}
            {...disabledProps}
            className={buttonClass(TONES[a.tone], 'px-3 py-1.5 text-sm aria-disabled:cursor-wait aria-disabled:opacity-60')}
          >
            {a.label}
          </button>
        ))}
        {undo && (
          <button
            ref={undoRef}
            type="button"
            onClick={() => run(null)}
            aria-label={`${undoLabel(status)}: ${who}`}
            {...disabledProps}
            className={buttonClass('ghost', 'px-2 py-1.5 text-sm aria-disabled:cursor-wait aria-disabled:opacity-60')}
          >
            {undoLabel(status)}
          </button>
        )}
      </div>
      <p aria-live="polite" className="text-sm font-medium text-muted">
        {message.error ? '' : message.text}
      </p>
      <p role="alert" className="text-sm font-medium text-red-700">
        {message.error ? message.text : ''}
      </p>
    </div>
  );
}
