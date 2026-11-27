/**
 * ¿Un DELETE de `blocks` que llega por Realtime afecta a la página? Los borrados no se pueden filtrar por restaurante
 * (con RLS solo traen la clave primaria): solo cuenta si es uno de los bloqueos que la página enseña.
 */
export function isShownBlockDelete(old: unknown, blockIds: readonly string[]): boolean {
  const id = (old as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && blockIds.includes(id);
}
