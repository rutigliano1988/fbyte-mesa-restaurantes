import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '../forms';
import { exceptionSchema, newServicesSchema, serviceSchema } from './schedule';

const emptyServices = { name1: '', start1: '', end1: '', name2: '', start2: '', end2: '' };

describe('servicios', () => {
  it('newServicesSchema: varios días y cena después de medianoche', () => {
    expect(newServicesSchema.parse({ name: ' Cena ', start: '20:00', end: '00:30', weekdays: ['5', '6', '5'] })).toEqual({
      name: 'Cena',
      weekdays: [5, 6],
      startMinute: 1200,
      endMinute: 1470,
    });
  });

  it('errores por campo en castellano', () => {
    const r = newServicesSchema.safeParse({ name: '', start: '9', end: '16:00', weekdays: [] });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error)).toEqual({
      name: 'Ponle nombre al servicio (por ejemplo, Comida o Cena).',
      weekdays: 'Elige al menos un día.',
    });
    const r2 = serviceSchema.safeParse({ name: 'Cena', start: '22:00', end: '07:00' });
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(fieldErrorsFrom(r2.error).end).toBe('Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.');
  });

  it('serviceSchema avisa de una hora mal escrita', () => {
    const r = serviceSchema.safeParse({ name: 'Comida', start: '9', end: '16:00' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).start).toBe('Escribe la hora así: 13:30.');
  });
});

describe('exceptionSchema', () => {
  it('un cierre de un solo día no necesita fecha final', () => {
    expect(exceptionSchema.parse({ dateFrom: '2026-12-25', dateTo: '', kind: 'closed', note: ' Navidad ', ...emptyServices })).toEqual({
      dateFrom: '2026-12-25',
      dateTo: '2026-12-25',
      kind: 'closed',
      note: 'Navidad',
      customServices: [],
    });
  });

  it('un horario especial con dos servicios', () => {
    const r = exceptionSchema.parse({
      dateFrom: '2026-12-31',
      dateTo: '2026-12-31',
      kind: 'custom',
      note: '',
      name1: 'Comida',
      start1: '13:00',
      end1: '16:00',
      name2: 'Cotillón',
      start2: '21:00',
      end2: '03:00',
    });
    expect(r.customServices).toEqual([
      { name: 'Comida', start_minute: 780, end_minute: 960 },
      { name: 'Cotillón', start_minute: 1260, end_minute: 1620 },
    ]);
  });

  it('rechaza fechas al revés, horarios especiales vacíos y servicios solapados', () => {
    const bad = exceptionSchema.safeParse({ dateFrom: '2026-12-26', dateTo: '2026-12-24', kind: 'custom', note: '', ...emptyServices });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(fieldErrorsFrom(bad.error)).toEqual({ dateTo: 'La fecha final no puede ser anterior a la inicial.' });

    const empty = exceptionSchema.safeParse({ dateFrom: '2026-12-24', dateTo: '', kind: 'custom', note: '', ...emptyServices });
    expect(empty.success).toBe(false);
    if (empty.success) return;
    expect(fieldErrorsFrom(empty.error)).toEqual({ name1: 'Añade al menos un servicio para el horario especial.' });

    const overlap = exceptionSchema.safeParse({
      dateFrom: '2026-12-24',
      dateTo: '',
      kind: 'custom',
      note: '',
      name1: 'A',
      start1: '13:00',
      end1: '16:00',
      name2: 'B',
      start2: '15:00',
      end2: '17:00',
    });
    expect(overlap.success).toBe(false);
    if (overlap.success) return;
    expect(fieldErrorsFrom(overlap.error)).toEqual({ end2: 'Los dos servicios se solapan.' });
  });
});
