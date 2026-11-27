import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapDbError } from '@/lib/db-errors';

const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ error: null }>>(async () => ({ error: null }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('./run', () => ({
  runPanelAction: vi.fn(async (_restaurantId: string, _permission: string, fn: (supabase: unknown) => unknown) => fn({ rpc })),
  throwIfError: vi.fn(),
}));

const { reorderMenuEntries } = await import('./menu');

const R = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const IDS = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];

beforeEach(() => rpc.mockClear());

describe('reorderMenuEntries', () => {
  it('las cartas se ordenan siempre dentro del restaurante, aunque llegue otro padre', async () => {
    for (const parentId of [OTHER, 'no-es-un-uuid']) {
      rpc.mockClear();
      expect(await reorderMenuEntries(R, 'menus', parentId, IDS)).toEqual({ success: 'Orden guardado.' });
      expect(rpc).toHaveBeenCalledWith('reorder_menus', { p_restaurant_id: R, p_ids: IDS });
    }
  });

  it('secciones y elementos usan el padre recibido', async () => {
    await reorderMenuEntries(R, 'sections', OTHER, IDS);
    expect(rpc).toHaveBeenCalledWith('reorder_sections', { p_menu_id: OTHER, p_ids: IDS });
  });

  it('un tipo que no es de la lista (tampoco los heredados, como toString) no llega a la BD', async () => {
    for (const entity of ['toString', 'constructor', 'dishes']) {
      expect(await reorderMenuEntries(R, entity as 'menus', OTHER, IDS)).toEqual({ error: mapDbError('INVALID_INPUT') });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
