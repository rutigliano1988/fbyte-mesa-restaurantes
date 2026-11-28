import type { ReservationSource, ReservationStatus } from '@/lib/reservations/codes';

/** Tipos de email (igual que public.email_kind). */
export const EMAIL_KINDS = [
  'customer_pending',
  'customer_confirmed',
  'customer_modified',
  'customer_cancelled',
  'customer_rejected',
  'customer_reminder',
  'restaurant_new',
  'restaurant_request',
  'restaurant_modified',
  'restaurant_cancelled',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export type CustomerEmailKind = Extract<EmailKind, `customer_${string}`>;
export type RestaurantEmailKind = Extract<EmailKind, `restaurant_${string}`>;

export const EMAIL_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export type EmailActor = 'customer' | 'staff' | 'system';

export function isCustomerKind(kind: EmailKind): kind is CustomerEmailKind {
  return kind.startsWith('customer_');
}

const ACTIVE: readonly ReservationStatus[] = ['pending', 'confirmed'];

/**
 * Qué emails tocan con un alta o un cambio (espejo de public.reservation_email_kinds, que es la que manda; esta sirve
 * para entender y probar las reglas desde la app).
 */
export function emailKindsFor(input: {
  op: 'INSERT' | 'UPDATE';
  oldStatus: ReservationStatus | null;
  newStatus: ReservationStatus;
  moved: boolean;
  source: ReservationSource;
  actor: EmailActor;
  notifySwitchedOn: boolean;
}): EmailKind[] {
  const { op, oldStatus, newStatus, source, actor } = input;
  const byCustomer = actor === 'customer';
  if (source === 'walk_in') return [];
  if (op === 'INSERT') {
    if (newStatus === 'pending') return byCustomer ? ['customer_pending', 'restaurant_request'] : ['customer_pending'];
    if (newStatus === 'confirmed') return byCustomer && source === 'online' ? ['customer_confirmed', 'restaurant_new'] : ['customer_confirmed'];
    return [];
  }
  if (input.moved && oldStatus && ACTIVE.includes(oldStatus) && ACTIVE.includes(newStatus)) {
    return byCustomer ? ['customer_modified', 'restaurant_modified'] : ['customer_modified'];
  }
  if (oldStatus !== newStatus) {
    if (newStatus === 'confirmed' && oldStatus && ['pending', 'cancelled_customer', 'cancelled_restaurant', 'rejected'].includes(oldStatus)) {
      return ['customer_confirmed'];
    }
    if (newStatus === 'rejected') return ['customer_rejected'];
    if (newStatus === 'cancelled_restaurant') return ['customer_cancelled'];
    if (newStatus === 'cancelled_customer') return byCustomer ? ['customer_cancelled', 'restaurant_cancelled'] : ['customer_cancelled'];
    return [];
  }
  if (input.notifySwitchedOn) {
    if (newStatus === 'pending') return ['customer_pending'];
    if (newStatus === 'confirmed') return ['customer_confirmed'];
  }
  return [];
}

/** Para el historial de emails de la ficha de la reserva. */
export const EMAIL_KIND_LABELS_ES: Record<EmailKind, string> = {
  customer_pending: 'Solicitud recibida (al cliente)',
  customer_confirmed: 'Confirmación (al cliente)',
  customer_modified: 'Cambios en la reserva (al cliente)',
  customer_cancelled: 'Cancelación (al cliente)',
  customer_rejected: 'Reserva no confirmada (al cliente)',
  customer_reminder: 'Recordatorio (al cliente)',
  restaurant_new: 'Nueva reserva online (al restaurante)',
  restaurant_request: 'Reserva por confirmar (al restaurante)',
  restaurant_modified: 'Cambio del cliente (al restaurante)',
  restaurant_cancelled: 'Cancelación del cliente (al restaurante)',
};

export const EMAIL_STATUS_LABELS_ES: Record<EmailStatus, string> = {
  pending: 'Pendiente de envío',
  sending: 'Enviándose',
  sent: 'Enviado',
  failed: 'No se pudo enviar',
  skipped: 'No hacía falta',
};

/** «No pudimos enviar el email de confirmación al cliente». */
export function failedEmailText(kind: EmailKind): string {
  const what: Record<EmailKind, string> = {
    customer_pending: 'solicitud recibida al cliente',
    customer_confirmed: 'confirmación al cliente',
    customer_modified: 'cambios al cliente',
    customer_cancelled: 'cancelación al cliente',
    customer_rejected: 'reserva no confirmada al cliente',
    customer_reminder: 'recordatorio al cliente',
    restaurant_new: 'nueva reserva al restaurante',
    restaurant_request: 'reserva por confirmar al restaurante',
    restaurant_modified: 'cambio del cliente al restaurante',
    restaurant_cancelled: 'cancelación del cliente al restaurante',
  };
  return `No pudimos enviar el email de ${what[kind]}.`;
}
