/** A4 en puntos PDF (1 pt = 1/72 de pulgada). Cada tarjeta A6 es un cuarto exacto. */
export const A4 = { width: 595.28, height: 841.89 } as const;
/** Margen de seguridad dentro de cada tarjeta (las impresoras no llegan al borde de la hoja). */
export const CARD_MARGIN = 22;
export const MARK_LENGTH = 24;
export const STRIPE_HEIGHT = 8;
export const LOGO_BOX = 64;
/** Caja del QR, con sus 4 módulos de margen blanco incluidos. */
export const QR_BOX = 190;
export const NAME_SIZE = { max: 20, min: 11 } as const;
export const CAPTION_SIZE = { max: 9, min: 6 } as const;
export const URL_SIZE = { max: 8, min: 5 } as const;

/** Coordenadas PDF: origen abajo a la izquierda. */
export type Rect = { x: number; y: number; width: number; height: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };
export type CardLayout = {
  /** Franja con el color de acento, arriba. */
  stripe: Rect;
  /** Caja del logo (el logo se encaja dentro sin deformarse). */
  logo: Rect | null;
  centerX: number;
  /** Ancho máximo de los textos. */
  textWidth: number;
  nameBaseline: number;
  qr: Rect;
  captionBaseline: number;
  urlBaseline: number;
};

/** Las 4 tarjetas: arriba a la izquierda, arriba a la derecha, abajo a la izquierda y abajo a la derecha. */
export function cardRects(page: { width: number; height: number } = A4): Rect[] {
  const width = page.width / 2;
  const height = page.height / 2;
  return [
    { x: 0, y: height, width, height },
    { x: width, y: height, width, height },
    { x: 0, y: 0, width, height },
    { x: width, y: 0, width, height },
  ];
}

/** Marcas de corte en las dos líneas centrales: en los cuatro bordes de la hoja y una cruz en el centro. */
export function cropMarks(page: { width: number; height: number } = A4, length = MARK_LENGTH): Segment[] {
  const cx = page.width / 2;
  const cy = page.height / 2;
  return [
    { x1: cx, y1: page.height, x2: cx, y2: page.height - length },
    { x1: cx, y1: 0, x2: cx, y2: length },
    { x1: 0, y1: cy, x2: length, y2: cy },
    { x1: page.width, y1: cy, x2: page.width - length, y2: cy },
    { x1: cx - length / 2, y1: cy, x2: cx + length / 2, y2: cy },
    { x1: cx, y1: cy - length / 2, x2: cx, y2: cy + length / 2 },
  ];
}

/** De arriba abajo: franja de acento, logo (si hay), nombre, QR, texto fijo y dirección web. */
export function cardLayout(card: Rect, hasLogo: boolean): CardLayout {
  const centerX = card.x + card.width / 2;
  const top = card.y + card.height - CARD_MARGIN;
  const stripe = { x: card.x + CARD_MARGIN, y: top - STRIPE_HEIGHT, width: card.width - 2 * CARD_MARGIN, height: STRIPE_HEIGHT };
  let cursor = stripe.y - 16;
  let logo: Rect | null = null;
  if (hasLogo) {
    logo = { x: centerX - LOGO_BOX / 2, y: cursor - LOGO_BOX, width: LOGO_BOX, height: LOGO_BOX };
    cursor = logo.y - 10;
  }
  const nameBaseline = cursor - NAME_SIZE.max;
  const qr = { x: centerX - QR_BOX / 2, y: nameBaseline - 8 - QR_BOX, width: QR_BOX, height: QR_BOX };
  const captionBaseline = qr.y - 8 - CAPTION_SIZE.max;
  const urlBaseline = captionBaseline - 6 - URL_SIZE.max;
  return { stripe, logo, centerX, textWidth: card.width - 2 * CARD_MARGIN, nameBaseline, qr, captionBaseline, urlBaseline };
}

/** Tamaño de letra que cabe (de maxSize a minSize, de medio en medio punto); si ni así cabe, recorta con «…». */
export function fitText(
  text: string,
  measure: (text: string, size: number) => number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
): { text: string; size: number } {
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    if (measure(text, size) <= maxWidth) return { text, size };
  }
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, minSize) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size: minSize };
}

/** Caracteres de WinAnsi (Windows-1252) fuera de Latin-1. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function isWinAnsi(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch);
}

/**
 * Las fuentes estándar del PDF (Helvetica) solo saben WinAnsi: «ź» pasa a «z» y lo que no tiene arreglo
 * (por ejemplo, «Ł» o los emojis) se quita.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (isWinAnsi(ch)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base && [...base].every(isWinAnsi)) out += base;
  }
  return out.replace(/\s+/g, ' ').trim();
}
