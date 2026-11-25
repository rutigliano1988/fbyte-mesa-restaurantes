import { MAX_UPLOAD_BYTES, type MediaKind } from '@/lib/media';

/** Lado mayor máximo tras reducir, en píxeles. */
export const MAX_SIDE: Record<MediaKind, number> = { logo: 512, cover: 1920, gallery: 1600 };
export const ACCEPTED_SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const QUALITY_STEPS = [0.82, 0.72, 0.62] as const;

/** Tamaño final manteniendo la proporción; nunca agranda. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error('Tamaño de imagen no válido');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Antes de comprimir: tipo y tamaño de la foto original. null si vale. */
export function checkSourceFile(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_SOURCE_TYPES as readonly string[]).includes(file.type)) return 'Ese formato no vale. Sube una foto JPG, PNG o WebP.';
  if (file.size > MAX_SOURCE_BYTES) return 'La foto pesa más de 20 MB. Prueba con otra.';
  return null;
}

/**
 * Solo navegador: reduce la foto y la pasa a WebP (calidad 0,82; baja si aún pesa más de 2 MB).
 * Si el navegador no sabe crear WebP, usa JPEG con fondo blanco.
 */
export async function compressImage(file: File, kind: MediaKind): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE[kind]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    let encoded = false;
    for (const type of ['image/webp', 'image/jpeg'] as const) {
      ctx.clearRect(0, 0, width, height);
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
        if (!blob || blob.type !== type) break;
        encoded = true;
        if (blob.size <= MAX_UPLOAD_BYTES) return blob;
      }
    }
    throw new Error(encoded ? 'IMAGE_TOO_BIG' : 'IMAGE_ENCODE_FAILED');
  } finally {
    bitmap.close();
  }
}
