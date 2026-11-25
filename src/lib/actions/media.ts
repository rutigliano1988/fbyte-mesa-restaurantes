'use server';

import { mapDbError } from '@/lib/db-errors';
import type { FormState } from '@/lib/forms';
import { checkUpload, extensionFor, isMediaKind, MEDIA_BUCKET, mediaPath } from '@/lib/media';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError } from './run';

type ImageColumns = { logo_path: string | null; cover_path: string | null };

/** Sube una imagen ya comprimida en el navegador. Logo y portada sustituyen a la anterior; la galería añade al final. */
export async function uploadRestaurantImage(fd: FormData): Promise<FormState> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const kind = fd.get('kind');
  const file = fd.get('file');
  if (!isMediaKind(kind) || !(file instanceof File)) return { error: mapDbError(undefined) };
  const problem = checkUpload(file);
  if (problem) return { error: problem };
  const ext = extensionFor(file.type) ?? 'webp';

  return runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const path = mediaPath(restaurantId, kind, ext, crypto.randomUUID());
    const { error: uploadError } = await bucket.upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) return { error: mapDbError(uploadError.message) };

    if (kind === 'gallery') {
      const { data: last } = await supabase
        .from('restaurant_photos')
        .select('position')
        .eq('restaurant_id', restaurantId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      const position = ((last as { position: number } | null)?.position ?? -1) + 1;
      const { error } = await supabase.from('restaurant_photos').insert({ restaurant_id: restaurantId, path, position });
      if (error) {
        await bucket.remove([path]);
        return { error: mapDbError(error.message) };
      }
      return { success: 'Foto añadida.' };
    }

    const column = kind === 'logo' ? 'logo_path' : 'cover_path';
    const { data: current } = await supabase.from('restaurants').select('logo_path, cover_path').eq('id', restaurantId).single();
    const { data, error } = await supabase.from('restaurants').update({ [column]: path }).eq('id', restaurantId).select('id');
    if (error || !data?.length) {
      await bucket.remove([path]);
      return { error: mapDbError(error?.message ?? 'FORBIDDEN') };
    }
    const previous = (current as ImageColumns | null)?.[column];
    if (previous) await bucket.remove([previous]);
    return { success: kind === 'logo' ? 'Logo actualizado.' : 'Portada actualizada.' };
  });
}

export async function removeRestaurantImage(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const kind = fd.get('kind');
  if (kind !== 'logo' && kind !== 'cover') return;
  const column = kind === 'logo' ? 'logo_path' : 'cover_path';
  const result = await runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const { data: current } = await supabase.from('restaurants').select('logo_path, cover_path').eq('id', restaurantId).single();
    const { data, error } = await supabase.from('restaurants').update({ [column]: null }).eq('id', restaurantId).select('id');
    if (error || !data?.length) return { error: mapDbError(error?.message ?? 'FORBIDDEN') };
    const previous = (current as ImageColumns | null)?.[column];
    if (previous) await supabase.storage.from(MEDIA_BUCKET).remove([previous]);
    return { success: 'Imagen quitada.' };
  });
  throwIfError(result);
}

export async function deletePhoto(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const photoId = String(fd.get('photoId') ?? '');
  if (!uuidSchema.safeParse(photoId).success) return;
  const result = await runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const { data, error } = await supabase
      .from('restaurant_photos')
      .delete()
      .eq('id', photoId)
      .eq('restaurant_id', restaurantId)
      .select('path');
    if (error) return { error: mapDbError(error.message) };
    const path = (data as { path: string }[] | null)?.[0]?.path;
    if (!path) return { error: mapDbError('FORBIDDEN') };
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    return { success: 'Foto borrada.' };
  });
  throwIfError(result);
}

/** Sube o baja una foto un puesto y deja las posiciones seguidas (0, 1, 2…). */
export async function movePhoto(fd: FormData): Promise<void> {
  const restaurantId = String(fd.get('restaurantId') ?? '');
  const photoId = String(fd.get('photoId') ?? '');
  const direction = fd.get('direction') === 'up' ? -1 : 1;
  if (!uuidSchema.safeParse(photoId).success) return;
  const result = await runPanelAction(restaurantId, 'restaurant.edit', async (supabase) => {
    const { data, error } = await supabase
      .from('restaurant_photos')
      .select('id, position')
      .eq('restaurant_id', restaurantId)
      .order('position')
      .order('created_at');
    if (error) return { error: mapDbError(error.message) };
    const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
    const from = ids.indexOf(photoId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return { success: 'Sin cambios.' };
    [ids[from], ids[to]] = [ids[to], ids[from]];
    for (const [position, id] of ids.entries()) {
      const { error: updateError } = await supabase.from('restaurant_photos').update({ position }).eq('id', id);
      if (updateError) return { error: mapDbError(updateError.message) };
    }
    return { success: 'Orden guardado.' };
  });
  throwIfError(result);
}
