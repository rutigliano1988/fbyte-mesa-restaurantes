import { describe, expect, it } from 'vitest';
import { lookupNotice, submitLabel, syncedDate } from './form';

describe('submitLabel', () => {
  it('alta: «Guardar sin mesa» si no hay hueco o se fuerza; si no, «Guardar reserva»', () => {
    expect(submitLabel('create', false, 'auto')).toBe('Guardar reserva');
    expect(submitLabel('create', true, 'auto')).toBe('Guardar sin mesa');
    expect(submitLabel('create', false, 'none')).toBe('Guardar sin mesa');
  });

  it('edición: «Guardar sin mesa» solo si la mesa propuesta no encuentra hueco', () => {
    expect(submitLabel('edit', false, 'keep')).toBe('Guardar cambios');
    expect(submitLabel('edit', false, 'none')).toBe('Guardar cambios');
    expect(submitLabel('edit', true, 'auto')).toBe('Guardar sin mesa');
  });
});

describe('lookupNotice', () => {
  it('cliente nuevo, encontrado (con avisos) o error', () => {
    expect(lookupNotice({ customer: null })).toEqual({ text: 'Cliente nuevo: se guardará su ficha con esta reserva.', warnings: [] });
    const warnings = [{ text: 'Cliente VIP.', tone: 'info' as const }];
    expect(lookupNotice({ customer: { name: 'Ana', email: null, warnings } })).toEqual({ text: 'Cliente encontrado: Ana.', warnings });
    expect(lookupNotice({ customer: null, error: 'Algo ha fallado.' })).toEqual({ text: 'Algo ha fallado.', warnings: [] });
    expect(lookupNotice(null).text).toBe('Algo ha fallado. Vuelve a intentarlo en un momento.');
  });

  it('un teléfono no válido no dice «Cliente nuevo»', () => {
    expect(lookupNotice({ customer: null, invalid: true })).toEqual({ text: 'Revisa el teléfono.', warnings: [] });
  });
});

describe('syncedDate', () => {
  it('sigue a la fecha de la página si el formulario no esperaba otra (p. ej., atrás o un enlace)', () => {
    expect(syncedDate('2030-06-14', '2030-06-14', '2030-06-20')).toBe('2030-06-20');
  });

  it('mientras se escribe otra fecha, una respuesta intermedia no la pisa', () => {
    expect(syncedDate('2030-06-20', '2030-06-14', '0203-06-20')).toBe('2030-06-20');
  });
});
