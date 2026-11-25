import { expect, it } from 'vitest';
import { z } from 'zod';
import { fieldErrorsFrom, formStrings } from './forms';

it('devuelve el primer error de cada campo', () => {
  const schema = z.object({ a: z.string().min(2, 'corto').regex(/x/, 'sin x'), b: z.string() });
  const r = schema.safeParse({ a: 'y', b: 'ok' });
  expect(r.success).toBe(false);
  if (!r.success) expect(fieldErrorsFrom(r.error)).toEqual({ a: 'corto' });
});

it('formStrings lee texto y deja en blanco lo que falta o es un archivo', () => {
  const fd = new FormData();
  fd.set('name', 'La Taberna');
  fd.set('file', new Blob(['x']), 'x.webp');
  expect(formStrings(fd, ['name', 'city', 'file'])).toEqual({ name: 'La Taberna', city: '', file: '' });
});
