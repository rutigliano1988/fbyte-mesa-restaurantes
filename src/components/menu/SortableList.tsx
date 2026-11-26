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
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { Notice } from '@/components/ui/Notice';
import { reorderMenuEntries, type ReorderEntity } from '@/lib/actions/menu';
import { DRAG_INSTRUCTIONS, dragAnnouncements, dropId, GENERIC_ERROR, moveAnnouncement, moveId } from '@/lib/menu/sortable';

export type SortableEntry = { id: string; label: string; content: ReactNode };

type Direction = 'up' | 'down';

const smallButton =
  'rounded-[6px] px-2 py-1 text-xs font-bold text-navy hover:bg-peach-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ' +
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Lista que se ordena arrastrando (ratón, dedo o teclado) o con «Subir»/«Bajar». Guarda el orden completo;
 * si falla, vuelve al último orden confirmado por el servidor y lo dice.
 */
export function SortableList({
  restaurantId,
  entity,
  parentId,
  entries,
  readOnly = false,
  label,
}: {
  restaurantId: string;
  entity: ReorderEntity;
  parentId: string;
  entries: SortableEntry[];
  readOnly?: boolean;
  label?: string;
}) {
  const serverOrder = entries.map((e) => e.id);
  const serverKey = serverOrder.join(',');
  const [order, setOrder] = useState(serverOrder);
  const [confirmed, setConfirmed] = useState(serverOrder);
  const [seenKey, setSeenKey] = useState(serverKey);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pending, startTransition] = useTransition();
  const confirmedRef = useRef(confirmed);
  const busyRef = useRef(false);
  const buttons = useRef(new Map<string, Record<Direction, HTMLButtonElement | null>>());
  const focusRequest = useRef<{ id: string; dir: Direction } | null>(null);
  // Si el servidor trae otra lista (se ha añadido o borrado algo), se empieza de nuevo desde ella.
  if (seenKey !== serverKey) {
    setSeenKey(serverKey);
    setOrder(serverOrder);
    setConfirmed(serverOrder);
  }
  useEffect(() => {
    confirmedRef.current = confirmed;
  }, [confirmed]);

  // Al moverse, el <li> cambia de sitio en el DOM y el navegador suelta el foco: lo devolvemos al botón que se pulsó.
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    const index = order.indexOf(request.id);
    const pair = buttons.current.get(request.id);
    if (index < 0 || !pair) return;
    const atEdge = request.dir === 'up' ? index === 0 : index === order.length - 1;
    (atEdge ? pair[request.dir === 'up' ? 'down' : 'up'] : pair[request.dir])?.focus();
  }, [order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(entries.map((e) => [e.id, e]));
  const nameOf = (id: string) => byId.get(id)?.label ?? '';

  function save(next: string[] | null, moved?: { id: string; dir: Direction }) {
    if (!next || busyRef.current) return;
    busyRef.current = true;
    setOrder(next);
    setError(null);
    if (moved) focusRequest.current = moved;
    startTransition(async () => {
      let failure: string | null = null;
      try {
        const result = await reorderMenuEntries(restaurantId, entity, parentId, next);
        if (result.error) failure = result.error;
      } catch {
        failure = GENERIC_ERROR;
      }
      busyRef.current = false;
      if (failure) {
        if (moved) focusRequest.current = moved;
        setOrder(confirmedRef.current);
        setError(failure);
      } else {
        setConfirmed(next);
        if (moved) setAnnouncement(moveAnnouncement(nameOf(moved.id), next.indexOf(moved.id) + 1, next.length));
      }
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over) save(dropId(order, String(active.id), String(over.id)));
  }

  function register(id: string, dir: Direction, el: HTMLButtonElement | null) {
    const pair = buttons.current.get(id) ?? { up: null, down: null };
    pair[dir] = el;
    buttons.current.set(id, pair);
  }

  return (
    <div className="flex flex-col gap-3">
      <DndContext
        id={`orden-${entity}-${parentId}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements: dragAnnouncements(nameOf, order), screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul aria-label={label} className="flex flex-col gap-3">
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
                  dragDisabled={readOnly || pending}
                  register={register}
                  onMove={(dir) => save(moveId(order, id, dir === 'up' ? -1 : 1), { id, dir })}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function SortableRow({
  entry,
  first,
  last,
  readOnly,
  dragDisabled,
  register,
  onMove,
}: {
  entry: SortableEntry;
  first: boolean;
  last: boolean;
  readOnly: boolean;
  dragDisabled: boolean;
  register: (id: string, dir: Direction, el: HTMLButtonElement | null) => void;
  onMove: (dir: Direction) => void;
}) {
  const reducedMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    disabled: dragDisabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: reducedMotion ? undefined : transition }}
      className={`flex items-start gap-2 rounded-[6px] bg-white ${isDragging ? 'relative z-10 shadow-hard' : ''}`}
    >
      {!readOnly && (
        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-roledescription={undefined}
            aria-label={`Arrastrar «${entry.label}» para cambiar su orden`}
            className={`cursor-grab touch-none text-lg leading-none text-muted ${smallButton}`}
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <button
            type="button"
            ref={(el) => register(entry.id, 'up', el)}
            onClick={() => !first && onMove('up')}
            aria-disabled={first}
            aria-label={`Subir «${entry.label}»`}
            className={smallButton}
          >
            Subir
          </button>
          <button
            type="button"
            ref={(el) => register(entry.id, 'down', el)}
            onClick={() => !last && onMove('down')}
            aria-disabled={last}
            aria-label={`Bajar «${entry.label}»`}
            className={smallButton}
          >
            Bajar
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1">{entry.content}</div>
    </li>
  );
}
