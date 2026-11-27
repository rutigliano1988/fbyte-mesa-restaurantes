import { ActionForm, FormCheckbox, FormField, FormSelect } from '@/components/forms/ActionForm';
import { ConfirmDeleteForm } from '@/components/menu/ConfirmDeleteForm';
import { createTable, createZone, deleteTable, deleteZone, updateTable, updateZone } from '@/lib/actions/booking-settings';
import type { BookingTable } from '@/lib/reservations/availability';
import type { ZoneRow } from '@/lib/reservations/rows';

export function ZoneEditor({ restaurantId, zone, tableCount, readOnly }: { restaurantId: string; zone: ZoneRow; tableCount: number; readOnly: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-b border-ink/10 py-3">
      <ActionForm action={updateZone} hidden={{ restaurantId, zoneId: zone.id }} inline readOnly={readOnly} submitLabel="Guardar">
        <FormField id={`zone-name-${zone.id}`} label="Zona" name="name" defaultValue={zone.name} maxLength={40} required />
        <FormField id={`zone-pos-${zone.id}`} label="Orden" name="position" type="number" min={0} max={999} defaultValue={String(zone.position)} />
      </ActionForm>
      {!readOnly &&
        (tableCount > 0 ? (
          <p className="text-sm text-muted">
            {tableCount === 1 ? '1 mesa' : `${tableCount} mesas`}. Para borrar la zona, pásalas antes a otra zona o bórralas.
          </p>
        ) : (
          <ConfirmDeleteForm action={deleteZone} hidden={{ restaurantId, zoneId: zone.id }} confirmLabel={`Sí, borrar la zona «${zone.name}»`} submitLabel={`Borrar la zona ${zone.name}`} />
        ))}
    </li>
  );
}

export function NewZoneForm({ restaurantId }: { restaurantId: string }) {
  return (
    <ActionForm action={createZone} hidden={{ restaurantId }} inline submitLabel="Añadir zona" pendingLabel="Añadiendo…">
      <FormField id="new-zone-name" label="Nueva zona" name="name" maxLength={40} placeholder="Terraza" required />
      <FormField id="new-zone-pos" label="Orden" name="position" type="number" min={0} max={999} defaultValue="0" />
    </ActionForm>
  );
}

function TableFields({ prefix, zones, table }: { prefix: string; zones: ZoneRow[]; table?: BookingTable }) {
  return (
    <>
      {zones.length > 0 ? (
        <FormSelect
          id={`${prefix}-zone`}
          label="Zona"
          name="zoneId"
          defaultValue={table?.zoneId ?? zones[0].id}
          options={zones.map((z) => ({ value: z.id, label: z.name }))}
        />
      ) : (
        <input type="hidden" name="zoneId" value="" />
      )}
      <FormField id={`${prefix}-name`} label="Mesa" name="name" defaultValue={table?.name} maxLength={20} placeholder="T4" required />
      <FormField id={`${prefix}-min`} label="Mín. personas" name="minCapacity" type="number" min={1} max={50} defaultValue={String(table?.minCapacity ?? 1)} required />
      <FormField id={`${prefix}-max`} label="Máx. personas" name="maxCapacity" type="number" min={1} max={50} defaultValue={String(table?.maxCapacity ?? 4)} required />
      <FormField id={`${prefix}-pos`} label="Orden" name="position" type="number" min={0} max={999} defaultValue={String(table?.position ?? 0)} />
      <FormCheckbox name="onlineBookable" label="Se puede reservar online" defaultChecked={table?.onlineBookable ?? true} />
      <FormCheckbox name="active" label="Activa" defaultChecked={table?.active ?? true} />
    </>
  );
}

export function TableEditor({ restaurantId, zones, table, readOnly }: { restaurantId: string; zones: ZoneRow[]; table: BookingTable; readOnly: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-b border-ink/10 py-3">
      <ActionForm action={updateTable} hidden={{ restaurantId, tableId: table.id }} inline readOnly={readOnly} submitLabel="Guardar">
        <TableFields prefix={`table-${table.id}`} zones={zones} table={table} />
      </ActionForm>
      {!readOnly && (
        <details>
          <summary className="cursor-pointer text-sm font-bold text-red-700 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy">Borrar la mesa {table.name}</summary>
          <div className="mt-2">
            <ConfirmDeleteForm
              action={deleteTable}
              hidden={{ restaurantId, tableId: table.id }}
              confirmLabel={`Sí, borrar la mesa ${table.name}. Si tiene reservas por delante, desactívala en su lugar.`}
              submitLabel={`Borrar la mesa ${table.name}`}
            />
          </div>
        </details>
      )}
    </li>
  );
}

export function NewTableForm({ restaurantId, zones }: { restaurantId: string; zones: ZoneRow[] }) {
  return (
    <ActionForm action={createTable} hidden={{ restaurantId }} inline submitLabel="Añadir mesa" pendingLabel="Añadiendo…">
      <TableFields prefix="new-table" zones={zones} />
      {zones.length === 0 && <p className="basis-full text-sm text-muted">Como aún no tienes zonas, la pondremos en «Sala».</p>}
    </ActionForm>
  );
}
