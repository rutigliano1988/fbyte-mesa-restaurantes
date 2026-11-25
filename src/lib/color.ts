export const DEFAULT_ACCENT = '#17317F';
export const INK = '#0A1330';
export const WHITE = '#FFFFFF';
/** Contraste mínimo WCAG AA para texto normal. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9A-F]{6}$/;

/** '#abc123', 'ABC123' → '#ABC123'. null si no es un color #RRGGBB. */
export function normalizeHex(input: string): string | null {
  const value = input.trim().toUpperCase();
  const withHash = value.startsWith('#') ? value : `#${value}`;
  return HEX.test(withHash) ? withHash : null;
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const color = normalizeHex(hex);
  if (!color) throw new Error(`Color no válido: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto sobre un fondo de color: ink o blanco, el que más contraste dé. */
export function readableTextOn(background: string): typeof INK | typeof WHITE {
  return contrastRatio(background, INK) >= contrastRatio(background, WHITE) ? INK : WHITE;
}

export type AccentTheme = {
  /** Fondo de los botones. */
  accent: string;
  /** Texto encima del acento (ink o blanco). */
  onAccent: string;
  /** Color para enlaces y títulos sobre blanco: el acento si contrasta lo bastante, si no, ink. */
  accentText: string;
  /** El texto sobre el acento llega a 4,5:1. */
  meetsAA: boolean;
};

export function accentTheme(input: string | null | undefined): AccentTheme {
  const accent = (input && normalizeHex(input)) || DEFAULT_ACCENT;
  const onAccent = readableTextOn(accent);
  return {
    accent,
    onAccent,
    accentText: contrastRatio(accent, WHITE) >= MIN_CONTRAST ? accent : INK,
    meetsAA: contrastRatio(accent, onAccent) >= MIN_CONTRAST,
  };
}

/**
 * Colores de la mini-web: el acento guardado solo si su texto llega a 4,5:1; si no (p. ej. un color
 * guardado antes de la comprobación o metido a mano), el navy por defecto.
 */
export function publicAccentTheme(input: string | null | undefined): AccentTheme {
  const theme = accentTheme(input);
  return theme.meetsAA ? theme : accentTheme(DEFAULT_ACCENT);
}
