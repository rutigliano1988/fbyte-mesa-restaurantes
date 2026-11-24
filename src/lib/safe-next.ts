/** Caracteres de control (incl. tabulador y salto de línea) y barras invertidas: nunca en una redirección. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

/** Solo permite redirigir a rutas internas ("/algo"), nunca a otro dominio. */
export function safeNext(next: string | null | undefined, fallback = '/panel'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (UNSAFE_CHARS.test(next)) return fallback;
  return next;
}
