'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * Fallo dentro del panel de un restaurante: se pinta dentro de su layout (cabecera y menú siguen ahí).
 * Nunca enseña error.message; el detalle queda en la consola y, en el servidor, en los logs (digest).
 */
export default function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  const { restaurantId } = useParams<{ restaurantId: string }>();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold tracking-tight">No hemos podido hacer ese cambio</h1>
      <p className="text-muted">Vuelve a intentarlo. Si sigue pasando, escríbenos.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => retry()}>
          Reintentar
        </Button>
        <Link href={`/panel/${restaurantId}`} className={buttonClass('ghost')}>
          Ir al inicio del panel
        </Link>
      </div>
    </Card>
  );
}
