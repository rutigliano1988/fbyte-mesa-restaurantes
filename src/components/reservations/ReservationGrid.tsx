'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { BlockSpan, BookingTable } from '@/lib/reservations/availability';
import { STATUS_LABELS_ES } from '@/lib/reservations/codes';
import {
  focusTarget,
  freeCellLabel,
  gridTimeText,
  moveFocus,
  reservationBarLabel,
  reservationBarText,
  type GridLayout,
  type GridPos,
  type GridReservation,
  type GridSegment,
} from '@/lib/reservations/grid';
import { formatTime } from '@/lib/reservations/time';
import { minutesToTime } from '@/lib/schedule';

const BAR = {
  pending: 'border-dashed border-orange-dark bg-peach-soft text-ink',
  confirmed: 'border-navy bg-on-navy-soft text-navy-dark',
  seated: 'border-ink bg-ink text-white',
} as const satisfies Partial<Record<GridReservation['status'], string>>;
const barClass = (status: GridReservation['status']) => (Object.hasOwn(BAR, status) ? BAR[status as keyof typeof BAR] : '');
const STRIPES: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(10,19,48,0.18) 0 6px, transparent 6px 12px)',
};
const focusRing = 'focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-navy';

/**
 * Cuadrícula mesas × horas de un servicio (filas = mesas por zona, columnas = cada 15 min). Un solo punto de
 * tabulación (role="grid"): con las flechas se va de tramo en tramo; Intro abre la reserva o una nueva en el hueco.
 * En el móvil se desplaza en horizontal; la columna de las mesas se queda fija.
 *
 * Las cabeceras salen de `layout.columns` (la noche del adelanto de hora hay menos columnas que horas). Un mismo
 * bloqueo o reserva puede partirse en varios tramos de una fila: las claves y las referencias son fila:columna.
 */
