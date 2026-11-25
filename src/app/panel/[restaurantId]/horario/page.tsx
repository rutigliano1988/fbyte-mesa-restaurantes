import type { Metadata } from 'next';
import { ActionForm, FormCheckboxGroup, FormField, FormSelect } from '@/components/forms/ActionForm';
import { ExceptionItem } from '@/components/schedule/ExceptionItem';
import { ServiceRow } from '@/components/schedule/ServiceRow';
import { SectionCard } from '@/components/ui/SectionCard';
import { addException, addServices } from '@/lib/actions/schedule';
import { requirePanelAccess } from '@/lib/auth/guards';
import { getRestaurantSchedule } from '@/lib/local/data';
import { groupByWeekday, todayInTimeZone, upcomingExceptions, WEEKDAY_LABELS_ES, WEEKDAYS } from '@/lib/schedule';

export const metadata: Metadata = { title: 'Horario' };

export default async function SchedulePage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'settings.booking');
  const readOnly = ctx.readOnly;
  const { timezone, services, exceptions } = await getRestaurantSchedule(restaurantId);
  const byDay = groupByWeekday(services);
  const upcoming = upcomingExceptions(exceptions, todayInTimeZone(timezone), 100);
  const hidden = { restaurantId };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Horario</h1>
        <p className="mt-1 text-muted">Tus servicios de cada semana y los días que cierras o abres distinto. Sale tal cual en tu web.</p>
      </header>

      <SectionCard title="Servicios de cada día" intro="Un día sin servicios sale como cerrado.">
        <ul className="flex flex-col gap-4">
          {WEEKDAYS.map((day) => (
            <li key={day}>
              <h3 className="font-bold">{WEEKDAY_LABELS_ES[day]}</h3>
              {byDay[day].length === 0 ? (
                <p className="text-sm text-muted">Cerrado</p>
              ) : (
                <ul>
                  {byDay[day].map((s) => (
                    <ServiceRow key={s.id} restaurantId={restaurantId} service={s} readOnly={readOnly} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      {!readOnly && (
        <SectionCard
          title="Añadir un servicio"
          intro="Si acaba después de medianoche, pon la hora tal cual (por ejemplo, de 20:00 a 00:30). Como muy tarde, las 06:00."
        >
          <ActionForm action={addServices} hidden={hidden} submitLabel="Añadir servicio" pendingLabel="Añadiendo…">
            <FormField label="Nombre" name="name" list="service-names" placeholder="Comida" maxLength={40} required />
            <datalist id="service-names">
              <option value="Desayuno" />
              <option value="Comida" />
              <option value="Cena" />
            </datalist>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Empieza" name="start" type="time" required />
              <FormField label="Acaba" name="end" type="time" required />
            </div>
            <FormCheckboxGroup
              legend="Días"
              name="weekdays"
              options={WEEKDAYS.map((d) => ({ value: String(d), label: WEEKDAY_LABELS_ES[d] }))}
            />
          </ActionForm>
        </SectionCard>
      )}

      <SectionCard title="Cierres y horarios especiales" intro="Vacaciones, festivos o días con otro horario. En tu web salen los próximos.">
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">No tienes ningún cierre previsto.</p>
        ) : (
          <ul>
            {upcoming.map((e) => (
              <ExceptionItem key={e.id} restaurantId={restaurantId} exception={e} readOnly={readOnly} />
            ))}
          </ul>
        )}
        {!readOnly && (
          <ActionForm action={addException} hidden={hidden} submitLabel="Guardar" pendingLabel="Guardando…">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Desde" name="dateFrom" type="date" required />
              <FormField label="Hasta" name="dateTo" type="date" hint="Déjalo vacío si es un solo día." />
            </div>
            <FormSelect
              label="Ese día"
              name="kind"
              defaultValue="closed"
              options={[
                { value: 'closed', label: 'Cerramos' },
                { value: 'custom', label: 'Abrimos con otro horario' },
              ]}
            />
            <FormField label="Nota (opcional)" name="note" maxLength={140} placeholder="Vacaciones de Navidad" />
            <fieldset className="flex flex-col gap-3 rounded-[6px] border-2 border-ink/10 p-4">
              <legend className="px-1 text-sm font-bold">Horario especial (solo si abres con otro horario)</legend>
              {(['1', '2'] as const).map((n) => (
                <div key={n} className="grid gap-3 sm:grid-cols-3">
                  <FormField label={`Servicio ${n}`} name={`name${n}`} placeholder={n === '1' ? 'Comida' : 'Cena'} maxLength={40} />
                  <FormField label="Empieza" name={`start${n}`} type="time" />
                  <FormField label="Acaba" name={`end${n}`} type="time" />
                </div>
              ))}
            </fieldset>
          </ActionForm>
        )}
      </SectionCard>
    </div>
  );
}
