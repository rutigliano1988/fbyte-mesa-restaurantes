import { describe, expect, it } from 'vitest';
import { checkUpload, extensionFor, isMediaKind, isRestaurantMediaPath, mediaPath, publicMediaUrl } from './media';

const rid = '11111111-1111-4111-8111-111111111111';
const fid = '22222222-2222-4222-8222-222222222222';

describe('rutas de Storage', () => {
  it('mediaPath sigue el formato del bucket', () => {
    expect(mediaPath(rid, 'logo', 'webp', fid)).toBe(`${rid}/logo-${fid}.webp`);
    expect(mediaPath(rid, 'cover', 'jpg', fid)).toBe(`${rid}/cover-${fid}.jpg`);
    expect(mediaPath(rid, 'gallery', 'webp', fid)).toBe(`${rid}/gallery/${fid}.webp`);
  });

  it('isRestaurantMediaPath acepta solo rutas de ese restaurante', () => {
    expect(isRestaurantMediaPath(rid, mediaPath(rid, 'gallery', 'webp', fid))).toBe(true);
    expect(isRestaurantMediaPath(rid, `${fid}/logo-x.webp`)).toBe(false);
    expect(isRestaurantMediaPath(rid, `${rid}/logo-x.png`)).toBe(false);
    expect(isRestaurantMediaPath(rid, `${rid}/otra/x.webp`)).toBe(false);
    expect(isRestaurantMediaPath('no-uuid', 'no-uuid/logo-x.webp')).toBe(false);
  });

  it('publicMediaUrl apunta al bucket público', () => {
    expect(publicMediaUrl('https://abc.supabase.co/', `${rid}/logo-x.webp`)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/restaurant-media/${rid}/logo-x.webp`,
    );
  });
});

describe('subidas', () => {
  it('extensionFor e isMediaKind', () => {
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBeNull();
    expect(isMediaKind('cover')).toBe(true);
    expect(isMediaKind('avatar')).toBe(false);
  });

  it('checkUpload rechaza formatos, vacíos y archivos de más de 2 MB', () => {
    expect(checkUpload({ type: 'image/webp', size: 300_000 })).toBeNull();
    expect(checkUpload({ type: 'image/png', size: 300_000 })).toBe('Ese formato de imagen no vale. Usa JPG, PNG o WebP.');
    expect(checkUpload({ type: 'image/jpeg', size: 0 })).toBe('La imagen está vacía. Prueba con otra.');
    expect(checkUpload({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toBe('La imagen pesa demasiado. Prueba con otra más pequeña.');
  });
});
