import { expect, it } from 'vitest';
import { panelNav } from './panel-nav';

const id = '11111111-1111-1111-1111-111111111111';

it('el administrador ve Inicio, Local, Menú, Horario y Equipo', () => {
  expect(panelNav(id, 'admin')).toEqual([
    { href: `/panel/${id}`, label: 'Inicio' },
    { href: `/panel/${id}/local`, label: 'Local' },
    { href: `/panel/${id}/menu`, label: 'Menú' },
    { href: `/panel/${id}/horario`, label: 'Horario' },
    { href: `/panel/${id}/usuarios`, label: 'Equipo' },
  ]);
});

it('el encargado ve Menú y Horario, pero no Local ni Equipo', () => {
  expect(panelNav(id, 'manager').map((i) => i.label)).toEqual(['Inicio', 'Menú', 'Horario']);
});

it('sala ve Inicio y Menú (para marcar agotados)', () => {
  expect(panelNav(id, 'staff').map((i) => i.label)).toEqual(['Inicio', 'Menú']);
});
