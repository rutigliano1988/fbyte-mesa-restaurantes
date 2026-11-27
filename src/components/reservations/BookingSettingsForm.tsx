import { ActionForm, FormCheckbox, FormField, FormSelect } from '@/components/forms/ActionForm';
import { saveBookingSettings } from '@/lib/actions/booking-settings';
import { DURATION_OPTIONS, formatDuration, type BookingSettings } from '@/lib/reservations/settings';
import { RULE_ROWS } from '@/lib/reservations/validation';

const durations = DURATION_OPTIONS.map((m) => ({ value: String(m), label: formatDuration(m) }));

/** Duración por defecto, tramos por tamaño de grupo y reglas de la reserva online (se aplican en el Hito 4B). */
export function BookingSettingsForm({ restaurantId, settings, readOnly }: { restaurantId: string; settings: BookingSettings; readOnly: boolean }) {
  return (
    <ActionForm action={saveBookingSettings} hidden={{ restaurantId }} readOnly={readOnly} submitLabel="Guardar ajustes">
      <FormSelect label="Duración de una reserva" name="defaultDuration" defaultValue={String(settings.defaultDurationMin)} options={durations} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold">Duración según el tamaño del grupo (opcional)</legend>
        <p className="text-sm text-muted">Deja vacías las filas que no uses. Un grupo que no entra en ningún tramo usa la duración de arriba.</p>
        {RULE_ROWS.map((n) => {
          const rule = settings.durationRules[n - 1];
          return (
            <div key={n} className="grid grid-cols-3 gap-3">
              <FormField id={`rule${n}_min`} label={`Tramo ${n}: de`} name={`rule${n}_min`} type="number" min={1} max={50} defaultValue={rule ? String(rule.minParty) : ''} />
              <FormField id={`rule${n}_max`} label="a (personas)" name={`rule${n}_max`} type="number" min={1} max={50} defaultValue={rule ? String(rule.maxParty) : ''} />
              <FormSelect
                id={`rule${n}_duration`}
                label="Duración"
                name={`rule${n}_duration`}
                defaultValue={rule ? String(rule.durationMin) : ''}
                options={[{ value: '', label: '—' }, ...durations]}
              />
            </div>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold">Reserva online</legend>
        <p className="text-sm text-muted">Las guardamos ya; se aplicarán cuando actives la reserva desde tu web.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Antelación mínima (minutos)" name="minAdvanceMin" type="number" min={0} max={10080} defaultValue={String(settings.minAdvanceMin)} />
          <FormField label="Hasta cuántos días antes" name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={String(settings.maxAdvanceDays)} />
          <FormField label="Máximo de personas online" name="maxOnlineParty" type="number" min={1} max={50} defaultValue={String(settings.maxOnlineParty)} />
          <FormField label="Cancelar hasta (horas antes)" name="cancelLimitHours" type="number" min={0} max={168} defaultValue={String(settings.cancelLimitHours)} />
        </div>
        <FormCheckbox name="autoConfirm" label="Confirmar las reservas online sin revisarlas" defaultChecked={settings.autoConfirm} />
      </fieldset>
    </ActionForm>
  );
}
