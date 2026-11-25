import { describe, expect, it } from 'vitest';
import { checkSourceFile, fitWithin, MAX_SIDE } from './compress';

describe('fitWithin', () => {
  it('reduce manteniendo la proporción', () => {
    expect(fitWithin(4000, 3000, MAX_SIDE.cover)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000, MAX_SIDE.gallery)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(1024, 1024, MAX_SIDE.logo)).toEqual({ width: 512, height: 512 });
  });

  it('nunca agranda ni deja lados de 0 px', () => {
    expect(fitWithin(300, 200, MAX_SIDE.cover)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(10000, 1, MAX_SIDE.logo)).toEqual({ width: 512, height: 1 });
  });

  it('falla con tamaños imposibles', () => {
    expect(() => fitWithin(0, 100, 512)).toThrow();
  });
});

describe('checkSourceFile', () => {
  it('acepta JPEG, PNG y WebP de hasta 20 MB', () => {
    expect(checkSourceFile({ type: 'image/png', size: 5_000_000 })).toBeNull();
    expect(checkSourceFile({ type: 'image/gif', size: 1000 })).toBe('Ese formato no vale. Sube una foto JPG, PNG o WebP.');
    expect(checkSourceFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 })).toBe('La foto pesa más de 20 MB. Prueba con otra.');
  });
});
