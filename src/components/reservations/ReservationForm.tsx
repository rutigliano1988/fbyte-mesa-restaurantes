'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ActionForm, FormField, FormSelect, FormTextArea, useActionForm } from '@/components/forms/ActionForm';
import { CustomerWarnings } from '@/components/reservations/CustomerWarnings';
import { RefreshOnError } from '@/components/reservations/RefreshOnError';
import { TableCheckboxes } from '@/components/reservations/TableCheckboxes';
import { createPhoneReservation, lookupCustomer, updateReservation, type CustomerLookup } from '@/lib/actions/reservations';
import { freeTables, getAvailableSlots, proposeTable, type BlockSpan, type BookingTable, type Occupancy } from '@/lib/reservations/availability';
import type { CustomerWarning } from '@/lib/reservations/customers';
import { keepsStart, resolveMinute, type DayService } from '@/lib/reservations/day';
import { lookupNotice, submitLabel, syncedDate } from '@/lib/reservations/form';
import { DURATION_OPTIONS, durationFor, formatDuration, type BookingSettings } from '@/lib/reservations/settings';
import { serviceDayMinute, zonedTimeToUtc } from '@/lib/reservations/time';
import type { TableMode } from '@/lib/reservations/validation';
import { minutesToTime, timeToMinutes } from '@/lib/schedule';

export type ReservationFormInitial = {
  time: string;
  partySize: number;
  durationMin: number | null;
  tableMode: TableMode;
  tableIds: string[];
  notes: string;
  internalNotes: string;
  /** Al cambiar una reserva: su día de servicio y su instante (mientras no cambien fecha ni hora, se usa este). */
  start?: { date: string; ms: number };
};

type Props = {
  mode: 'create' | 'edit';
  restaurantId: string;
  reservationId?: string;
  /** La fecha de los datos que trae la página (servicios, ocupación y bloqueos). */
  date: string;
  /** URL de la página, para volver a pedir los datos al cambiar de fecha. */
  path: string;
  timeZone: string;
  services: DayService[];
  tables: BookingTable[];
  occupancy: Occupancy[];
  blocks: BlockSpan[];
  settings: Pick<BookingSettings, 'defaultDurationMin' | 'durationRules'>;
  initial: ReservationFormInitial;
};

const smallChip =
  'rounded-[6px] border-2 px-2.5 py-1 text-sm font-bold tabular-nums focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy';

/**
 * Nueva reserva por teléfono o cambio de una reserva. Calcula al momento (módulo puro) las horas con hueco y la
 * mesa más pequeña que sirve; la BD lo vuelve a comprobar al guardar. Si no hay hueco, ofrece guardarla sin mesa.
 */
