'use client';

import { useState } from 'react';
import { ActionForm, FormField, useActionForm } from '@/components/forms/ActionForm';
import { TableCheckboxes } from '@/components/reservations/TableCheckboxes';
import { createWalkIn } from '@/lib/actions/reservations';
import { freeTables, proposeTable, type BlockSpan, type BookingTable, type Occupancy } from '@/lib/reservations/availability';
import { durationFor, formatDuration, type BookingSettings } from '@/lib/reservations/settings';

/** Walk-in en un clic: personas, mesa libre ahora (la propuesta ya marcada) y nombre si lo dan. */
export function WalkInForm({
  restaurantId,
  nowMs,
  tables,
  occupancy,
  blocks,
  settings,
}: {
  restaurantId: string;
  /** La hora de la página: el servidor la manda para que todos los cálculos usen la misma. */
  nowMs: number;
  tables: BookingTable[];
  occupancy: Occupancy[];
  blocks: BlockSpan[];
  settings: Pick<BookingSettings, 'defaultDurationMin' | 'durationRules'>;
}) {
  const [party, setParty] = useState('2');
  const [picked, setPicked] = useState<string[] | null>(null);
  const partySize = /^\d+$/.test(party) ? Number(party) : 0;
  const duration = durationFor(Math.max(partySize, 1), settings);
  const endMs = nowMs + duration * 60_000;
  const free = freeTables(tables, nowMs, endMs, occupancy, blocks);
  const proposal = partySize > 0 ? proposeTable(tables, partySize, nowMs, endMs, occupancy, blocks) : null;
  const selected = picked ?? (proposal ? [proposal.id] : []);

  return (
    <ActionForm action={createWalkIn} hidden={{ restaurantId }} submitLabel="Sentar ahora" pendingLabel="Sentando…">
      <FormField
        label="Personas"
        name="partySize"
        type="number"
        inputMode="numeric"
        min={1}
        max={50}
        value={party}
        onChange={(e) => setParty(e.target.value)}
        hint={`Ocupan la mesa unos ${formatDuration(duration)}.`}
        required
      />
      <WalkInTables free={free} all={tables} selected={selected} onChange={setPicked} partySize={partySize} />
      <FormField label="Nombre (opcional)" name="name" maxLength={120} autoComplete="off" />
    </ActionForm>
  );
}

function WalkInTables(props: { free: BookingTable[]; all: BookingTable[]; selected: string[]; onChange: (ids: string[]) => void; partySize: number }) {
  const { state } = useActionForm();
  return <TableCheckboxes legend="Mesa (libres ahora; ya marcamos la más pequeña que sirve)" {...props} error={state.fieldErrors?.tableIds} />;
}
