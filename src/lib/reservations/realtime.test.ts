import { describe, expect, it } from 'vitest';
import { isShownBlockDelete } from './realtime';

describe('borrados de bloqueos en tiempo real', () => {
  it('solo cuentan los bloqueos que enseña la página', () => {
    expect(isShownBlockDelete({ id: 'b1' }, ['b1', 'b2'])).toBe(true);
    expect(isShownBlockDelete({ id: 'otro' }, ['b1', 'b2'])).toBe(false);
  });

  it('un borrado sin clave (o con un id raro) no refresca', () => {
    expect(isShownBlockDelete({}, ['b1'])).toBe(false);
    expect(isShownBlockDelete(null, ['b1'])).toBe(false);
    expect(isShownBlockDelete({ id: 1 }, ['1'])).toBe(false);
  });
});
