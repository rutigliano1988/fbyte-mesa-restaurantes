/** Estados de una reserva (igual que el tipo public.reservation_status). */
export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled_customer',
  'cancelled_restaurant',
  'rejected',
  'no_show',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_SOURCES = ['online', 'phone', 'walk_in'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

/** Ocupan mesa (igual que la restricción de exclusión de reservation_tables). */
export const ACTIVE_STATUSES: readonly ReservationStatus[] = ['pending', 'confirmed', 'seated'];
/** Cuentan en el resumen del día (reservas y personas). */
export const COUNTED_STATUSES: readonly ReservationStatus[] = ['pending', 'confirmed', 'seated', 'completed'];

export const STATUS_LABELS_ES: Record<ReservationStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  seated: 'En mesa',
  completed: 'Finalizada',
  cancelled_customer: 'Cancelada por el cliente',
  cancelled_restaurant: 'Cancelada por el restaurante',
  rejected: 'Rechazada',
  no_show: 'No vino',
};

/** Color y texto: el estado nunca se distingue solo por el color. */
export const STATUS_STYLES: Record<ReservationStatus, string> = {
  pending: 'border-orange-dark bg-peach-soft text-ink',
  confirmed: 'border-navy bg-on-navy-soft text-navy-dark',
  seated: 'border-ink bg-ink text-white',
  completed: 'border-ink/30 bg-white text-muted',
  cancelled_customer: 'border-red-700 bg-white text-red-800 line-through decoration-1',
  cancelled_restaurant: 'border-red-700 bg-white text-red-800 line-through decoration-1',
  rejected: 'border-red-700 bg-white text-red-800 line-through decoration-1',
  no_show: 'border-red-700 bg-red-50 text-red-800',
};

export const SOURCE_LABELS_ES: Record<ReservationSource, string> = {
  online: 'Web',
  phone: 'Teléfono',
  walk_in: 'Sin reserva',
};

export const CUSTOMER_TAGS = ['vip', 'regular', 'problem'] as const;
export type CustomerTag = (typeof CUSTOMER_TAGS)[number];
export const CUSTOMER_TAG_LABELS_ES: Record<CustomerTag, string> = {
  vip: 'VIP',
  regular: 'Habitual',
  problem: 'Problemático',
};

export const BOOKING_LIMITS = {
  zones: 20,
  tables: 100,
  durationRules: 6,
  partySize: 50,
  tablesPerReservation: 10,
  notes: 500,
  blockReason: 140,
} as const;

export function isReservationStatus(value: unknown): value is ReservationStatus {
  return typeof value === 'string' && Object.hasOwn(STATUS_LABELS_ES, value);
}

export function isActiveStatus(status: ReservationStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
