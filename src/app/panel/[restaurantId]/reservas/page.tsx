import type { Metadata } from 'next';
import Link from 'next/link';
import { DayPicker } from '@/components/reservations/DayPicker';
import { RealtimeRefresh } from '@/components/reservations/RealtimeRefresh';
import { ReservationItem } from '@/components/reservations/ReservationItem';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { buttonClass } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { can } from '@/lib/permissions';
import { isActiveStatus } from '@/lib/reservations/codes';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { groupByService, servicesForDate, summarize } from '@/lib/reservations/day';
import type { PanelReservation } from '@/lib/reservations/rows';
import { addDays, dateParam, formatTime, serviceDayWindow } from '@/lib/reservations/time';
import { formatRange, todayInTimeZone } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Reservas' };

const NOTICES: Record<string, string> = {
  creada: 'Reserva guardada.',
  'walk-in': 'Walk-in sentado.',
};

function SummaryLine({ items }: { items: PanelReservation[] }) {
  const s = summarize(items);
  return (
    <p className="text-sm text-muted">
      {s.reservations === 1 ? '1 reserva' : `${s.reservations} reservas`} · {s.covers === 1 ? '1 persona' : `${s.covers} personas`}
      {s.pending > 0 && ` · ${s.pending === 1 ? '1 pendiente' : `${s.pending} pendientes`}`}
    </p>
  );
}

export default async function ReservationsDayPage({
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
  const day = await getBookingDay(restaurantId, date, tz);
  const services = servicesForDate(date, config.services, config.exceptions);
  const { groups, outside } = groupByService(
    day.reservations,
    date,
    tz,
    services,
    servicesForDate(addDays(date, -1), config.services, config.exceptions),
  );
  const ofTheDay = [...groups.flatMap((g) => g.items), ...outside];
  const unassigned = ofTheDay.filter((r) => isActiveStatus(r.status) && r.tableIds.length === 0);
  const withTable = (items: PanelReservation[]) => items.filter((r) => !unassigned.includes(r));
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
  const canConfigure = can(ctx.role, 'settings.booking');
  const readOnly = ctx.readOnly;
  const notice = typeof sp.aviso === 'string' && Object.hasOwn(NOTICES, sp.aviso) ? NOTICES[sp.aviso] : null;
  const base = `/panel/${restaurantId}/reservas`;
  const item = (r: PanelReservation) => (
    <ReservationItem key={r.id} restaurantId={restaurantId} reservation={r} tableNames={tableNames} timeZone={tz} readOnly={readOnly} />
  );
  const dayWindow = serviceDayWindow(date, tz);
  const dayBlocks = day.blocks.filter((b) => b.startMs < dayWindow.to && b.endMs > dayWindow.from);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="dia" date={date} canConfigure={canConfigure} />
      <header className="flex flex-col gap-3">
        <DayPicker path={base} date={date} today={today} />
        {!readOnly && (
          <div className="flex flex-wrap gap-3">
            <Link href={`${base}/nueva?fecha=${date}`} className={buttonClass('primary')}>
              Nueva reserva
            </Link>
            <Link href={`${base}/walk-in`} className={buttonClass('secondary')}>
              Walk-in (sin reserva)
            </Link>
          </div>
        )}
        <RealtimeRefresh restaurantId={restaurantId} />
      </header>

      {notice && <Notice tone="success">{notice}</Notice>}

      {config.tables.length === 0 && (
        <Notice tone="info">
          Aún no tienes mesas.{' '}
          {canConfigure ? (
            <Link href={`${base}/ajustes#mesas`} className="font-bold text-navy underline">
              Crea tus mesas
            </Link>
          ) : (
            'Pide a tu encargado que cree las mesas'
          )}{' '}
          para asignarlas a las reservas.
        </Notice>
      )}

      {unassigned.length > 0 && (
        <SectionCard title="Sin mesa asignada" intro="Reservas guardadas sin mesa. Ábrelas para darles una cuando haya hueco.">
          <ul className="flex flex-col gap-3">{unassigned.map(item)}</ul>
        </SectionCard>
      )}

      {groups.length === 0 && (
        <Notice tone="info">
          Este día no tienes servicios en el horario. Puedes guardar reservas igualmente: salen en «Fuera de horario».
        </Notice>
      )}

      {groups.map((g) => (
        <SectionCard key={g.service.key} title={`${g.service.name} · ${formatRange(g.service.startMinute, g.service.endMinute)}`}>
          <SummaryLine items={g.items} />
          {withTable(g.items).length === 0 ? (
            <p className="text-sm text-muted">No hay reservas con mesa en este servicio.</p>
          ) : (
            <ul className="flex flex-col gap-3">{withTable(g.items).map(item)}</ul>
          )}
        </SectionCard>
      ))}

      {outside.length > 0 && (
        <SectionCard title="Fuera de horario" intro="Reservas a una hora en la que no hay ningún servicio.">
          <SummaryLine items={outside} />
          {withTable(outside).length > 0 && <ul className="flex flex-col gap-3">{withTable(outside).map(item)}</ul>}
        </SectionCard>
      )}

      {dayBlocks.length > 0 && (
        <SectionCard title="Bloqueos">
          <ul className="flex flex-col gap-1 text-sm">
            {dayBlocks.map((b) => (
              <li key={b.id}>
                <strong>{b.tableId ? (tableNames.get(b.tableId) ?? 'Mesa') : 'Todo el restaurante'}</strong> · {formatTime(b.startMs, tz)}–
                {formatTime(b.endMs, tz)}
                {b.reason && ` · ${b.reason}`}
              </li>
            ))}
          </ul>
          {canConfigure && (
            <Link href={`${base}/bloqueos?fecha=${date}`} className="text-sm font-bold text-navy hover:underline">
              Gestionar bloqueos
            </Link>
          )}
        </SectionCard>
      )}
    </div>
  );
}
