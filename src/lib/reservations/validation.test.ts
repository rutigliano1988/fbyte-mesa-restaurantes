import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '@/lib/forms';
import {
  blockFormSchema,
  bookingSettingsSchema,
  phoneReservationSchema,
  reservationEditSchema,
  serviceBookingSchema,
  tableFormSchema,
  walkInSchema,
  zoneFormSchema,
} from './validation';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

function errors(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown) {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  return fieldErrorsFrom(r.error as never);
}

describe('zonas y mesas', () => {
  it('zona con nombre y orden', () => {
    expect(zoneFormSchema.parse({ name: ' Terraza ', position: '2' })).toEqual({ name: 'Terraza', position: 2 });
    expect(errors(zoneFormSchema, { name: '', position: '-1' })).toEqual({
      name: 'Ponle nombre a la zona (por ejemplo, Terraza).',
      position: 'Pon un número del 0 al 999.',
    });
  });

  it('mesa: capacidades, casillas y zona opcional', () => {
    const table = { zoneId: '', name: ' T4 ', minCapacity: '2', maxCapacity: '4', position: '0', onlineBookable: 'on', active: '' };
    expect(tableFormSchema.parse(table)).toEqual({ zoneId: null, name: 'T4', minCapacity: 2, maxCapacity: 4, position: 0, onlineBookable: true, active: false });
    expect(errors(tableFormSchema, { ...table, minCapacity: '6' })).toEqual({ minCapacity: 'El mínimo no puede ser mayor que el máximo.' });
    expect(errors(tableFormSchema, { ...table, zoneId: 'x', maxCapacity: '51' })).toEqual({
      zoneId: 'Elige una zona.',
      maxCapacity: 'Entre 1 y 50 personas.',
    });
  });
});

describe('ajustes de reserva', () => {
  const base = {
    defaultDuration: '90',
    minAdvanceMin: '60',
    maxAdvanceDays: '60',
    maxOnlineParty: '8',
    cancelLimitHours: '2',
    autoConfirm: 'on',
  };

  it('tramos rellenos, filas vacías fuera', () => {
    expect(
      bookingSettingsSchema.parse({ ...base, rule1_min: '1', rule1_max: '2', rule1_duration: '75', rule2_min: '', rule2_max: '', rule2_duration: '', rule3_min: '7', rule3_max: '50', rule3_duration: '150' }),
    ).toEqual({
      defaultDurationMin: 90,
      durationRules: [
        { minParty: 1, maxParty: 2, durationMin: 75 },
        { minParty: 7, maxParty: 50, durationMin: 150 },
      ],
      minAdvanceMin: 60,
      maxAdvanceDays: 60,
      maxOnlineParty: 8,
      cancelLimitHours: 2,
      autoConfirm: true,
    });
  });

  it('errores junto a cada campo: duración, tramos al revés o solapados y reglas', () => {
    expect(errors(bookingSettingsSchema, { ...base, defaultDuration: '100', maxOnlineParty: '0' })).toEqual({
      defaultDuration: 'De 30 minutos a 6 horas, en pasos de 15 minutos.',
      maxOnlineParty: 'Entre 1 y 50 personas.',
    });
    expect(errors(bookingSettingsSchema, { ...base, rule1_min: '4', rule1_max: '2', rule1_duration: '90' })).toEqual({
      rule1_max: 'El máximo no puede ser menor que el mínimo.',
    });
    expect(errors(bookingSettingsSchema, { ...base, rule1_min: '1', rule1_max: '4', rule1_duration: '90', rule2_min: '4', rule2_max: '6', rule2_duration: '120' })).toEqual({
      rule2_min: 'Se solapa con el tramo 1.',
    });
    expect(errors(bookingSettingsSchema, { ...base, rule1_min: '1', rule1_max: '', rule1_duration: '90' })).toEqual({ rule1_max: 'Entre 1 y 50 personas.' });
  });
});

describe('última reserva e intervalo de un servicio', () => {
  const cena = serviceBookingSchema({ startMinute: 1200, endMinute: 1470 });

  it('vacía = por defecto; después de medianoche, del día siguiente', () => {
    expect(cena.parse({ lastBooking: '', slotInterval: '15' })).toEqual({ lastBookingMinute: null, slotIntervalMin: 15 });
    expect(cena.parse({ lastBooking: '23:30', slotInterval: '30' })).toEqual({ lastBookingMinute: 1410, slotIntervalMin: 30 });
    expect(cena.parse({ lastBooking: '00:15', slotInterval: '15' })).toEqual({ lastBookingMinute: 1455, slotIntervalMin: 15 });
  });

  it('tiene que ser antes del cierre; el intervalo, 15 o 30', () => {
    expect(errors(cena, { lastBooking: '00:30', slotInterval: '15' })).toEqual({ lastBooking: 'La última reserva tiene que ser antes del cierre del servicio.' });
    expect(errors(cena, { lastBooking: '9', slotInterval: '15' })).toEqual({ lastBooking: 'Escribe la hora así: 21:30.' });
    expect(errors(cena, { lastBooking: '', slotInterval: '20' })).toEqual({ slotInterval: 'Elige cada 15 o cada 30 minutos.' });
  });
});

