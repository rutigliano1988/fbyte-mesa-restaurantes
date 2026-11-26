import sharp from 'sharp';

/** Lado mayor del logo que se incrusta en el PDF, en píxeles (de sobra para 64 pt impresos). */
export const LOGO_PNG_MAX = 512;

/** Logo del bucket (WebP o JPEG) → PNG, que es lo que sabe incrustar pdf-lib. Solo en el servidor (Node.js). */
export async function logoToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const png = await sharp(bytes)
    .resize({ width: LOGO_PNG_MAX, height: LOGO_PNG_MAX, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Tamaño máximo del logo que se descarga: el límite del bucket (2 MB). */
export const LOGO_MAX_BYTES = 2_097_152;

/** Descarga el logo público y lo pasa a PNG. null si no se puede (fallo, más de 5 s o más de 2 MB): el PDF sale sin logo. */
export async function fetchLogoPng(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > LOGO_MAX_BYTES) return null;
    return await logoToPng(new Uint8Array(buf));
  } catch {
    return null;
  }
}
