import { describe, expect, it } from 'vitest';
import { dragAnnouncements, dropId, moveId } from './sortable';

describe('ordenar listas', () => {
  it('moveId sube o baja un puesto y no se sale de la lista', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveId(['a', 'b', 'c'], 'x', 1)).toBeNull();
  });

  it('dropId lleva un elemento al sitio de otro', () => {
    expect(dropId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(dropId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(dropId(['a', 'b'], 'a', 'a')).toBeNull();
  });

  it('los avisos para lectores de pantalla van en castellano y con la posición', () => {
    const labels: Record<string, string> = { a: 'Entrantes', b: 'Postres', c: 'Bebidas' };
    const say = dragAnnouncements((id) => labels[id], ['a', 'b', 'c']);
    expect(say.onDragStart({ active: { id: 'b' } } as never)).toBe('Has cogido «Postres». Está en la posición 2 de 3.');
    expect(say.onDragOver({ active: { id: 'b' }, over: { id: 'a' } } as never)).toBe('«Postres» pasaría a la posición 1 de 3.');
    expect(say.onDragEnd({ active: { id: 'b' }, over: { id: 'c' } } as never)).toBe('Has soltado «Postres» en la posición 3 de 3.');
    expect(say.onDragCancel({ active: { id: 'b' }, over: null } as never)).toBe('Has cancelado. «Postres» vuelve a su sitio.');
  });
});
