import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { BRAND } from '@/config/brand';
import { QR_CARD_TEXT } from '@/lib/i18n/messages';
import { QR_QUIET_ZONE, qrMatrix, qrRuns } from './qr';
import { A4, CAPTION_SIZE, cardLayout, cardRects, cropMarks, fitText, NAME_SIZE, toWinAnsi, URL_SIZE } from './qr-layout';

export type QrCardsInput = { name: string; url: string; accentColor: string; logoPng: Uint8Array | null };

const INK = rgb(10 / 255, 19 / 255, 48 / 255);
const MARK = rgb(0.45, 0.45, 0.45);

function hexColor(hex: string): RGB {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, centerX: number, baseline: number) {
  page.drawText(text, { x: centerX - font.widthOfTextAtSize(text, size) / 2, y: baseline, size, font, color: INK });
}

/** Hoja A4 con 4 tarjetas A6 iguales (franja de acento, logo, nombre, QR, texto fijo y dirección) y marcas de corte. */
export async function buildQrCardsPdf(input: QrCardsInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Código QR de la carta · ${input.name}`);
  doc.setCreator(`${BRAND.productName} · ${BRAND.company}`);
  doc.setProducer(BRAND.productName);
  const page = doc.addPage([A4.width, A4.height]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const logo = input.logoPng ? await doc.embedPng(input.logoPng) : null;
  const matrix = qrMatrix(input.url);
  const runs = qrRuns(matrix);
  const accent = hexColor(input.accentColor);
  const name = toWinAnsi(input.name) || 'Carta';
  const caption = toWinAnsi(QR_CARD_TEXT);
  const address = toWinAnsi(input.url.replace(/^https?:\/\//, ''));

  for (const card of cardRects()) {
    const l = cardLayout(card, logo !== null);
    page.drawRectangle({ ...l.stripe, color: accent });
    if (logo && l.logo) {
      const scale = Math.min(l.logo.width / logo.width, l.logo.height / logo.height);
      const width = logo.width * scale;
      const height = logo.height * scale;
      page.drawImage(logo, { x: l.logo.x + (l.logo.width - width) / 2, y: l.logo.y + (l.logo.height - height) / 2, width, height });
    }
    const fittedName = fitText(name, (t, s) => bold.widthOfTextAtSize(t, s), l.textWidth, NAME_SIZE.max, NAME_SIZE.min);
    drawCentered(page, fittedName.text, bold, fittedName.size, l.centerX, l.nameBaseline);
    // El QR en vectores (nítido a cualquier tamaño), con 4 módulos de margen blanco alrededor.
    const cell = l.qr.width / (matrix.length + 2 * QR_QUIET_ZONE);
    for (const run of runs) {
      page.drawRectangle({
        x: l.qr.x + (QR_QUIET_ZONE + run.col) * cell,
        y: l.qr.y + l.qr.height - (QR_QUIET_ZONE + run.row + 1) * cell,
        width: run.length * cell,
        height: cell,
        color: INK,
      });
    }
    const fittedCaption = fitText(caption, (t, s) => regular.widthOfTextAtSize(t, s), l.textWidth, CAPTION_SIZE.max, CAPTION_SIZE.min);
    drawCentered(page, fittedCaption.text, regular, fittedCaption.size, l.centerX, l.captionBaseline);
    const fittedUrl = fitText(address, (t, s) => bold.widthOfTextAtSize(t, s), l.textWidth, URL_SIZE.max, URL_SIZE.min);
    drawCentered(page, fittedUrl.text, bold, fittedUrl.size, l.centerX, l.urlBaseline);
  }
  for (const s of cropMarks()) {
    page.drawLine({ start: { x: s.x1, y: s.y1 }, end: { x: s.x2, y: s.y2 }, thickness: 0.5, color: MARK });
  }
  return doc.save();
}
