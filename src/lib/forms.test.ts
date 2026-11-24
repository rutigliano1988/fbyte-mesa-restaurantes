import { expect, it } from 'vitest';
import { z } from 'zod';
import { fieldErrorsFrom } from './forms';

it('devuelve el primer error de cada campo', () => {
  const schema = z.object({ a: z.string().min(2, 'corto').regex(/x/, 'sin x'), b: z.string() });
  const r = schema.safeParse({ a: 'y', b: 'ok' });
  expect(r.success).toBe(false);
  if (!r.success) expect(fieldErrorsFrom(r.error)).toEqual({ a: 'corto' });
});
