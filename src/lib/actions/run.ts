import 'server-only';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requirePermission, type PanelContext } from '@/lib/auth/guards';
import { mapDbError } from '@/lib/db-errors';
import type { FormState } from '@/lib/forms';
import type { Permission } from '@/lib/permissions';
import { PUBLIC_ALL_TAG, publicRestaurantTag } from '@/lib/public/tags';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Invalida la mini-web y refresca el panel. Solo desde server actions (updateTag lo exige).
 * allPublic: también el resto de mini-webs y el sitemap (cambios de slug o de estado).
 */
export function refreshRestaurant(_restaurantId: string, slug: string, allPublic = false): void {
  updateTag(publicRestaurantTag(slug));
  if (allPublic) updateTag(PUBLIC_ALL_TAG);
  revalidatePath('/panel/[restaurantId]', 'layout');
}

/**
 * Esqueleto de las acciones del panel: comprueba permiso (no en modo soporte ni con el restaurante desactivado),
 * ejecuta fn con la sesión del usuario (RLS) y, si va bien, refresca.
 */
export async function runPanelAction(
  restaurantId: string,
  permission: Permission,
  fn: (supabase: SupabaseServerClient, ctx: PanelContext) => Promise<FormState>,
  opts: { allPublic?: boolean } = {},
): Promise<FormState> {
  if (!uuidSchema.safeParse(restaurantId).success) return { error: mapDbError('FORBIDDEN') };
  try {
    const ctx = await requirePermission(restaurantId, permission);
    const supabase = await createClient();
    const result = await fn(supabase, ctx);
    if (!result.error && !result.fieldErrors) {
      refreshRestaurant(restaurantId, ctx.restaurant.slug, opts.allPublic);
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    const mapped = mapDbError(e instanceof Error ? e.message : undefined);
    if (mapped === mapDbError(undefined)) console.error('[panel-action]', e);
    return { error: mapped };
  }
}

/** Para acciones de formulario sin estado (botones Quitar, Subir/Bajar): si algo falla, lo recoge error.tsx. */
export function throwIfError(result: FormState): void {
  if (result.error) throw new Error(result.error);
}