describe('reservas', () => {
  const phone = {
    date: '2030-06-14',
    time: '21:00',
    partySize: '4',
    duration: '',
    tableMode: 'auto',
    tableIds: [],
    name: ' Ana García ',
    phone: '612 34 56 78',
    email: ' Ana@Example.com ',
    notes: '',
    internalNotes: ' Cliente de la casa ',
  };

  it('por teléfono: normaliza el teléfono y el email, hora en minutos y duración automática', () => {
    expect(phoneReservationSchema.parse(phone)).toEqual({
      date: '2030-06-14',
      time: 1260,
      partySize: 4,
      duration: null,
      tableMode: 'auto',
      tableIds: [],
      name: 'Ana García',
      phone: '+34612345678',
      email: 'ana@example.com',
      notes: null,
      internalNotes: 'Cliente de la casa',
    });
  });

  it('por teléfono: errores en castellano', () => {
    expect(
      errors(phoneReservationSchema, { ...phone, date: '2030-02-30', time: '25:00', partySize: '0', duration: '20', name: '', phone: '12', email: 'x@' }),
    ).toEqual({
      date: 'Esa fecha no existe.',
      time: 'Escribe la hora así: 21:30.',
      partySize: 'Entre 1 y 50 personas.',
      duration: 'De 15 minutos a 12 horas, en pasos de 15 minutos.',
      name: 'Escribe el nombre de quien reserva.',
      phone: 'Ese teléfono no parece correcto. Si es de fuera, empieza por + y el prefijo.',
      email: 'Ese email no parece correcto.',
    });
  });

  it('mesas: a mano hace falta al menos una, ids válidos y como mucho 10', () => {
    expect(errors(phoneReservationSchema, { ...phone, tableMode: 'manual' })).toEqual({ tableIds: 'Elige al menos una mesa.' });
    expect(errors(phoneReservationSchema, { ...phone, tableMode: 'manual', tableIds: ['x'] })).toEqual({ tableIds: 'Elige las mesas de la lista.' });
    expect(phoneReservationSchema.parse({ ...phone, tableMode: 'manual', tableIds: [T1, T2] }).tableIds).toEqual([T1, T2]);
    expect(errors(phoneReservationSchema, { ...phone, tableMode: 'keep', tableIds: [T1] })).toEqual({ tableMode: 'Elige una mesa o guárdala sin mesa.' });
  });

  it('cambiar una reserva: sin datos del cliente, con «dejar las mesas»', () => {
    const edit = reservationEditSchema.parse({ ...phone, duration: '120', tableMode: 'keep', tableIds: [T1] });
    expect(edit).toMatchObject({ time: 1260, duration: 120, tableMode: 'keep', tableIds: [T1] });
    expect(edit).not.toHaveProperty('phone');
  });

  it('walk-in: personas, al menos una mesa y nombre opcional', () => {
    expect(walkInSchema.parse({ partySize: '3', tableIds: [T1], name: '' })).toEqual({ partySize: 3, tableIds: [T1], name: null });
    expect(errors(walkInSchema, { partySize: '3', tableIds: [], name: '' })).toEqual({ tableIds: 'Elige al menos una mesa.' });
  });
});

describe('bloqueos', () => {
  const block = { date: '2030-06-14', start: '13:00', end: '16:00', allDay: '', tableId: '', reason: '' };

  it('una franja de un día, de una mesa o de todo el restaurante', () => {
    expect(blockFormSchema.parse(block)).toEqual({ date: '2030-06-14', startMinute: 780, endMinute: 960, tableId: null, reason: null });
    expect(blockFormSchema.parse({ ...block, start: '22:00', end: '01:00', tableId: T1, reason: ' Avería ' })).toEqual({
      date: '2030-06-14',
      startMinute: 1320,
      endMinute: 1500,
      tableId: T1,
      reason: 'Avería',
    });
    expect(blockFormSchema.parse({ ...block, start: '', end: '', allDay: 'on' })).toMatchObject({ startMinute: 0, endMinute: 1440 });
  });

  it('errores', () => {
    expect(errors(blockFormSchema, { ...block, end: '13:00' })).toEqual({ end: 'Tiene que acabar después de empezar.' });
    expect(errors(blockFormSchema, { ...block, start: 'x' })).toEqual({ start: 'Escribe la hora así: 21:30.' });
    expect(errors(blockFormSchema, { ...block, tableId: 'x' })).toEqual({ tableId: 'Elige una mesa de la lista.' });
  });
});
