import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapDbError } from '@/lib/db-errors';
import type { BookingConfig } from '@/lib/reservations/data';
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/reservations/settings';

const R = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';

const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(
  async () => ({ data: { id: ID, table_ids: [T1] }, error: null }),
);
const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url), unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/guards', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('./run', () => ({
  runPanelAction: vi.fn(async (_r: string, _p: string, fn: (supabase: unknown) => unknown) => fn({ rpc })),
}));
const config: BookingConfig = {
  timezone: 'Europe/Madrid',
  zones: [],
  tables: [],
  settings: { ...DEFAULT_BOOKING_SETTINGS, durationRules: [{ minParty: 1, maxParty: 2, durationMin: 60 }] },
  services: [{ name: 'Cena', weekday: 5, startMinute: 1230, endMinute: 1470, lastBookingMinute: null, slotIntervalMin: 15 }],
  exceptions: [],
};
vi.mock('@/lib/reservations/data', () => ({ loadBookingConfig: vi.fn(async () => config) }));

const { requirePermission } = await import('@/lib/auth/guards');
const { createClient } = await import('@/lib/supabase/server');
const { runPanelAction } = await import('./run');
const { changeReservationStatus, createPhoneReservation, createWalkIn, lookupCustomer, undoReservationStatus, updateReservation } = await import('./reservations');

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}

const phoneForm = {
  restaurantId: R,
  date: '2030-06-14',
  time: '21:00',
  partySize: '2',
  duration: '',
  tableMode: 'auto',
  name: 'Ana',
  phone: '612345678',
  email: '',
  notes: '',
  internalNotes: '',
};

beforeEach(() => {
  rpc.mockClear();
  redirect.mockClear();
  vi.mocked(runPanelAction).mockClear();
  vi.mocked(requirePermission).mockClear();
});

it('todas las acciones pasan por runPanelAction con reservations.manage y sin invalidar la web pública', async () => {
  const run = vi.mocked(runPanelAction);
  await createPhoneReservation({}, form(phoneForm));
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1] }));
  await createWalkIn({}, form({ restaurantId: R, partySize: '2', tableIds: [T1] }));
  await changeReservationStatus(R, ID, 'seated');
  await undoReservationStatus(R, ID);
  expect(run).toHaveBeenCalledTimes(5);
  for (const call of run.mock.calls) {
    expect(call[1]).toBe('reservations.manage');
    expect(call[3]).toEqual({ publicData: false });
  }
});

describe('createPhoneReservation', () => {
  it('mesa propuesta: sin mesas ni forzar; teléfono en E.164; vuelve al día', async () => {
    await createPhoneReservation({}, form(phoneForm));
    expect(rpc).toHaveBeenCalledWith('create_panel_reservation', {
      p_restaurant_id: R,
      p_starts_at: '2030-06-14T19:00:00.000Z',
      p_duration_min: null,
      p_party_size: 2,
      p_table_ids: null,
      p_force: false,
      p_customer_name: 'Ana',
      p_customer_phone: '+34612345678',
      p_customer_email: null,
      p_notes: null,
      p_internal_notes: null,
    });
    expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas?fecha=2030-06-14&aviso=creada`);
  });

  it('mesas elegidas, forzar sin mesa y la madrugada de la cena', async () => {
    await createPhoneReservation({}, form({ ...phoneForm, tableMode: 'manual', tableIds: [T1, T1] }));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_table_ids: [T1], p_force: false });
    await createPhoneReservation({}, form({ ...phoneForm, tableMode: 'none', time: '00:15' }));
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_table_ids: null, p_force: true, p_starts_at: '2030-06-14T22:15:00.000Z' });
  });

  it('si la BD dice que la mesa se ha ocupado, no redirige y lo explica', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'SLOT_TAKEN' } });
    expect(await createPhoneReservation({}, form(phoneForm))).toEqual({ error: mapDbError('SLOT_TAKEN') });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('errores de campo sin llegar a la BD', async () => {
    const result = await createPhoneReservation({}, form({ ...phoneForm, phone: '12' }));
    expect(result.fieldErrors?.phone).toMatch(/teléfono/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

it('updateReservation: duración vacía = la del tramo; «dejar las mesas» manda las actuales', async () => {
  await updateReservation({}, form({ ...phoneForm, reservationId: ID, tableMode: 'keep', tableIds: [T1] }));
  expect(rpc).toHaveBeenCalledWith('update_panel_reservation', expect.objectContaining({ p_reservation_id: ID, p_duration_min: 60, p_table_ids: [T1], p_force: false }));
  expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas/${ID}?aviso=guardada`);
});

describe('estados', () => {
  it('un estado que no existe (tampoco los heredados) no llega a la BD', async () => {
    for (const status of ['toString', 'seated2', '']) {
      expect(await changeReservationStatus(R, ID, status)).toEqual({ error: mapDbError('INVALID_INPUT') });
    }
    expect(await changeReservationStatus(R, 'no-es-uuid', 'seated')).toEqual({ error: mapDbError('INVALID_INPUT') });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cambia y deshace con el restaurante y la reserva', async () => {
    expect(await changeReservationStatus(R, ID, 'seated')).toEqual({ success: 'Hecho: En mesa.' });
    expect(rpc).toHaveBeenCalledWith('set_reservation_status', { p_restaurant_id: R, p_reservation_id: ID, p_status: 'seated' });
    rpc.mockResolvedValueOnce({ data: 'confirmed', error: null });
    expect(await undoReservationStatus(R, ID)).toEqual({ success: 'Deshecho: vuelve a «Confirmada».' });
  });
});

describe('errores inesperados', () => {
  it('una respuesta sin id válido tras crear se registra y enseña el mensaje genérico', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: { id: 'no-es-uuid' }, error: null });
    expect(await createPhoneReservation({}, form(phoneForm))).toEqual({ error: mapDbError(undefined) });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await createWalkIn({}, form({ restaurantId: R, partySize: '2', tableIds: [T1] }))).toEqual({ error: mapDbError(undefined) });
    expect(log).toHaveBeenCalledTimes(2);
    expect(redirect).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('un error de BD desconocido se registra; uno conocido no', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist' } });
    expect(await changeReservationStatus(R, ID, 'seated')).toEqual({ error: mapDbError(undefined) });
    expect(log).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'INVALID_TRANSITION' } });
    await changeReservationStatus(R, ID, 'seated');
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

