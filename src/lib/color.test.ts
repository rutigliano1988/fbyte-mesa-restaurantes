import { describe, expect, it } from 'vitest';
import {
  accentTheme,
  contrastRatio,
  DEFAULT_ACCENT,
  INK,
  normalizeHex,
  publicAccentTheme,
  readableTextOn,
  WHITE,
} from './color';

describe('normalizeHex', () => {
  it('acepta #RRGGBB con o sin almohadilla y lo pasa a mayúsculas', () => {
    expect(normalizeHex('#17317f')).toBe('#17317F');
    expect(normalizeHex(' ff7a1a ')).toBe('#FF7A1A');
  });

  it('rechaza lo que no es un color de 6 cifras', () => {
    for (const bad of ['#FFF', 'rojo', '#GGGGGG', '#1234567', '']) expect(normalizeHex(bad)).toBeNull();
  });
});

describe('contraste WCAG', () => {
  it('blanco sobre negro es 21:1 y un color consigo mismo 1:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#17317F', '#17317F')).toBeCloseTo(1, 5);
  });

  it('elige blanco sobre navy e ink sobre naranja y melocotón', () => {
    expect(readableTextOn('#17317F')).toBe(WHITE);
    expect(readableTextOn('#FF7A1A')).toBe(INK);
    expect(readableTextOn('#FFC48A')).toBe(INK);
  });
});

describe('accentTheme', () => {
  it('sin color usa el navy de FByte', () => {
    expect(accentTheme(null)).toEqual({ accent: DEFAULT_ACCENT, onAccent: WHITE, accentText: DEFAULT_ACCENT, meetsAA: true });
  });

  it('un acento claro se usa de fondo, pero los enlaces van en ink', () => {
    expect(accentTheme('#ffc48a')).toEqual({ accent: '#FFC48A', onAccent: INK, accentText: INK, meetsAA: true });
  });

  it('un gris medio no llega a 4,5:1 ni con ink ni con blanco', () => {
    expect(accentTheme('#7A7A7A').meetsAA).toBe(false);
  });
});

describe('publicAccentTheme (mini-web)', () => {
  it('usa el color guardado si su texto llega a 4,5:1', () => {
    expect(publicAccentTheme('#FFC48A')).toEqual(accentTheme('#FFC48A'));
  });

  it('si el color guardado no llega a 4,5:1, usa el navy por defecto', () => {
    expect(publicAccentTheme('#7A7A7A')).toEqual(accentTheme(DEFAULT_ACCENT));
  });

  it('sin color o con un color no válido, también el navy por defecto', () => {
    expect(publicAccentTheme(null).accent).toBe(DEFAULT_ACCENT);
    expect(publicAccentTheme('rojo').accent).toBe(DEFAULT_ACCENT);
  });
});
