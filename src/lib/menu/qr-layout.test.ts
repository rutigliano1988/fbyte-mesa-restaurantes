import { describe, expect, it } from 'vitest';
import { A4, CARD_MARGIN, cardLayout, cardRects, cropMarks, fitText, toWinAnsi, type Rect } from './qr-layout';

const mm = (pt: number) => (pt / 72) * 25.4;

describe('hoja A4 con 4 tarjetas A6', () => {
  it('cuatro tarjetas iguales de 105 × 148 mm que cubren el A4 sin solaparse', () => {
    const cards = cardRects();
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      expect(c.width).toBeCloseTo(297.64, 2);
      expect(c.height).toBeCloseTo(420.945, 2);
    }
    expect(mm(cards[0].width)).toBeCloseTo(105, 0);
    expect(mm(cards[0].height)).toBeGreaterThan(148);
    expect(mm(cards[0].height)).toBeLessThan(148.6);
    expect(cards.reduce((sum, c) => sum + c.width * c.height, 0)).toBeCloseTo(A4.width * A4.height, 4);
    const overlap = (a: Rect, b: Rect) =>
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) expect(overlap(cards[i], cards[j])).toBeCloseTo(0, 6);
  });

  it('marcas de corte en las dos líneas centrales, dentro de la hoja', () => {
    const marks = cropMarks();
    expect(marks).toHaveLength(6);
    for (const s of marks) {
      for (const [x, y] of [
        [s.x1, s.y1],
        [s.x2, s.y2],
      ]) {
        expect(x >= 0 && x <= A4.width && y >= 0 && y <= A4.height).toBe(true);
      }
      if (s.x1 === s.x2) expect(s.x1).toBeCloseTo(A4.width / 2, 6);
      else expect(s.y1).toBeCloseTo(A4.height / 2, 6);
    }
    expect(marks.filter((s) => s.x1 === s.x2)).toHaveLength(3);
  });

  it('el contenido de cada tarjeta queda dentro de su margen y en orden, con y sin logo', () => {
    for (const card of cardRects()) {
      for (const hasLogo of [true, false]) {
        const l = cardLayout(card, hasLogo);
        const inside = (r: Rect) =>
          r.x >= card.x + CARD_MARGIN - 0.01 &&
          r.y >= card.y + CARD_MARGIN - 0.01 &&
          r.x + r.width <= card.x + card.width - CARD_MARGIN + 0.01 &&
          r.y + r.height <= card.y + card.height - CARD_MARGIN + 0.01;
        for (const r of [l.stripe, l.qr, ...(l.logo ? [l.logo] : [])]) expect(inside(r)).toBe(true);
        expect(l.logo === null).toBe(!hasLogo);
        expect(l.nameBaseline).toBeLessThan(l.logo ? l.logo.y : l.stripe.y);
        expect(l.qr.y + l.qr.height).toBeLessThan(l.nameBaseline);
        expect(l.captionBaseline).toBeLessThan(l.qr.y);
        expect(l.urlBaseline).toBeLessThan(l.captionBaseline);
        expect(l.urlBaseline - 2).toBeGreaterThanOrEqual(card.y + CARD_MARGIN);
        expect(l.centerX).toBeCloseTo(card.x + card.width / 2, 6);
        expect(l.textWidth).toBeCloseTo(card.width - 2 * CARD_MARGIN, 6);
      }
    }
  });

  it('fitText reduce la letra hasta el mínimo y, si aun así no cabe, recorta con «…»', () => {
    const measure = (text: string, size: number) => text.length * size * 0.5;
    expect(fitText('La Taberna', measure, 200, 20, 11)).toEqual({ text: 'La Taberna', size: 20 });
    expect(fitText('x'.repeat(30), measure, 200, 20, 11)).toEqual({ text: 'x'.repeat(30), size: 13 });
    const cut = fitText('x'.repeat(60), measure, 200, 20, 11);
    expect(cut).toEqual({ text: `${'x'.repeat(35)}…`, size: 11 });
  });

  it('toWinAnsi deja solo lo que saben escribir las fuentes estándar del PDF', () => {
    expect(toWinAnsi('Café · Ñandú € «Œuf»')).toBe('Café · Ñandú € «Œuf»');
    expect(toWinAnsi('Crème brûlée')).toBe('Crème brûlée');
    expect(toWinAnsi('Łódź  🍕 Bar')).toBe('ódz Bar');
  });
});
