import type { Metadata } from 'next';
import Link from 'next/link';
import { ReservationForm } from '@/components/reservations/ReservationForm';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { servicesForDate, slotMinutes } from '@/lib/reservations/day';
import { dateParam, formatDayEs } from '@/lib/reservations/time';
import { minutesToTime, timeToMinutes, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Nueva reserva' };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default async function NewReservationPage({
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
  const date = dateParam(sp.fecha, todayInTimeZone(config.timezone));
  const day = await getBookingDay(restaurantId, date, config.timezone);
  const services = servicesForDate(date, config.services, config.exceptions);
  const base = `/panel/${restaurantId}/reservas`;

  // Desde la cuadrícula llegan la hora y la mesa del hueco; si no, la primera hora del día y la mesa propuesta.
  const hora = one(sp.hora);
  const firstSlot = services[0] ? slotMinutes(services[0])[0] : null;
  const time = timeToMinutes(hora) !== null ? hora : firstSlot !== null ? minutesToTime(firstSlot) : '21:00';
  const personas = Number(one(sp.personas));
  const partySize = Number.isInteger(personas) && personas >= 1 && personas <= 50 ? personas : 2;
  const mesa = one(sp.mesa);
  const table = config.tables.find((t) => t.id === mesa && t.active);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={date} canConfigure={can(ctx.role, 'settings.booking')} />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Nueva reserva</h1>
        <p className="mt-1 text-muted">
          Por teléfono o en persona. Te proponemos la mesa más pequeña que sirve.{' '}
          <Link href={`${base}?fecha=${date}`} className="font-bold text-navy hover:underline">
            Volver al {formatDayEs(date)}
          </Link>
        </p>
      </header>
      {ctx.readOnly ? (
        <Notice tone="info">En modo soporte no se pueden crear reservas.</Notice>
      ) : (
        <SectionCard title="Datos de la reserva">
          <ReservationForm
            mode="create"
            restaurantId={restaurantId}
            date={date}
            path={`${base}/nueva`}
            timeZone={config.timezone}
            services={services}
            tables={config.tables}
            occupancy={day.occupancy}
            blocks={day.blocks}
            settings={config.settings}
            initial={{
              time,
              partySize,
              durationMin: null,
              tableMode: table ? 'manual' : 'auto',
              tableIds: table ? [table.id] : [],
              notes: '',
              internalNotes: '',
            }}
          />
        </SectionCard>
      )}
    </div>
  );
}
