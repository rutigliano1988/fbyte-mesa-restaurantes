import { describe, expect, it } from 'vitest';
import { menuQrUrl, QR_PNG_SIZE, qrMatrix, qrPng, qrRuns } from './qr';

describe('QR de la carta', () => {
  it('apunta a la carta con la dirección absoluta y sin idioma', () => {
    expect(menuQrUrl('https://mesa.example.com/', 'la-taberna')).toBe('https://mesa.example.com/la-taberna/menu');
    expect(menuQrUrl('https://mesa.example.com', 'la-taberna')).toBe('https://mesa.example.com/la-taberna/menu');
  });

  it('la matriz es cuadrada y tiene los tres cuadros de posición', () => {
    const m = qrMatrix('https://mesa.example.com/la-taberna/menu');
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === n)).toBe(true);
    for (const [r, c] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      expect(m[r].slice(c, c + 7).every(Boolean)).toBe(true);
      expect(m[r + 6].slice(c, c + 7).every(Boolean)).toBe(true);
      expect(m[r + 1][c + 1]).toBe(false);
      expect(m[r + 3][c + 3]).toBe(true);
    }
  });

  it('qrRuns junta los módulos oscuros seguidos de cada fila', () => {
    expect(
      qrRuns([
        [true, true, false, true],
        [false, false, false, false],
        [false, true, true, true],
      ]),
    ).toEqual([
      { row: 0, col: 0, length: 2 },
      { row: 0, col: 3, length: 1 },
      { row: 2, col: 1, length: 3 },
    ]);
    const m = qrMatrix('https://mesa.example.com/x/menu');
    expect(qrRuns(m).reduce((sum, run) => sum + run.length, 0)).toBe(m.flat().filter(Boolean).length);
  });

  it('el PNG mide 1024 × 1024', async () => {
    const png = await qrPng('https://mesa.example.com/la-taberna/menu');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([QR_PNG_SIZE, QR_PNG_SIZE]);
  });
});
