import { describe, expect, it } from 'vitest';
import { EMAIL_KIND_LABELS_ES, EMAIL_KINDS, emailKindsFor, failedEmailText, isCustomerKind } from './outbox-rules';

const base = { op: 'UPDATE' as const, moved: false, source: 'online' as const, actor: 'staff' as const, notifySwitchedOn: false };

describe('reglas de encolado (espejo de la BD)', () => {
  it('altas', () => {
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'pending', actor: 'customer' })).toEqual(['customer_pending', 'restaurant_request']);
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'confirmed', actor: 'customer' })).toEqual(['customer_confirmed', 'restaurant_new']);
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'confirmed', source: 'phone' })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, op: 'INSERT', oldStatus: null, newStatus: 'seated', source: 'walk_in' })).toEqual([]);
  });

  it('cambios de estado, de hora y de avisos', () => {
    expect(emailKindsFor({ ...base, oldStatus: 'pending', newStatus: 'confirmed' })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, oldStatus: 'pending', newStatus: 'rejected' })).toEqual(['customer_rejected']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'cancelled_customer', actor: 'customer' })).toEqual(['customer_cancelled', 'restaurant_cancelled']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'cancelled_restaurant' })).toEqual(['customer_cancelled']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'pending', moved: true, actor: 'customer' })).toEqual(['customer_modified', 'restaurant_modified']);
    expect(emailKindsFor({ ...base, oldStatus: 'rejected', newStatus: 'confirmed' })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, oldStatus: 'rejected', newStatus: 'pending' })).toEqual([]);
    expect(emailKindsFor({ ...base, oldStatus: 'seated', newStatus: 'completed', actor: 'system' })).toEqual([]);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'confirmed', notifySwitchedOn: true })).toEqual(['customer_confirmed']);
    expect(emailKindsFor({ ...base, oldStatus: 'confirmed', newStatus: 'confirmed' })).toEqual([]);
  });

  it('etiquetas y avisos en castellano para todos los tipos', () => {
    for (const kind of EMAIL_KINDS) {
      expect(EMAIL_KIND_LABELS_ES[kind].trim()).not.toBe('');
      expect(failedEmailText(kind)).toMatch(/^No pudimos enviar el email de .+\.$/);
    }
    expect(isCustomerKind('customer_reminder')).toBe(true);
    expect(isCustomerKind('restaurant_new')).toBe(false);
    expect(failedEmailText('customer_confirmed')).toBe('No pudimos enviar el email de confirmación al cliente.');
  });
});
