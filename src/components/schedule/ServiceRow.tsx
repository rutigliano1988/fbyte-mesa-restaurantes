import { ActionForm, FormField } from '@/components/forms/ActionForm';
import { deleteService, updateService } from '@/lib/actions/schedule';
import { formatRange, minutesToTime, type ServiceSlot } from '@/lib/schedule';

export function ServiceRow({
  restaurantId,
  service,
  readOnly,
}: {
  restaurantId: string;
  service: ServiceSlot & { id: string };
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <li className="py-1">
        <strong>{service.name}</strong> · {formatRange(service.startMinute, service.endMinute)}
      </li>
    );
  }
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
        </ActionForm>
      </div>
      <form action={deleteService}>
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="serviceId" value={service.id} />
        <button type="submit" className="px-2 py-3 text-sm font-bold text-red-700 hover:underline">
          Quitar
        </button>
      </form>
    </li>
  );
}
