import type { Metadata } from 'next';
import { ActionForm, FormCheckbox, FormField, FormSelect } from '@/components/forms/ActionForm';
import { DayPicker } from '@/components/reservations/DayPicker';
import { RealtimeRefresh } from '@/components/reservations/RealtimeRefresh';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { SectionCard } from '@/components/ui/SectionCard';
import { createBlock, deleteBlock } from '@/lib/actions/blocks';
import { requirePanelAccess } from '@/lib/auth/guards';
import { compareTablesForDisplay } from '@/lib/reservations/availability';
import { getBookingConfig, getBookingDay } from '@/lib/reservations/data';
import { currentServiceDate } from '@/lib/reservations/day';
import { dateParam, formatDayEs, formatTime, localParts, serviceDayWindow } from '@/lib/reservations/time';
import { formatDateEs } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Bloqueos' };

export default async function BlocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { restaurantId } = await params;
  const sp = await searchParams;
  const ctx = await requirePanelAccess(restaurantId, 'settings.booking');
  const config = await getBookingConfig(restaurantId);
  const tz = config.timezone;
  const today = currentServiceDate(config);
  const date = dateParam(sp.fecha, today);
  const day = await getBookingDay(restaurantId, date, tz);
  const window = serviceDayWindow(date, tz);
  const blocks = day.blocks.filter((b) => b.startMs < window.to && b.endMs > window.from);
  const tables = [...config.tables].filter((t) => t.active).sort(compareTablesForDisplay);
  const tableNames = new Map(config.tables.map((t) => [t.id, t.name]));
  // Una hora de otro día (franja que cruza la medianoche) lleva su fecha delante.
  const when = (ms: number) => {
    const p = localParts(ms, tz);
    return p.date === date ? formatTime(ms, tz) : `${formatDateEs(p.date)} ${formatTime(ms, tz)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="bloqueos" date={date} canConfigure />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Bloqueos</h1>
        <DayPicker path={`/panel/${restaurantId}/reservas/bloqueos`} date={date} today={today} />
        <p className="text-muted">Una mesa (o todo el restaurante) que no se puede reservar durante un rato: una avería, un evento privado…</p>
        <RealtimeRefresh restaurantId={restaurantId} blockIds={blocks.map((b) => b.id)} />
      </header>

      <SectionCard title={`Bloqueos del ${formatDayEs(date)}`}>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted">No hay ningún bloqueo este día.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocks.map((b) => {
              const what = b.tableId ? (tableNames.get(b.tableId) ?? 'Mesa') : 'Todo el restaurante';
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border-2 border-ink/10 px-3 py-2">
                  <span>
                    <strong>{what}</strong> · {when(b.startMs)}–{when(b.endMs)}
                    {b.reason && ` · ${b.reason}`}
                  </span>
                  {!ctx.readOnly && (
                    <form action={deleteBlock}>
                      <input type="hidden" name="restaurantId" value={restaurantId} />
                      <input type="hidden" name="blockId" value={b.id} />
                      <button
                        type="submit"
                        aria-label={`Quitar el bloqueo de ${what} de ${when(b.startMs)} a ${when(b.endMs)}`}
                        className="px-2 py-1 text-sm font-bold text-red-700 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      >
                        Quitar
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {!ctx.readOnly && (
        <SectionCard title="Nuevo bloqueo" intro="Si acaba antes de empezar, acaba al día siguiente (por ejemplo, de 22:00 a 01:00).">
          <ActionForm action={createBlock} hidden={{ restaurantId }} submitLabel="Bloquear" pendingLabel="Guardando…">
            <FormSelect
              label="Qué se bloquea"
              name="tableId"
              defaultValue=""
              options={[{ value: '', label: 'Todo el restaurante' }, ...tables.map((t) => ({ value: t.id, label: `${t.name} (${t.zoneName})` }))]}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Fecha" name="date" type="date" defaultValue={date} required />
              <FormField label="Desde" name="start" type="time" defaultValue="13:00" />
              <FormField label="Hasta" name="end" type="time" defaultValue="16:00" />
            </div>
            <FormCheckbox name="allDay" label="Todo el día (de 00:00 a 24:00)" />
            <FormField label="Motivo (opcional)" name="reason" maxLength={140} placeholder="Evento privado" />
          </ActionForm>
        </SectionCard>
      )}
    </div>
  );
}
