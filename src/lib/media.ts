export const MEDIA_BUCKET = 'restaurant-media';
export const MEDIA_KINDS = ['logo', 'cover', 'gallery'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Lo que llega al servidor: el navegador ya lo ha pasado a WebP (o JPEG si no sabe hacer WebP). */
export const UPLOAD_TYPES = ['image/webp', 'image/jpeg'] as const;
/** Igual que file_size_limit del bucket. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_GALLERY_PHOTOS = 12;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

export function extensionFor(mime: string): 'webp' | 'jpg' | null {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return null;
}

/** {restaurante}/logo-{id}.webp, {restaurante}/cover-{id}.webp o {restaurante}/gallery/{id}.webp. */
export function mediaPath(restaurantId: string, kind: MediaKind, ext: 'webp' | 'jpg', id: string): string {
  return kind === 'gallery' ? `${restaurantId}/gallery/${id}.${ext}` : `${restaurantId}/${kind}-${id}.${ext}`;
}

/** Misma regla que la RLS de Storage (public.can_manage_media) y los CHECK de la BD. */
export function isRestaurantMediaPath(restaurantId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(restaurantId)) return false;
  return new RegExp(`^${restaurantId}/(logo-[a-z0-9-]+|cover-[a-z0-9-]+|gallery/[a-z0-9-]+)\\.(webp|jpg)$`).test(path);
}

/** Foto de un plato: {restaurante}/dishes/{id}.webp. La gestionan Administrador y Encargado (can_manage_media). */
export function dishPhotoPath(restaurantId: string, ext: 'webp' | 'jpg', id: string): string {
  return `${restaurantId}/dishes/${id}.${ext}`;
}

/** Misma regla que can_manage_media y dishes_photo_path_check. */
export function isDishPhotoPath(restaurantId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(restaurantId)) return false;
  return new RegExp(`^${restaurantId}/dishes/[a-z0-9-]+\\.(webp|jpg)$`).test(path);
}

export function publicMediaUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Comprobación en el servidor del archivo ya comprimido. null si vale. */
export function checkUpload(file: { type: string; size: number }): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return 'Ese formato de imagen no vale. Usa JPG, PNG o WebP.';
  if (file.size === 0) return 'La imagen está vacía. Prueba con otra.';
  if (file.size > MAX_UPLOAD_BYTES) return 'La imagen pesa demasiado. Prueba con otra más pequeña.';
  return null;
}