it('updateReservation: un id que no es uuid devuelve INVALID_INPUT sin llegar a la BD', async () => {
  expect(await updateReservation({}, form({ ...phoneForm, reservationId: 'no-es-uuid' }))).toEqual({ error: mapDbError('INVALID_INPUT') });
  expect(rpc).not.toHaveBeenCalled();
});

it('createWalkIn: llama a create_walk_in con las mesas sin repetir y vuelve a la vista del día', async () => {
  const result = await createWalkIn({}, form({ restaurantId: R, partySize: '3', tableIds: [T1, T1], name: 'Luis' }));
  expect(result).toEqual({ success: 'Sentados.' });
  expect(rpc).toHaveBeenCalledWith('create_walk_in', {
    p_restaurant_id: R,
    p_party_size: 3,
    p_table_ids: [T1],
    p_duration_min: null,
    p_customer_name: 'Luis',
  });
  expect(redirect).toHaveBeenCalledWith(`/panel/${R}/reservas?aviso=walk-in`);
});

describe('lookupCustomer', () => {
  const maybeSingle = vi.fn();
  const eq = vi.fn();
  const chain = { select: vi.fn(), eq, maybeSingle };
  chain.select.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  const from = vi.fn(() => chain);

  beforeEach(() => {
    from.mockClear();
    eq.mockClear();
    maybeSingle.mockReset();
    vi.mocked(createClient).mockResolvedValue({ from } as never);
  });

  it('filtra por restaurante y teléfono E.164, y devuelve el cliente con sus avisos', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: ID, name: 'Ana', phone: '+34612345678', email: null, tags: ['vip', 'otra'], visits_count: 3, no_show_count: 0, cancel_count: 0 },
      error: null,
    });
    const result = await lookupCustomer(R, '612 34 56 78');
    expect(requirePermission).toHaveBeenCalledWith(R, 'reservations.manage');
    expect(from).toHaveBeenCalledWith('customers');
    expect(eq).toHaveBeenCalledWith('restaurant_id', R);
    expect(eq).toHaveBeenCalledWith('phone', '+34612345678');
    expect(result.customer?.name).toBe('Ana');
    expect(result.error).toBeUndefined();
  });

  it('un teléfono que no se puede normalizar devuelve null sin consultar', async () => {
    expect(await lookupCustomer(R, '12')).toEqual({ customer: null });
    expect(from).not.toHaveBeenCalled();
    expect(requirePermission).not.toHaveBeenCalled();
  });

  it('un error de BD se registra y no expone message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'secreto interno de postgres' } });
    const result = await lookupCustomer(R, '612345678');
    expect(result).toEqual({ customer: null, error: mapDbError(undefined) });
    expect(JSON.stringify(result)).not.toContain('secreto');
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
