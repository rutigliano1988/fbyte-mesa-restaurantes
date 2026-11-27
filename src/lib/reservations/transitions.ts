import { STATUS_LABELS_ES, type ReservationStatus } from './codes';

export type StatusAction = { to: ReservationStatus; label: string; tone: 'primary' | 'secondary' | 'danger' };

const CANCELS: StatusAction[] = [
  { to: 'cancelled_customer', label: 'Cancela el cliente', tone: 'danger' },
  { to: 'cancelled_restaurant', label: 'Cancelamos nosotros', tone: 'danger' },
];

/** Cambios permitidos desde cada estado (igual que public.reservation_transition_ok), en el orden de los botones. */
const TRANSITIONS: Record<ReservationStatus, StatusAction[]> = {
  pending: [{ to: 'confirmed', label: 'Confirmar', tone: 'primary' }, { to: 'rejected', label: 'Rechazar', tone: 'danger' }, ...CANCELS],
  confirmed: [{ to: 'seated', label: 'Sentar', tone: 'primary' }, { to: 'no_show', label: 'No ha venido', tone: 'secondary' }, ...CANCELS],
  seated: [{ to: 'completed', label: 'Finalizar', tone: 'primary' }],
  completed: [],
  cancelled_customer: [],
  cancelled_restaurant: [],
  rejected: [],
  no_show: [],
};

/** Estados desde los que se puede deshacer el último cambio (vuelve al estado anterior). */
export const UNDOABLE_STATUSES: readonly ReservationStatus[] = [
  'no_show',
  'cancelled_customer',
  'cancelled_restaurant',
  'rejected',
  'completed',
];
const UNDO_TARGETS: readonly ReservationStatus[] = ['pending', 'confirmed', 'seated'];

export function nextActions(status: ReservationStatus): StatusAction[] {
  return Object.hasOwn(TRANSITIONS, status) ? TRANSITIONS[status] : [];
}

export function canUndo(status: ReservationStatus, previous: ReservationStatus | null): boolean {
  return UNDOABLE_STATUSES.includes(status) && previous !== null && UNDO_TARGETS.includes(previous);
}

/** 'Deshacer «No vino»'. */
export function undoLabel(status: ReservationStatus): string {
  return `Deshacer «${STATUS_LABELS_ES[status]}»`;
}
