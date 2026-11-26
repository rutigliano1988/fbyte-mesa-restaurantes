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

/** Descarga el logo público y lo pasa a PNG. null si no se puede: el PDF sale sin logo. */
export async function fetchLogoPng(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await logoToPng(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
