import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CustomerWarnings } from './CustomerWarnings';
import { ReservationsNav } from './ReservationsNav';
import { ReservationStatusBadge } from './ReservationStatusBadge';

const R = '11111111-1111-4111-8111-111111111111';

it('Sala ve Día y Cuadrícula; quien configura, también Bloqueos y Ajustes; la actual lleva aria-current', () => {
  const staff = renderToStaticMarkup(<ReservationsNav restaurantId={R} current="cuadricula" date="2030-06-14" canConfigure={false} />);
  expect(staff).toContain(`href="/panel/${R}/reservas/cuadricula?fecha=2030-06-14"`);
  expect(staff).not.toContain('Ajustes');
  expect(staff).toMatch(/aria-current="page"[^>]*>Cuadrícula/);
  const manager = renderToStaticMarkup(<ReservationsNav restaurantId={R} current="dia" canConfigure />);
  expect(manager).toContain('Bloqueos');
  expect(manager).toContain(`href="/panel/${R}/reservas/ajustes"`);
});

it('el estado se ve con texto (no solo color) y los avisos importantes dicen «Atención»', () => {
  expect(renderToStaticMarkup(<ReservationStatusBadge status="no_show" />)).toContain('No vino');
  const html = renderToStaticMarkup(<CustomerWarnings warnings={[{ text: '2 no-shows', tone: 'warning' }, { text: 'VIP', tone: 'info' }]} />);
  expect(html).toContain('<span class="sr-only">Atención: </span>2 no-shows');
  expect(html).toContain('VIP');
  expect(renderToStaticMarkup(<CustomerWarnings warnings={[]} />)).toBe('');
});
