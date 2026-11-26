import { create, toBuffer } from 'qrcode';

/** Lado del PNG del QR, en píxeles. */
export const QR_PNG_SIZE = 1024;
/** Margen blanco alrededor del QR, en módulos (lo que pide el estándar para que se lea bien). */
export const QR_QUIET_ZONE = 4;

/** Dirección que lleva el QR: absoluta y sin ?lang= (cada móvil elige su idioma). */
export function menuQrUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/${slug}/menu`;
}

/** Módulos del QR (true = oscuro), con corrección de errores M (se sigue leyendo con un 15 % dañado). */
export function qrMatrix(text: string): boolean[][] {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (_, col) => modules.get(row, col) === 1),
  );
}

/** Tramos horizontales de módulos oscuros: menos rectángulos en el PDF y sin rayas finas entre módulos. */
export function qrRuns(matrix: boolean[][]): { row: number; col: number; length: number }[] {
  const runs: { row: number; col: number; length: number }[] = [];
  matrix.forEach((cells, row) => {
    let start = -1;
    cells.forEach((dark, col) => {
      if (dark && start < 0) start = col;
      const last = col === cells.length - 1;
      if (start >= 0 && (!dark || last)) {
        const end = dark && last ? col + 1 : col;
        runs.push({ row, col: start, length: end - start });
        start = -1;
      }
    });
  });
  return runs;
}

/** PNG de 1024 px con 4 módulos de margen: tinta oscura de FByte sobre blanco. */
export function qrPng(text: string): Promise<Buffer> {
  return toBuffer(text, {
    type: 'png',
    width: QR_PNG_SIZE,
    margin: QR_QUIET_ZONE,
    errorCorrectionLevel: 'M',
    color: { dark: '#0A1330FF', light: '#FFFFFFFF' },
  });
}
