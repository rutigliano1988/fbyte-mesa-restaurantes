import { requirePanelAccess } from '@/lib/auth/guards';
import { publicAccentTheme } from '@/lib/color';
import { siteUrl } from '@/lib/env';
import { getQrBranding } from '@/lib/menu/data';
import { fetchLogoPng } from '@/lib/menu/logo-png';
import { menuQrUrl } from '@/lib/menu/qr';
import { buildQrCardsPdf } from '@/lib/menu/qr-pdf';
import { mediaUrl } from '@/lib/public/data';

// sharp (logo WebP → PNG) necesita Node.js.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hoja A4 con 4 tarjetas A6 (logo, nombre, QR, texto en castellano e inglés y dirección) y marcas de corte. */
export async function GET(_request: Request, { params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  await requirePanelAccess(restaurantId, 'menu.edit');
  const brand = await getQrBranding(restaurantId);
  const pdf = await buildQrCardsPdf({
    name: brand.name,
    url: menuQrUrl(siteUrl(), brand.slug),
    accentColor: publicAccentTheme(brand.accentColor).accent,
    logoPng: brand.logoPath ? await fetchLogoPng(mediaUrl(brand.logoPath)) : null,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="qr-carta-${brand.slug}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
