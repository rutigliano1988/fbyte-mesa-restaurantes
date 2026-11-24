import { expect, it } from 'vitest';
import { safeNext } from './safe-next';

it('acepta rutas internas', () => {
  expect(safeNext('/panel/abc')).toBe('/panel/abc');
  expect(safeNext('/invitacion/xyz?a=1')).toBe('/invitacion/xyz?a=1');
});

it('rechaza destinos externos o raros', () => {
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'panel', '', null, undefined]) {
    expect(safeNext(bad)).toBe('/panel');
  }
});

it('admite un fallback propio', () => {
  expect(safeNext(null, '/admin')).toBe('/admin');
});
