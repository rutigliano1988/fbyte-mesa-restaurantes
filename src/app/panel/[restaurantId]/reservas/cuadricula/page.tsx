import type { Metadata } from 'next';
import Link from 'next/link';
import { DayPicker } from '@/components/reservations/DayPicker';
import { RealtimeRefresh } from '@/components/reservations/RealtimeRefresh';
import { ReservationGrid } from '@/components/reservations/ReservationGrid';
import { reservationName } from '@/components/reservations/ReservationItem';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { Notice } from '@/components/ui/Notice';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { compareTablesForDisplay } from '@/lib/reservations/availability';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { servicesForDate } from '@/lib/reservations/day';
import { buildGrid } from '@/lib/reservations/grid';
import { dateParam } from '@/lib/reservations/time';
import { formatRange, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Cuadrícula de reservas' };

export default async function GridPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const today = todayInTimeZone(tz);
  const date = dateParam(sp.fecha, today);
  const services = servicesForDate(date, config.services, config.exceptions);
  const service = services.find((s) => s.key === sp.servicio) ?? services[0] ?? null;
  const day = await getBookingDay(restaurantId, date, tz);
  const tables = [...config.tables].sort(compareTablesForDisplay);
  const reservations = day.reservations.map((r) => ({
    id: r.id,
    startMs: r.startMs,
    endMs: r.endMs,
    tableIds: r.tableIds,
    status: r.status,
    name: reservationName(r),
    partySize: r.partySize,
  }));
  const layout = service ? buildGrid({ date, timeZone: tz, service, tables, reservations, blocks: day.blocks }) : null;
  const readOnly = ctx.readOnly;
  const canConfigure = can(ctx.role, 'settings.booking');
  const path = `/panel/${restaurantId}/reservas/cuadricula`;

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="cuadricula" date={date} canConfigure={canConfigure} />
      <header className="flex flex-col gap-3">
        <DayPicker path={path} date={date} today={today} keep={service ? { servicio: service.key } : {}} />
        {services.length > 1 && (
          <nav aria-label="Servicio" className="flex flex-wrap gap-2">
            {services.map((s) => (
              <Link
                key={s.key}
                href={`${path}?fecha=${date}&servicio=${s.key}`}
                aria-current={s.key === service?.key ? 'page' : undefined}
                className={`rounded-[6px] border-2 px-3 py-1.5 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy ${s.key === service?.key ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white hover:bg-peach-soft'}`}
              >
                {s.name} · {formatRange(s.startMinute, s.endMinute)}
              </Link>
            ))}
          </nav>
        )}
        <RealtimeRefresh restaurantId={restaurantId} blockIds={day.blocks.map((b) => b.id)} />
        <p className="text-sm text-muted">
          {readOnly
            ? 'Toca una barra para abrir la reserva. Con el teclado: flechas para moverte e Intro para abrir.'
            : 'Toca un hueco para crear una reserva en esa mesa y hora, o una barra para abrir la reserva. Con el teclado: flechas para moverte e Intro para abrir.'}{' '}
          Las reservas sin mesa están en la vista del día.
        </p>
      </header>
      {tables.length === 0 ? (
        <Notice tone="info">
          {canConfigure ? 'Aún no tienes mesas: créalas en Reservas → Ajustes.' : 'Aún no hay mesas. Pídele a tu encargado que las cree.'}
        </Notice>
      ) : !service || !layout || layout.columns.length === 0 ? (
        <Notice tone="info">Este día no tienes servicios en el horario.</Notice>
      ) : layout.rows.length === 0 ? (
        <Notice tone="info">
          {canConfigure ? 'Todas tus mesas están desactivadas: actívalas en Reservas → Ajustes.' : 'Todas las mesas están desactivadas. Pídele a tu encargado que las active.'}
        </Notice>
      ) : (
        <ReservationGrid
          restaurantId={restaurantId}
          date={date}
          timeZone={tz}
          layout={layout}
          tables={tables}
          reservations={reservations}
          blocks={day.blocks}
          readOnly={readOnly}
          label={`Mesas y horas de ${service.name}, ${formatRange(service.startMinute, service.endMinute)}`}
        />
      )}
    </div>
  );
}
