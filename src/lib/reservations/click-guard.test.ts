import { describe, expect, it } from 'vitest';
import { shouldIgnoreClick } from './click-guard';

describe('shouldIgnoreClick', () => {
  it('deja pasar el clic cuando no hay nada en curso', () => {
    expect(shouldIgnoreClick({ busy: false, pending: false, readOnly: false })).toBe(false);
  });
  it('ignora el segundo clic mientras la guarda está tomada', () => {
    expect(shouldIgnoreClick({ busy: true, pending: false, readOnly: false })).toBe(true);
  });
  it('ignora el clic mientras la transición sigue pendiente aunque la acción ya haya vuelto', () => {
    expect(shouldIgnoreClick({ busy: false, pending: true, readOnly: false })).toBe(true);
  });
  it('ignora el clic en solo lectura', () => {
    expect(shouldIgnoreClick({ busy: false, pending: false, readOnly: true })).toBe(true);
  });
});
