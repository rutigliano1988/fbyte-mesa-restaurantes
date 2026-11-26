import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { menuQrUrl } from '@/lib/menu/qr';

export const metadata: Metadata = { title: 'Código QR' };

export default async function QrPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'menu.edit');
  const url = menuQrUrl(siteUrl(), ctx.restaurant.slug);
  const base = `/panel/${restaurantId}/menu/qr`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={`/panel/${restaurantId}/menu`} className="text-sm font-bold text-navy hover:underline">
          ← Menú
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Código QR de tu carta</h1>
        <p className="mt-1 text-muted">Ponlo en las mesas: al escanearlo, tus clientes ven la carta en su idioma.</p>
      </header>

      {ctx.restaurant.status !== 'active' && (
        <Notice tone="info">Tu web todavía no está publicada: el QR no funcionará hasta que la publiques desde el inicio del panel.</Notice>
      )}

      <SectionCard title="Vista previa" intro="Si cambias la dirección de tu web, los QR que ya tengas impresos siguen funcionando.">
        <Image
          src={`${base}/png`}
          alt={`Código QR que abre ${url}`}
          width={256}
          height={256}
          unoptimized
          className="size-64 rounded-[6px] border-2 border-ink/15"
        />
        <p className="break-all font-bold">{url}</p>
        <div className="flex flex-wrap gap-3">
          <a href={`${base}/png?descargar=1`} download className={buttonClass('primary')}>
            Descargar PNG
          </a>
          <a href={`${base}/pdf`} download className={buttonClass('secondary')}>
            Descargar PDF para imprimir
          </a>
        </div>
        <p className="text-sm text-muted">
          El PDF es una hoja A4 con 4 tarjetas A6 y marcas de corte. Imprímelo al 100 % (sin «Ajustar a la página») y corta por las marcas.
        </p>
      </SectionCard>
    </div>
  );
}
