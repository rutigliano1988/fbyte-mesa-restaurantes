import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { menuQrUrl, qrPng } from '@/lib/menu/qr';

// qrcode (y sharp en el PDF) necesitan Node.js.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PNG del QR de la carta (1024 px). Con ?descargar=1 se descarga; si no, se ve en la página del QR. */
export async function GET(request: Request, { params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'menu.edit');
  const png = await qrPng(menuQrUrl(siteUrl(), ctx.restaurant.slug));
  const headers: Record<string, string> = { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' };
  if (new URL(request.url).searchParams.get('descargar') === '1') {
    headers['Content-Disposition'] = `attachment; filename="qr-carta-${ctx.restaurant.slug}.png"`;
  }
  return new Response(new Uint8Array(png), { headers });
}
