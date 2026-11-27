import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from './codes';
import { canUndo, nextActions, undoLabel } from './transitions';

describe('cambios de estado', () => {
  it('pendiente → confirmar, rechazar o cancelar', () => {
    expect(nextActions('pending').map((a) => a.to)).toEqual(['confirmed', 'rejected', 'cancelled_customer', 'cancelled_restaurant']);
  });

  it('confirmada → sentar, no ha venido o cancelar; en mesa → finalizar', () => {
    expect(nextActions('confirmed').map((a) => a.label)).toEqual(['Sentar', 'No ha venido', 'Cancela el cliente', 'Cancelamos nosotros']);
    expect(nextActions('seated').map((a) => a.to)).toEqual(['completed']);
  });

  it('los estados finales no tienen botones', () => {
    for (const s of ['completed', 'cancelled_customer', 'cancelled_restaurant', 'rejected', 'no_show'] as const) {
      expect(nextActions(s)).toEqual([]);
    }
  });

  it('los botones de cada estado coinciden con la tabla de la BD (reservation_transition_ok)', () => {
    const allowed = new Set([
      'pending>confirmed',
      'pending>rejected',
      'pending>cancelled_customer',
      'pending>cancelled_restaurant',
      'confirmed>seated',
      'confirmed>no_show',
      'confirmed>cancelled_customer',
      'confirmed>cancelled_restaurant',
      'seated>completed',
    ]);
    for (const from of RESERVATION_STATUSES) {
      for (const to of RESERVATION_STATUSES) {
        expect(nextActions(from).some((a) => a.to === to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('un estado desconocido (también los heredados, como toString) no tiene botones', () => {
    expect(nextActions('toString' as 'pending')).toEqual([]);
  });
});

describe('deshacer', () => {
  it('se deshace un no-show, una cancelación, un rechazo o un finalizar, si hay estado anterior activo', () => {
    expect(canUndo('no_show', 'confirmed')).toBe(true);
    expect(canUndo('completed', 'seated')).toBe(true);
    expect(canUndo('rejected', 'pending')).toBe(true);
    expect(canUndo('cancelled_restaurant', null)).toBe(false);
    expect(canUndo('seated', 'confirmed')).toBe(false);
    expect(canUndo('no_show', 'completed')).toBe(false);
  });

  it('el botón dice qué deshace', () => {
    expect(undoLabel('no_show')).toBe('Deshacer «No vino»');
  });
});
