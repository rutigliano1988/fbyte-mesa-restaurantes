import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { qrPng } from './qr';
import { A4 } from './qr-layout';
import { buildQrCardsPdf } from './qr-pdf';

describe('PDF de tarjetas QR', () => {
  it('una sola hoja A4, con logo', async () => {
    const logoPng = new Uint8Array(await qrPng('logo de prueba'));
    const bytes = await buildQrCardsPdf({
      name: 'La Taberna de Pepe',
      url: 'https://mesa.example.com/la-taberna/menu',
      accentColor: '#17317F',
      logoPng,
    });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: A4.width, height: A4.height });
    expect(doc.getTitle()).toBe('Código QR de la carta · La Taberna de Pepe');
  });

  it('sin logo y con un nombre que no cabe o que las fuentes del PDF no saben escribir', async () => {
    const bytes = await buildQrCardsPdf({
      name: 'Łódź 🍕 Bar con un nombre larguísimo que no cabe de ninguna manera en una tarjeta A6',
      url: 'https://mesa.example.com/lodz/menu',
      accentColor: '#FFC48A',
      logoPng: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
