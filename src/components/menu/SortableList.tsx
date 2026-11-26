'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useTransition, type ReactNode } from 'react';
import { Notice } from '@/components/ui/Notice';
import { reorderMenuEntries, type ReorderEntity } from '@/lib/actions/menu';
import { DRAG_INSTRUCTIONS, dragAnnouncements, dropId, moveId } from '@/lib/menu/sortable';

export type SortableEntry = { id: string; label: string; content: ReactNode };

const smallButton =
  'rounded-[6px] px-2 py-1 text-xs font-bold text-navy hover:bg-peach-soft disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy';

/**
 * Lista que se ordena arrastrando (ratón, dedo o teclado) o con «Subir»/«Bajar». Guarda el orden completo;
 * si falla, vuelve al orden anterior y lo dice.
 */
export function SortableList({
  restaurantId,
  entity,
  parentId,
  entries,
  readOnly = false,
}: {
  restaurantId: string;
  entity: ReorderEntity;
  parentId: string;
  entries: SortableEntry[];
  readOnly?: boolean;
}) {
  const serverOrder = entries.map((e) => e.id);
  const serverKey = serverOrder.join(',');
  const [order, setOrder] = useState(serverOrder);
  const [seenKey, setSeenKey] = useState(serverKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Si el servidor trae otra lista (se ha añadido o borrado algo), se empieza de nuevo desde ella.
  if (seenKey !== serverKey) {
    setSeenKey(serverKey);
    setOrder(serverOrder);
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(entries.map((e) => [e.id, e]));
  const label = (id: string) => byId.get(id)?.label ?? '';

  function save(next: string[] | null) {
    if (!next) return;
    const previous = order;
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderMenuEntries(restaurantId, entity, parentId, next);
      if (result.error) {
        setOrder(previous);
        setError(result.error);
      }
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over) save(dropId(order, String(active.id), String(over.id)));
  }

  return (
    <div className="flex flex-col gap-3">
      <DndContext
        id={`orden-${entity}-${parentId}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements: dragAnnouncements(label, order), screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-3">
            {order.map((id, index) => {
              const entry = byId.get(id);
              if (!entry) return null;
              return (
                <SortableRow
                  key={id}
                  entry={entry}
                  first={index === 0}
                  last={index === order.length - 1}
                  readOnly={readOnly}
                  disabled={pending}
                  onMove={(delta) => save(moveId(order, id, delta))}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function SortableRow({
  entry,
  first,
  last,
  readOnly,
  disabled,
  onMove,
}: {
  entry: SortableEntry;
  first: boolean;
  last: boolean;
  readOnly: boolean;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    disabled: readOnly,
    attributes: { roleDescription: 'elemento que se puede mover' },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 rounded-[6px] bg-white ${isDragging ? 'relative z-10 shadow-hard' : ''}`}
    >
      {!readOnly && (
        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Arrastrar «${entry.label}» para cambiar su orden`}
            className={`cursor-grab touch-none text-lg leading-none text-muted ${smallButton}`}
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <button type="button" onClick={() => onMove(-1)} disabled={disabled || first} aria-label={`Subir «${entry.label}»`} className={smallButton}>
            Subir
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={disabled || last} aria-label={`Bajar «${entry.label}»`} className={smallButton}>
            Bajar
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1">{entry.content}</div>
    </li>
  );
}
