import { expect, it } from 'vitest';
import { panelNav } from './panel-nav';

const id = '11111111-1111-1111-1111-111111111111';

it('el administrador ve Inicio y Equipo', () => {
  expect(panelNav(id, 'admin')).toEqual([
    { href: `/panel/${id}`, label: 'Inicio' },
    { href: `/panel/${id}/usuarios`, label: 'Equipo' },
  ]);
});

it('sala y encargado no ven Equipo', () => {
  expect(panelNav(id, 'staff').map((i) => i.label)).toEqual(['Inicio']);
  expect(panelNav(id, 'manager').map((i) => i.label)).toEqual(['Inicio']);
});
