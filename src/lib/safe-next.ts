/** Solo permite redirigir a rutas internas ("/algo"), nunca a otro dominio. */
export function safeNext(next: string | null | undefined, fallback = '/panel'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
