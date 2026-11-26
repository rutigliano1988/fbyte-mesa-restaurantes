import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOGO_MAX_BYTES, LOGO_PNG_MAX, fetchLogoPng, logoToPng } from './logo-png';

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

describe('descarga del logo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve null si el logo pesa más de 2 MB (con o sin content-length) y PNG si cabe', async () => {
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big, { headers: { 'content-length': String(big.byteLength) } })));
    expect(await fetchLogoPng('https://x.test/logo.webp')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big)));
    expect(await fetchLogoPng('https://x.test/logo.webp')).toBeNull();
    const ok = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#FF7A1A' } }).webp().toBuffer();
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(new Uint8Array(ok)));
    vi.stubGlobal('fetch', fetchMock);
    const png = await fetchLogoPng('https://x.test/logo.webp');
    expect(png && Buffer.from(png.subarray(0, 4)).toString('hex')).toBe('89504e47');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
