import type { Announcements } from '@dnd-kit/core';

/** Sube (-1) o baja (+1) un elemento un puesto. null si no se puede. */
export function moveId(order: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Arrastrar y soltar: lleva activeId al sitio de overId. null si no cambia nada. */
export function dropId(order: readonly string[], activeId: string, overId: string): string[] | null {
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export const DRAG_INSTRUCTIONS =
  'Para mover, pulsa la barra espaciadora o Intro, usa las flechas y vuelve a pulsar para soltar. Escape cancela.';

/** Lo que oye quien usa un lector de pantalla mientras arrastra con el teclado. */
export function dragAnnouncements(label: (id: string) => string, order: readonly string[]): Announcements {
  const position = (id: string) => order.indexOf(id) + 1;
  const total = order.length;
  return {
    onDragStart: ({ active }) => `Has cogido «${label(String(active.id))}». Está en la posición ${position(String(active.id))} de ${total}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `«${label(String(active.id))}» pasaría a la posición ${position(String(over.id))} de ${total}.`
        : `«${label(String(active.id))}» está fuera de la lista.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Has soltado «${label(String(active.id))}» en la posición ${position(String(over.id))} de ${total}.`
        : `Has soltado «${label(String(active.id))}». No cambia de sitio.`,
    onDragCancel: ({ active }) => `Has cancelado. «${label(String(active.id))}» vuelve a su sitio.`,
  };
}

/** Lo que se anuncia tras Subir/Bajar (position empieza en 1). */
export function moveAnnouncement(name: string, position: number, total: number): string {
  return `“${name}” pasa a la posición ${position} de ${total}.`;
}

export const GENERIC_ERROR = 'Algo ha fallado. Vuelve a intentarlo en un momento.';
