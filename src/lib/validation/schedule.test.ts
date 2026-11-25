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

  it('rechaza fechas que no existen', () => {
    const from = exceptionSchema.safeParse({ dateFrom: '2026-02-31', dateTo: '', kind: 'closed', note: '', ...emptyServices });
    expect(from.success).toBe(false);
    if (from.success) return;
    expect(fieldErrorsFrom(from.error)).toEqual({ dateFrom: 'Esa fecha no existe.' });

    const to = exceptionSchema.safeParse({ dateFrom: '2026-02-27', dateTo: '2026-02-30', kind: 'closed', note: '', ...emptyServices });
    expect(to.success).toBe(false);
    if (to.success) return;
    expect(fieldErrorsFrom(to.error)).toEqual({ dateTo: 'Esa fecha no existe.' });

    const leap = exceptionSchema.safeParse({ dateFrom: '2028-02-29', dateTo: '2028-13-01', kind: 'closed', note: '', ...emptyServices });
    expect(leap.success).toBe(false);
    if (leap.success) return;
    expect(fieldErrorsFrom(leap.error)).toEqual({ dateTo: 'Esa fecha no existe.' });
    expect(exceptionSchema.safeParse({ dateFrom: '2028-02-29', dateTo: '', kind: 'closed', note: '', ...emptyServices }).success).toBe(true);

    const empty = exceptionSchema.safeParse({ dateFrom: '', dateTo: '', kind: 'closed', note: '', ...emptyServices });
    expect(empty.success).toBe(false);
    if (empty.success) return;
    expect(empty.error.issues.map((i) => i.message)).toEqual(['Elige una fecha.']);
  });
});
