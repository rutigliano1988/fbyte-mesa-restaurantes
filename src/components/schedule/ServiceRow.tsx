import { ActionForm, FormField, FormSelect } from '@/components/forms/ActionForm';
import { deleteService, updateService } from '@/lib/actions/schedule';
import type { ScheduleService } from '@/lib/local/data';
import { effectiveLastBooking } from '@/lib/reservations/day';
import { formatRange, isWeekday, minutesToTime, WEEKDAY_LABELS_ES } from '@/lib/schedule';

export const SLOT_INTERVAL_OPTIONS = [
  { value: '15', label: 'Cada 15 min' },
  { value: '30', label: 'Cada 30 min' },
];

/** 'última reserva 23:30 · cada 30 min' (la última, también cuando es la de por defecto). */
function bookingSummary(service: ScheduleService): string {
  const last = effectiveLastBooking(service.startMinute, service.endMinute, service.lastBookingMinute);
  return `última reserva ${minutesToTime(last)} · cada ${service.slotIntervalMin} min`;
}

export function ServiceRow({
  restaurantId,
  service,
  readOnly,
}: {
  restaurantId: string;
  service: ScheduleService;
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <li className="py-1">
        <strong>{service.name}</strong> · {formatRange(service.startMinute, service.endMinute)} · {bookingSummary(service)}
      </li>
    );
  }
  const day = isWeekday(service.weekday) ? ` del ${WEEKDAY_LABELS_ES[service.weekday].toLowerCase()}` : '';
  return (
    <li className="flex flex-col gap-2 border-b border-ink/10 py-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <ActionForm
          action={updateService}
          hidden={{ restaurantId, serviceId: service.id }}
          inline
          submitLabel="Guardar"
        >
          <FormField id={`name-${service.id}`} label="Servicio" name="name" defaultValue={service.name} maxLength={40} required />
          <FormField id={`start-${service.id}`} label="Empieza" name="start" type="time" defaultValue={minutesToTime(service.startMinute)} required />
          <FormField id={`end-${service.id}`} label="Acaba" name="end" type="time" defaultValue={minutesToTime(service.endMinute)} required />
          <FormField
            id={`last-${service.id}`}
            label="Última reserva"
            name="lastBooking"
            type="time"
            defaultValue={service.lastBookingMinute === null ? '' : minutesToTime(service.lastBookingMinute)}
            hint={
              service.lastBookingMinute === null
                ? `Vacío: ${minutesToTime(effectiveLastBooking(service.startMinute, service.endMinute, null))}`
                : undefined
            }
          />
          <FormSelect
            id={`interval-${service.id}`}
            label="Horas de reserva"
            name="slotInterval"
            defaultValue={String(service.slotIntervalMin)}
            options={SLOT_INTERVAL_OPTIONS}
          />
        </ActionForm>
      </div>
      <form action={deleteService}>
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="serviceId" value={service.id} />
        <button
          type="submit"
          aria-label={`Quitar ${service.name}${day}`}
          className="px-2 py-3 text-sm font-bold text-red-700 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          Quitar
        </button>
      </form>
    </li>
  );
}
