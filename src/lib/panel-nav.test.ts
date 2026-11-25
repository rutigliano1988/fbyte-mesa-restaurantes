import { expect, it } from 'vitest';
import { panelNav } from './panel-nav';

const id = '11111111-1111-1111-1111-111111111111';

it('el administrador ve Inicio, Local, Horario y Equipo', () => {
  expect(panelNav(id, 'admin')).toEqual([
    { href: `/panel/${id}`, label: 'Inicio' },
    { href: `/panel/${id}/local`, label: 'Local' },
    { href: `/panel/${id}/horario`, label: 'Horario' },
    { href: `/panel/${id}/usuarios`, label: 'Equipo' },
  ]);
});

it('el encargado ve Horario, pero no Local ni Equipo', () => {
  expect(panelNav(id, 'manager').map((i) => i.label)).toEqual(['Inicio', 'Horario']);
});

it('sala solo ve Inicio', () => {
  expect(panelNav(id, 'staff').map((i) => i.label)).toEqual(['Inicio']);
});
