'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, FormField, useActionForm } from '@/components/forms/ActionForm';
import { TableCheckboxes } from '@/components/reservations/TableCheckboxes';
import { RefreshOnError } from '@/components/reservations/RefreshOnError';
import { createWalkIn } from '@/lib/actions/reservations';
import { mapDbError } from '@/lib/db-errors';
import { freeTables, proposeTable, type BlockSpan, type BookingTable, type Occupancy } from '@/lib/reservations/availability';
import type { FormState } from '@/lib/forms';
import { durationFor, formatDuration, type BookingSettings } from '@/lib/reservations/settings';

const TAKEN_TEXT = 'Esa mesa se acaba de ocupar. Ya te enseñamos las que siguen libres.';
const TAKEN_CODES = ['SLOT_TAKEN', 'TABLE_BLOCKED', 'NO_TABLE_AVAILABLE', 'TABLE_INACTIVE'];
const TAKEN_MESSAGES = new Set(TAKEN_CODES.map((c) => mapDbError(c)));

/** Aquí no existe «guardar sin mesa»: si la mesa se ha ocupado, el texto remite a las libres que se recalculan. */
async function createWalkInAction(prev: FormState, fd: FormData): Promise<FormState> {
  const result = await createWalkIn(prev, fd);
  return result.error && TAKEN_MESSAGES.has(result.error) ? { ...result, error: TAKEN_TEXT } : result;
}

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
  const router = useRouter();
  // «Ahora» lo fija el servidor: al volver a la pestaña se vuelve a pedir para que no envejezca.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);
  const [party, setParty] = useState('2');
  const [picked, setPicked] = useState<string[] | null>(null);
  const partySize = /^\d+$/.test(party) ? Number(party) : 0;
  const duration = durationFor(Math.max(partySize, 1), settings);
  const endMs = nowMs + duration * 60_000;
  const free = freeTables(tables, nowMs, endMs, occupancy, blocks);
  const proposal = partySize > 0 ? proposeTable(tables, partySize, nowMs, endMs, occupancy, blocks) : null;
  const selected = picked ?? (proposal ? [proposal.id] : []);

  return (
    <ActionForm action={createWalkInAction} hidden={{ restaurantId }} submitLabel="Sentar ahora" pendingLabel="Sentando…">
      <RefreshOnError only={TAKEN_TEXT} />
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
      <WalkInTables free={free} all={tables} selected={selected} onChange={setPicked} partySize={partySize} hasProposal={proposal !== null} />
      <FormField label="Nombre (opcional)" name="name" maxLength={120} autoComplete="off" />
    </ActionForm>
  );
}

function WalkInTables(props: { free: BookingTable[]; all: BookingTable[]; selected: string[]; onChange: (ids: string[]) => void; partySize: number; hasProposal: boolean }) {
  const { state } = useActionForm();
  const { hasProposal, ...rest } = props;
  const legend = hasProposal ? 'Mesa (libres ahora; ya marcamos la más pequeña que sirve)' : 'Mesa (libres ahora)';
  return <TableCheckboxes legend={legend} emptyText="No hay ninguna mesa libre ahora." {...rest} error={state.fieldErrors?.tableIds} />;
}
