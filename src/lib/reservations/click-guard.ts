/**
 * Un clic en un botón de estado se ignora si ya hay uno en curso (`busy`), si la transición sigue pendiente
 * (`pending`: hasta que se pinta el estado nuevo) o si la vista es de solo lectura.
 */
export function shouldIgnoreClick({ busy, pending, readOnly }: { busy: boolean; pending: boolean; readOnly: boolean }) {
  return busy || pending || readOnly;
}