export function ReservationForm(props: Props) {
  const { mode, restaurantId, timeZone, services, tables, occupancy, blocks, settings, initial } = props;
  const router = useRouter();
  const [date, setDate] = useState(props.date);
  // Si la página trae otra fecha (atrás, un enlace), el formulario la sigue.
  const [seenDate, setSeenDate] = useState(props.date);
  if (props.date !== seenDate) {
    setSeenDate(props.date);
    setDate(syncedDate(date, seenDate, props.date));
  }
  const [time, setTime] = useState(initial.time);
  const [party, setParty] = useState(String(initial.partySize));
  const [duration, setDuration] = useState(initial.durationMin === null ? '' : String(initial.durationMin));
  const [tableMode, setTableMode] = useState<TableMode>(initial.tableMode);
  const [tableIds, setTableIds] = useState<string[]>(initial.tableIds);
  const [name, setName] = useState('');
  const [lookup, setLookup] = useState<{ text: string; warnings: CustomerWarning[] }>({ text: '', warnings: [] });
  const [looking, startLookup] = useTransition();
  // Búsqueda del cliente: una por teléfono (no se repite al salir otra vez del campo) y solo vale la última.
  const lookupSeq = useRef(0);
  const lookedUp = useRef('');

  const partySize = /^\d+$/.test(party) ? Number(party) : 0;
  const rawMinute = timeToMinutes(time);
  const ready = date === props.date && partySize >= 1 && partySize <= 50 && rawMinute !== null;
  const autoDuration = durationFor(Math.max(partySize, 1), settings);
  const durationMin = duration === '' ? autoDuration : Number(duration);
  const ignore = props.reservationId;
  let proposal: BookingTable | null = null;
  let free: BookingTable[] = [];
  // Sin cambiar fecha ni hora, el instante real de la reserva (como en el servidor); si no, el de la hora escrita.
  const keptMs = rawMinute !== null && initial.start && keepsStart(initial.start.ms, initial.start.date, date, rawMinute, timeZone) ? initial.start.ms : null;
  const minute = rawMinute === null ? null : keptMs !== null ? (serviceDayMinute(keptMs, date, timeZone) ?? rawMinute) : resolveMinute(rawMinute, services);
  if (ready && minute !== null) {
    const startMs = keptMs ?? zonedTimeToUtc(date, minute, timeZone);
    const endMs = startMs + durationMin * 60_000;
    proposal = proposeTable(tables, partySize, startMs, endMs, occupancy, blocks, { ignoreReservationId: ignore });
    free = freeTables(tables, startMs, endMs, occupancy, blocks, ignore);
  }
  const slots = ready
    ? getAvailableSlots({ date, timeZone, services, partySize, durationMin, tables, occupancy, blocks, ignoreReservationId: ignore })
    : [];
  const noRoom = ready && tableMode === 'auto' && !proposal;
  const sentMode: TableMode = noRoom ? 'none' : tableMode;
  const currentNames = tables.filter((t) => initial.tableIds.includes(t.id)).map((t) => t.name);
  const durationOptions = [...new Set([...DURATION_OPTIONS, ...(initial.durationMin ? [initial.durationMin] : [])])].sort((a, b) => a - b);

  function changeDate(value: string) {
    setDate(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value !== props.date) {
      router.replace(`${props.path}?${new URLSearchParams({ fecha: value }).toString()}`, { scroll: false });
    }
  }

  function findCustomer(phone: string) {
    if (mode !== 'create') return;
    const value = phone.trim();
    if (value.length < 6) {
      // Teléfono borrado: fuera el aviso del cliente anterior.
      if (lookedUp.current) {
        lookedUp.current = '';
        lookupSeq.current += 1;
        setLookup({ text: '', warnings: [] });
      }
      return;
    }
    if (value === lookedUp.current) return;
    lookedUp.current = value;
    const seq = ++lookupSeq.current;
    startLookup(async () => {
      let result: CustomerLookup | null;
      try {
        result = await lookupCustomer(restaurantId, value);
      } catch {
        result = null;
      }
      if (seq !== lookupSeq.current) return;
      // Si falla, no se rellena nada y se puede volver a buscar; la reserva se guarda igual.
      if (!result || result.error) lookedUp.current = '';
      const found = result?.customer;
      if (found) setName((current) => (current.trim() === '' ? found.name : current));
      setLookup(lookupNotice(result));
    });
  }

  const modes: { value: TableMode; label: string }[] = [
    ...(mode === 'edit' && initial.tableIds.length > 0 ? [{ value: 'keep' as const, label: `Dejar ${currentNames.join(' + ')}` }] : []),
    { value: 'auto', label: ready ? (proposal ? `La que proponemos: ${proposal.name} (${proposal.zoneName}, ${proposal.minCapacity}–${proposal.maxCapacity})` : 'La que proponemos: no queda ninguna libre') : 'La que proponemos' },
    { value: 'manual', label: 'Elegir una o varias a mano' },
    { value: 'none', label: 'Sin mesa (forzar)' },
  ];

  return (
    <ActionForm
      action={mode === 'create' ? createPhoneReservation : updateReservation}
      hidden={{ restaurantId, ...(props.reservationId ? { reservationId: props.reservationId } : {}) }}
      submitLabel={submitLabel(mode, noRoom, tableMode)}
    >
      <RefreshOnError />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Personas" name="partySize" type="number" inputMode="numeric" min={1} max={50} value={party} onChange={(e) => setParty(e.target.value)} required />
        <FormField label="Fecha" name="date" type="date" value={date} onChange={(e) => changeDate(e.target.value)} required />
        <FormField label="Hora" name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>

      <p className="text-sm text-muted empty:hidden" role="status">
        {date !== props.date ? 'Cargando los huecos de ese día…' : ''}
      </p>
      {date !== props.date ? null : services.length === 0 ? (
        <p className="text-sm text-muted">Ese día no hay servicios en el horario: escribe la hora a mano.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {services.map((s) => {
            const own = slots.filter((x) => x.serviceKey === s.key);
            return (
              <div key={s.key} className="flex flex-col gap-1.5">
                <p className="text-sm font-bold">
                  {s.name} <span className="font-normal text-muted">· toca una hora (en gris, sin mesa libre para {partySize || '…'})</span>
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {own.map((x) => {
                    const label = minutesToTime(x.minute);
                    const selected = minute === x.minute;
                    return (
                      <li key={x.minute}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setTime(label)}
                          className={
                            smallChip +
                            (selected ? ' border-ink bg-ink text-white' : x.table ? ' border-navy bg-white text-navy' : ' border-ink/15 bg-paper text-muted')
                          }
                        >
                          {label}
                          <span className="sr-only">{`, ${s.name}, ${x.table ? 'con mesa libre' : 'sin mesa libre'}`}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <FormSelect
        label="Duración"
        name="duration"
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        options={[{ value: '', label: `La de su tamaño de grupo (${formatDuration(autoDuration)})` }, ...durationOptions.map((m) => ({ value: String(m), label: formatDuration(m) }))]}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">Mesa</legend>
        {modes.map((m) => (
          <label key={m.value} className="flex items-start gap-2">
            <input type="radio" name="tableModeChoice" value={m.value} checked={tableMode === m.value} onChange={() => setTableMode(m.value)} className="mt-1 size-4 accent-navy" />
            <span>{m.label}</span>
          </label>
        ))}
        <input type="hidden" name="tableMode" value={sentMode} />
        {tableMode === 'keep' && initial.tableIds.map((id) => <input key={id} type="hidden" name="tableIds" value={id} />)}
      </fieldset>
      {/* Región siempre montada: el aviso se anuncia al aparecer. */}
      <div role="status" className="empty:hidden">
        {noRoom && (
          <p className="rounded-[6px] border-2 border-ink bg-peach-soft px-4 py-3 text-sm font-medium text-ink">
            No hay hueco: ninguna mesa libre para {partySize} a las {time}. Puedes elegir mesas a mano, cambiar la hora o guardarla sin mesa (saldrá en «Sin mesa
            asignada»).
          </p>
        )}
      </div>
      {tableMode === 'manual' && <ManualTables free={free} all={tables} selected={tableIds} onChange={setTableIds} partySize={partySize} />}

      {mode === 'create' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Teléfono"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            hint="Sin prefijo es de España; si es de fuera, empieza por + y el prefijo."
            onBlur={(e) => findCustomer(e.target.value)}
            required
          />
          <FormField label="Nombre" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
          <FormField label="Email (opcional)" name="email" type="email" autoComplete="off" />
        </div>
      )}
      {mode === 'create' && (
        <div aria-live="polite" aria-busy={looking} className="flex flex-col gap-1 text-sm">
          {lookup.text && <p>{lookup.text}</p>}
          <CustomerWarnings warnings={lookup.warnings} />
        </div>
      )}

      <FormTextArea label="Notas del cliente (opcional)" name="notes" defaultValue={initial.notes} maxLength={500} rows={2} />
      <FormTextArea label="Nota interna (opcional, solo la ve el equipo)" name="internalNotes" defaultValue={initial.internalNotes} maxLength={500} rows={2} />
    </ActionForm>
  );
}

function ManualTables(props: { free: BookingTable[]; all: BookingTable[]; selected: string[]; onChange: (ids: string[]) => void; partySize: number }) {
  const { state } = useActionForm();
  return <TableCheckboxes legend="Mesas" {...props} error={state.fieldErrors?.tableIds} />;
}
