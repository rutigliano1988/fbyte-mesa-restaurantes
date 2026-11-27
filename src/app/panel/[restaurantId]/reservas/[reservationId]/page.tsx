import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerWarnings } from '@/components/reservations/CustomerWarnings';
import { ReservationActions } from '@/components/reservations/ReservationActions';
import { ReservationForm } from '@/components/reservations/ReservationForm';
import { reservationName, tablesText } from '@/components/reservations/ReservationItem';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { isActiveStatus, SOURCE_LABELS_ES } from '@/lib/reservations/codes';
import { customerWarnings } from '@/lib/reservations/customers';
import { getBookingConfig, getBookingDay, getReservationStart } from '@/lib/reservations/data';
import { serviceDateOf, servicesForDate } from '@/lib/reservations/day';
import { formatPhoneDisplay } from '@/lib/reservations/phone';
import { dateParam, formatDayEs, formatTime } from '@/lib/reservations/time';
import { uuidSchema } from '@/lib/validation/schemas';

export const metadata: Metadata = { title: 'Reserva' };

export default async function ReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string; reservationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId, reservationId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'reservations.manage');
  if (!uuidSchema.safeParse(reservationId).success) notFound();
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const start = await getReservationStart(restaurantId, reservationId);
  if (start === null) notFound();
  const ownDate = serviceDateOf(start, tz, config.services, config.exceptions);
  // ?fecha=: al cambiarla en el formulario, se piden los huecos de ese otro día.
  const date = dateParam(sp.fecha, ownDate);
  const [own, other] = await Promise.all([
    getBookingDay(restaurantId, ownDate, tz),
    date === ownDate ? null : getBookingDay(restaurantId, date, tz),
  ]);
  const r = own.reservations.find((x) => x.id === reservationId);
  if (!r) notFound();
  const day = other ?? own;
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
  const name = reservationName(r);
  const time = formatTime(r.startMs, tz);
  const base = `/panel/${restaurantId}/reservas`;
  const editable = isActiveStatus(r.status) && !ctx.readOnly;

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={ownDate} canConfigure={can(ctx.role, 'settings.booking')} />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight">{name}</h1>
        <p className="text-muted">
          {formatDayEs(ownDate)} · {time}–{formatTime(r.endMs, tz)} · {r.partySize} {r.partySize === 1 ? 'persona' : 'personas'} ·{' '}
          {tablesText(r.tableIds, tableNames)} · {SOURCE_LABELS_ES[r.source]}
        </p>
        <Link href={`${base}?fecha=${ownDate}`} className="font-bold text-navy hover:underline">
          Volver al día
        </Link>
      </header>
      {sp.aviso === 'guardada' && <Notice tone="success">Cambios guardados.</Notice>}

      <SectionCard title="Estado">
        <ReservationActions
          restaurantId={restaurantId}
          reservationId={r.id}
          status={r.status}
          previousStatus={r.previousStatus}
          who={`${name}, ${time}`}
          readOnly={ctx.readOnly}
        />
      </SectionCard>

      {r.customer && (
        <SectionCard title="Cliente">
          <p>
            <strong>{r.customer.name}</strong>
            {r.customer.phone && ` · ${formatPhoneDisplay(r.customer.phone)}`}
            {r.customer.email && ` · ${r.customer.email}`}
          </p>
          <CustomerWarnings warnings={customerWarnings(r.customer)} />
        </SectionCard>
      )}

      {editable ? (
        <SectionCard title="Cambiar la reserva" intro="Hora, personas, duración, mesas y notas. Si cambias la hora o las mesas, comprobamos que sigan libres.">
          <ReservationForm
            mode="edit"
            restaurantId={restaurantId}
            reservationId={r.id}
            date={date}
            path={`${base}/${r.id}`}
            timeZone={tz}
            services={servicesForDate(date, config.services, config.exceptions)}
            tables={config.tables}
            occupancy={day.occupancy}
            blocks={day.blocks}
            settings={config.settings}
            initial={{
              time,
              partySize: r.partySize,
              durationMin: Math.round((r.endMs - r.startMs) / 60_000),
              tableMode: r.tableIds.length > 0 ? 'keep' : 'none',
              tableIds: r.tableIds,
              notes: r.notes ?? '',
              internalNotes: r.internalNotes ?? '',
              start: { date: ownDate, ms: r.startMs },
            }}
          />
        </SectionCard>
      ) : (
        (r.notes || r.internalNotes) && (
          <SectionCard title="Notas">
            {r.notes && <p>Del cliente: {r.notes}</p>}
            {r.internalNotes && <p>Interna: {r.internalNotes}</p>}
          </SectionCard>
        )
      )}
    </div>
  );
}
