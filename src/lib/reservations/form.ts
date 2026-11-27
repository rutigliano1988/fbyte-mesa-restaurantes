import type { CustomerLookup } from '@/lib/actions/reservations';
import { GENERIC_ERROR } from '@/lib/menu/sortable';
import type { CustomerWarning } from './customers';
import type { TableMode } from './validation';

/** Texto del botón: «Guardar sin mesa» si la mesa propuesta no encuentra hueco (y, al crear, también si se fuerza). */
export function submitLabel(mode: 'create' | 'edit', noRoom: boolean, tableMode: TableMode): string {
  if (noRoom || (mode === 'create' && tableMode === 'none')) return 'Guardar sin mesa';
  return mode === 'edit' ? 'Guardar cambios' : 'Guardar reserva';
}

/** Lo que se enseña tras buscar al cliente por su teléfono. */
export function lookupNotice(result: CustomerLookup | null): { text: string; warnings: CustomerWarning[] } {
  if (!result || result.error) return { text: result?.error ?? GENERIC_ERROR, warnings: [] };
  if (result.invalid) return { text: 'Revisa el teléfono.', warnings: [] };
  if (!result.customer) return { text: 'Cliente nuevo: se guardará su ficha con esta reserva.', warnings: [] };
  return { text: `Cliente encontrado: ${result.customer.name}.`, warnings: result.customer.warnings };
}

/**
 * Fecha del formulario cuando la página trae otra (`incoming`): la sigue si el formulario estaba en la anterior
 * (`seen`), p. ej. al volver atrás o por un enlace; si no, es una respuesta a medias mientras se escribe otra fecha.
 */
export function syncedDate(current: string, seen: string, incoming: string): string {
  return current === seen ? incoming : current;
}
