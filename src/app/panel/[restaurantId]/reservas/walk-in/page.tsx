import type { Metadata } from 'next';
import Link from 'next/link';
import { RealtimeRefresh } from '@/components/reservations/RealtimeRefresh';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { WalkInForm } from '@/components/reservations/WalkInForm';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { currentServiceDate } from '@/lib/reservations/day';
import { formatTime } from '@/lib/reservations/time';

export const metadata: Metadata = { title: 'Walk-in' };

/** Ahora, redondeado al minuto (como la BD, que sienta el walk-in con date_trunc('minute', now())). */
function nowToTheMinute(): number {
  return Math.floor(new Date().getTime() / 60_000) * 60_000;
}

export default async function WalkInPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  const config = await getBookingConfig(restaurantId);
  const now = nowToTheMinute();
  // El día de servicio de ahora (de madrugada, el de la cena de la víspera si aún no ha acabado).
  const today = currentServiceDate(config, now);
  // En modo soporte el formulario no se muestra: no se piden los datos del día.
  const day = ctx.readOnly ? null : await getBookingDay(restaurantId, today, config.timezone);
  // Las mesas desactivadas no se ofrecen.
  const tables = config.tables.filter((t) => t.active);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={today} canConfigure={can(ctx.role, 'settings.booking')} />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Walk-in</h1>
        <p className="mt-1 text-muted">
          Gente que llega sin reserva: se sientan ya ({formatTime(now, config.timezone)}).{' '}
          <Link href={`/panel/${restaurantId}/reservas`} className="font-bold text-navy hover:underline">
            Volver a hoy
          </Link>
        </p>
        {!ctx.readOnly && <RealtimeRefresh restaurantId={restaurantId} blockIds={day?.blocks.map((b) => b.id) ?? []} />}
      </header>
      {ctx.readOnly ? (
        <Notice tone="info">En modo soporte no se pueden sentar walk-ins.</Notice>
      ) : tables.length === 0 ? (
        <Notice tone="info">
          {can(ctx.role, 'settings.booking')
            ? 'Aún no tienes mesas activas: créalas o actívalas en Reservas → Ajustes.'
            : 'Aún no hay mesas activas. Pídele a tu encargado que las cree o las active.'}
        </Notice>
      ) : (
        <SectionCard title="¿Cuántos son?">
          <WalkInForm
            restaurantId={restaurantId}
            nowMs={now}
            tables={tables}
            occupancy={day?.occupancy ?? []}
            blocks={day?.blocks ?? []}
            settings={config.settings}
          />
        </SectionCard>
      )}
    </div>
  );
}
