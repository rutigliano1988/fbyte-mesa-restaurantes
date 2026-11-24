import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getPanelContext } from '@/lib/auth/guards';
import { ROLE_LABELS } from '@/lib/permissions';

export default async function PanelHome({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await getPanelContext(restaurantId);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">{ctx.restaurant.name}</h1>
        <StatusBadge status={ctx.restaurant.status} />
      </div>
      <Card>
        <p>
          Entras como <strong>{ROLE_LABELS[ctx.role]}</strong>. Pronto verás aquí las reservas de hoy y lo más importante del día.
        </p>
      </Card>
    </div>
  );
}