export function ReservationGrid({
  restaurantId,
  date,
  timeZone,
  layout,
  tables,
  reservations,
  blocks,
  readOnly,
  label,
}: {
  restaurantId: string;
  date: string;
  timeZone: string;
  layout: GridLayout;
  tables: BookingTable[];
  reservations: GridReservation[];
  blocks: BlockSpan[];
  readOnly: boolean;
  label: string;
}) {
  const [pos, setPos] = useState<GridPos>({ row: 0, col: 0 });
  const refs = useRef(new Map<string, HTMLElement>());
  const hadFocus = useRef(false);
  const moved = useRef(false);
  const n = layout.columns.length;
  const template: CSSProperties = { gridTemplateColumns: `7.5rem repeat(${n}, minmax(2.75rem, 1fr))` };
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const resById = new Map(reservations.map((r) => [r.id, r]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  // La celda con el foco (la columna de inicio del tramo; la posición se ajusta si la cuadrícula ha cambiado).
  const target = focusTarget(layout, pos);
  const targetKey = target ? `${target.row}:${target.col}` : null;
  const range = (startMs: number, endMs: number) => `${formatTime(startMs, timeZone)}–${formatTime(endMs, timeZone)}`;

  useEffect(() => {
    if (!moved.current || !targetKey) return;
    moved.current = false;
    refs.current.get(targetKey)?.focus();
  }, [targetKey]);

  // Si un cambio en tiempo real desmonta la celda con el foco, el foco cae en <body>: se devuelve a la celda objetivo.
  useEffect(() => {
    if (!hadFocus.current || !targetKey) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    refs.current.get(targetKey)?.focus();
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = moveFocus(layout, pos, e.key);
    if (!next) return;
    e.preventDefault();
    const nextTarget = focusTarget(layout, next);
    moved.current = nextTarget !== null && `${nextTarget.row}:${nextTarget.col}` !== targetKey;
    setPos(next);
  }

  function cell(rowIndex: number, seg: GridSegment) {
    const row = layout.rows[rowIndex];
    const table = tableById.get(row.tableId);
    const tableName = table?.name ?? 'Mesa';
    const key = `${rowIndex}:${seg.col}`;
    const isFocus = key === targetKey;
    const common = {
      ref: (el: HTMLElement | null) => {
        if (el) refs.current.set(key, el);
        else refs.current.delete(key);
      },
      tabIndex: isFocus ? 0 : -1,
      // Al volver a la celda que ya tenía el foco se conserva la columna (para seguir bajando por la misma hora).
      onFocus: () => setPos((p) => (isFocus ? { row: rowIndex, col: p.col } : { row: rowIndex, col: seg.col })),
    };
    const place: CSSProperties = { gridColumn: `${seg.col + 2} / span ${seg.span}` };

    if (seg.kind === 'free') {
      if (readOnly || !seg.bookable) {
        // Modo soporte o mesa desactivada: el hueco se ve y se recorre con el teclado, pero no abre una reserva.
        const text = seg.bookable ? `${tableName}, ${gridTimeText(seg.minute)}, libre` : `${tableName} desactivada, ${gridTimeText(seg.minute)}`;
        return (
          <div key={key} {...common} role="gridcell" aria-label={text} style={place} className={`h-12 border-l border-ink/10 ${focusRing}`} />
        );
      }
      const text = freeCellLabel(tableName, seg.minute);
      return (
        <div key={key} role="gridcell" style={place} className="border-l border-ink/10 p-0.5">
          <Link
            {...common}
            href={`/panel/${restaurantId}/reservas/nueva?${new URLSearchParams({ fecha: date, hora: minutesToTime(seg.minute), mesa: row.tableId }).toString()}`}
            aria-label={text}
            title={text}
            className={`flex h-11 items-center justify-center rounded-[4px] text-transparent hover:bg-peach-soft hover:text-ink focus-visible:text-ink ${focusRing}`}
          >
            <span aria-hidden="true">+</span>
          </Link>
        </div>
      );
    }
    if (seg.kind === 'reservation') {
      const r = resById.get(seg.reservationId);
      if (!r) return null;
      // «Pend.» se ve además del color y del borde discontinuo; el nombre accesible empieza por el texto visible.
      const prefix = r.status === 'pending' ? 'Pend. ' : '';
      const text = prefix + reservationBarLabel(r, tableName, range(r.startMs, r.endMs));
      return (
        <div key={key} role="gridcell" aria-colspan={seg.span} style={place} className="p-0.5">
          <Link
            {...common}
            href={`/panel/${restaurantId}/reservas/${r.id}`}
            aria-label={text}
            title={text}
            className={`block h-11 truncate rounded-[4px] border-2 px-2 text-sm leading-10 font-bold ${barClass(r.status)} ${focusRing}`}
          >
            {prefix + reservationBarText(r)}
          </Link>
        </div>
      );
    }
    const b = blockById.get(seg.blockId);
    const visible = b?.reason ? `Bloqueada: ${b.reason}` : 'Bloqueada';
    const text = `${visible}, ${tableName}${b ? `, ${range(b.startMs, b.endMs)}` : ''}`;
    return (
      <div
        key={key}
        {...common}
        role="gridcell"
        aria-colspan={seg.span}
        aria-label={text}
        title={text}
        style={{ ...place, ...STRIPES }}
        className={`m-0.5 h-11 truncate rounded-[4px] border-2 border-ink/20 px-2 text-xs leading-10 font-bold text-muted ${focusRing}`}
      >
        {visible}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="scroll-pl-[7.5rem] overflow-x-auto rounded-[6px] border-2 border-ink/10 bg-white">
        <div role="grid" onFocus={() => (hadFocus.current = true)} onBlur={(e) => { if (!(e.target instanceof Node) || e.target.isConnected) hadFocus.current = false; }} aria-label={label} aria-rowcount={layout.rows.length + 1} aria-colcount={n + 1} onKeyDown={onKeyDown} className="min-w-max">
          <div role="row" style={template} className="grid border-b-2 border-ink/10 text-xs font-bold text-muted">
            <div role="columnheader" className="sticky left-0 z-10 bg-white px-2 py-2">
              Mesa
            </div>
            {layout.columns.map((m) => (
              <div key={m} role="columnheader" className="border-l border-ink/10 px-1 py-2 tabular-nums">
                {m % 60 === 0 ? minutesToTime(m) : <span className="sr-only">{minutesToTime(m)}</span>}
              </div>
            ))}
          </div>
          {layout.rows.map((row, i) => {
            const table = tableById.get(row.tableId);
            return (
              <div key={row.tableId} role="row" style={template} className="grid border-b border-ink/10">
                <div role="rowheader" className="sticky left-0 z-10 flex flex-col justify-center bg-white px-2 py-1">
                  <span className="font-bold">{table?.name}</span>
                  <span className="text-xs text-muted">
                    {table?.zoneName} · {table?.minCapacity}–{table?.maxCapacity}
                    {table && !table.active && ' · desactivada'}
                  </span>
                </div>
                {row.segments.map((seg) => cell(i, seg))}
              </div>
            );
          })}
        </div>
      </div>
      {/* El estado se ve con color y también con texto. */}
      <ul aria-label="Leyenda" className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-muted">
        {(Object.keys(BAR) as (keyof typeof BAR)[]).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block h-3 w-5 rounded-[3px] border-2 ${BAR[status]}`} />
            {STATUS_LABELS_ES[status]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" style={STRIPES} className="inline-block h-3 w-5 rounded-[3px] border-2 border-ink/20" />
          Bloqueada
        </li>
      </ul>
    </div>
  );
}
