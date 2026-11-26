import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LOGO_PNG_MAX, logoToPng } from './logo-png';

describe('logo para el PDF', () => {
  it('pasa WebP y JPEG a PNG, sin agrandar los pequeños y reduciendo los grandes', async () => {
    const small = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#FF7A1A' } }).webp().toBuffer();
    const png = await logoToPng(new Uint8Array(small));
    expect(Buffer.from(png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 40, height: 20 });
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#17317F' } }).jpeg().toBuffer();
    expect(await sharp(await logoToPng(new Uint8Array(big))).metadata()).toMatchObject({ width: LOGO_PNG_MAX, height: 256 });
  });
});
