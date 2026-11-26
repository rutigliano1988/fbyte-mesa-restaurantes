'use server';

import { redirect } from 'next/navigation';
import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import { checkUpload, dishPhotoPath, extensionFor, MEDIA_BUCKET } from '@/lib/media';
import { confirmSchema, dishFormSchema, readDishForm } from '@/lib/menu/validation';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError, type SupabaseServerClient } from './run';

const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidSchema.safeParse(value).success;

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

function dishPage(restaurantId: string, dishId: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return `/panel/${restaurantId}/menu/platos/${dishId}${qs ? `?${qs}` : ''}`;
}

async function currentPhoto(supabase: SupabaseServerClient, restaurantId: string, dishId: string): Promise<string | null> {
  const { data } = await supabase.from('dishes').select('photo_path').eq('id', dishId).eq('restaurant_id', restaurantId).maybeSingle();
  return (data as { photo_path: string | null } | null)?.photo_path ?? null;
}

/** Crea (sin dishId) o guarda un plato con todos sus precios de una vez (save_dish). */
export async function saveDish(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = dishFormSchema.safeParse(readDishForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  const dishId = field(fd, 'dishId');
  if (dishId && !isUuid(dishId)) return { error: mapDbError(undefined) };
  const sectionId = field(fd, 'sectionId');
  const menuId = field(fd, 'menuId');
  const d = parsed.data;
  const created = { id: '', warning: '' };
  const result = await runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const { data, error } = await supabase.rpc('save_dish', {
      p_restaurant_id: restaurantId,
      p_dish_id: dishId || null,
      p_names: d.names,
      p_descriptions: d.descriptions,
      p_allergens: d.allergens,
      p_tags: d.tags,
      p_prices: d.prices.map((p) => ({ kind: p.kind, price_cents: p.priceCents, labels: p.labels })),
    });
    if (error) return { error: mapDbError(error.message) };
    if (dishId) return { success: 'Plato guardado.' };
    created.id = data as string;
    if (isUuid(sectionId)) {
      const { data: last } = await supabase
        .from('menu_items')
        .select('position')
        .eq('section_id', sectionId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      const position = ((last as { position: number } | null)?.position ?? -1) + 1;
      const { error: itemError } = await supabase
        .from('menu_items')
        .insert({ restaurant_id: restaurantId, section_id: sectionId, dish_id: created.id, position });
      if (itemError) created.warning = 'no-seccion';
    }
    return { success: 'Plato creado.' };
  });
  if (created.id) {
    redirect(dishPage(restaurantId, created.id, { ...(isUuid(menuId) && { carta: menuId }), ...(created.warning && { aviso: created.warning }) }));
  }
  return result;
}

/** Duplica un plato. Desde una sección, la copia se queda al final de esa sección; si no, se abre la copia. */
export async function duplicateDish(fd: FormData): Promise<void> {
  const restaurantId = field(fd, 'restaurantId');
  const dishId = field(fd, 'dishId');
  if (!isUuid(dishId)) return;
  const sectionId = field(fd, 'sectionId');
  const menuId = field(fd, 'menuId');
  const created = { id: '' };
  const result = await runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const { data, error } = await supabase.rpc('duplicate_dish', { p_dish_id: dishId, p_section_id: isUuid(sectionId) ? sectionId : null });
    if (error) return { error: mapDbError(error.message) };
    created.id = data as string;
    return { success: 'Plato duplicado.' };
  });
  throwIfError(result);
  if (!isUuid(sectionId)) redirect(dishPage(restaurantId, created.id, isUuid(menuId) ? { carta: menuId } : {}));
}

/** Borra el plato de todas las cartas y su foto. */
export async function deleteDish(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const restaurantId = field(fd, 'restaurantId');
  const dishId = field(fd, 'dishId');
  if (!isUuid(dishId)) return { error: mapDbError(undefined) };
  const menuId = field(fd, 'menuId');
  const result = await runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const { data, error } = await supabase.from('dishes').delete().eq('id', dishId).eq('restaurant_id', restaurantId).select('photo_path');
    if (error) return { error: mapDbError(error.message) };
    const row = (data as { photo_path: string | null }[] | null)?.[0];
    if (!row) return { error: mapDbError('FORBIDDEN') };
    if (row.photo_path) {
      const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove([row.photo_path]);
      if (removeError) console.error('[menu] no se pudo borrar la foto del plato', removeError.message);
    }
    return { success: 'Plato borrado.' };
  });
  if (!result.error) redirect(isUuid(menuId) ? `/panel/${restaurantId}/menu/${menuId}` : `/panel/${restaurantId}/menu/platos`);
  return result;
}

/** Sube la foto ya reducida en el navegador y sustituye la anterior. */
export async function uploadDishPhoto(fd: FormData): Promise<FormState> {
  const restaurantId = field(fd, 'restaurantId');
  const dishId = field(fd, 'dishId');
  const file = fd.get('file');
  if (!isUuid(dishId) || !(file instanceof File)) return { error: mapDbError(undefined) };
  const problem = checkUpload(file);
  if (problem) return { error: problem };
  const ext = extensionFor(file.type) ?? 'webp';
  return runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const path = dishPhotoPath(restaurantId, ext, crypto.randomUUID());
    const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (uploadError) return { error: mapDbError(uploadError.message) };
    const previous = await currentPhoto(supabase, restaurantId, dishId);
    const { data, error } = await supabase.from('dishes').update({ photo_path: path }).eq('id', dishId).eq('restaurant_id', restaurantId).select('id');
    if (error || !data?.length) {
      await bucket.remove([path]);
      return { error: mapDbError(error?.message ?? 'FORBIDDEN') };
    }
    if (previous) await bucket.remove([previous]);
    return { success: 'Foto actualizada.' };
  });
}

export async function removeDishPhoto(fd: FormData): Promise<void> {
  const restaurantId = field(fd, 'restaurantId');
  const dishId = field(fd, 'dishId');
  if (!isUuid(dishId)) return;
  const result = await runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const previous = await currentPhoto(supabase, restaurantId, dishId);
    const { data, error } = await supabase.from('dishes').update({ photo_path: null }).eq('id', dishId).eq('restaurant_id', restaurantId).select('id');
    if (error || !data?.length) return { error: mapDbError(error?.message ?? 'FORBIDDEN') };
    if (previous) await supabase.storage.from(MEDIA_BUCKET).remove([previous]);
    return { success: 'Foto quitada.' };
  });
  throwIfError(result);
}

/** Interruptor de agotado (también Sala): solo por la función set_dish_unavailable. */
export async function setDishUnavailable(restaurantId: string, dishId: string, unavailable: boolean): Promise<FormState> {
  if (!isUuid(dishId) || typeof unavailable !== 'boolean') return { error: mapDbError('INVALID_INPUT') };
  return runPanelAction(restaurantId, 'menu.toggle_unavailable', async (supabase) => {
    const { error } = await supabase.rpc('set_dish_unavailable', { p_dish_id: dishId, p_unavailable: unavailable });
    if (error) return { error: mapDbError(error.message) };
    return { success: unavailable ? 'Marcado como agotado.' : 'Vuelve a estar disponible.' };
  });
}
