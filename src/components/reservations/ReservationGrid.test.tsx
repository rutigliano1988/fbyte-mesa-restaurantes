import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { BlockSpan, BookingTable } from '@/lib/reservations/availability';
import { buildGrid, gridColumns, type GridReservation } from '@/lib/reservations/grid';
import { zonedTimeToUtc } from '@/lib/reservations/time';
import { ReservationGrid } from './ReservationGrid';

const R = '11111111-1111-4111-8111-111111111111';
const TZ = 'Europe/Madrid';
const DATE = '2030-06-14';
const at = (minute: number, date = DATE) => zonedTimeToUtc(date, minute, TZ);
const t = (id: string, active = true): BookingTable => ({
  id,
  zoneId: 'z',
  zoneName: 'Sala',
  zonePosition: 0,
  name: id.toUpperCase(),
  minCapacity: 1,
  maxCapacity: 4,
  onlineBookable: true,
  active,
  position: 0,
});

function render(opts: {
  date?: string;
  service: { startMinute: number; endMinute: number };
  tables: BookingTable[];
  reservations?: GridReservation[];
  blocks?: BlockSpan[];
  readOnly?: boolean;
}) {
  const date = opts.date ?? DATE;
  const reservations = opts.reservations ?? [];
  const blocks = opts.blocks ?? [];
  const layout = buildGrid({ date, timeZone: TZ, service: opts.service, tables: opts.tables, reservations, blocks });
  const html = renderToStaticMarkup(
    <ReservationGrid
      restaurantId={R}
      date={date}
      timeZone={TZ}
      layout={layout}
      tables={opts.tables}
      reservations={reservations}
      blocks={blocks}
      readOnly={opts.readOnly ?? false}
      label="Mesas y horas de Cena"
    />,
  );
  return { html, layout };
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

it('un solo punto de tabulación; huecos que abren una reserva en esa mesa y hora; barras que abren la reserva', () => {
  const r: GridReservation = { id: 'r1', startMs: at(1290), endMs: at(1380), tableIds: ['t1'], status: 'confirmed', name: 'García', partySize: 4 };
  const { html } = render({
    service: { startMinute: 1260, endMinute: 1410 },
    tables: [t('t1'), t('t2')],
    reservations: [r],
    blocks: [{ id: 'b1', tableId: null, startMs: at(1260), endMs: at(1410), reason: 'Evento' }],
  });
  expect(html).toContain('role="grid"');
  expect(count(html, 'tabindex="0"')).toBe(1);
  // El bloqueo de todo el restaurante se parte en dos tramos en t1 (la reserva manda): los dos se pintan.
  expect(count(html, 'aria-label="Bloqueada: Evento, T1, ')).toBe(2);
  expect(count(html, 'aria-label="Bloqueada: Evento, T2, ')).toBe(1);
  expect(html).not.toContain('role="img"');
  expect(html).toContain(`href="/panel/${R}/reservas/r1"`);
  expect(html).toMatch(/aria-label="García · 4 personas, T1, 21:30–23:00, Confirmada\. Abrir la reserva"[^>]*>García · 4</);

  expect(html).toMatch(/role="gridcell"[^>]*aria-label="Bloqueada: Evento, T2, [^"]*"[^>]*>Bloqueada: Evento</);
  expect(count(html, 'tabindex="0"')).toBe(1);

  const free = render({ service: { startMinute: 1260, endMinute: 1290 }, tables: [t('t1')] }).html;
  expect(free).toContain(`href="/panel/${R}/reservas/nueva?fecha=2030-06-14&amp;hora=21%3A15&amp;mesa=t1"`);
  expect(free).toContain('aria-label="Nueva reserva en T1 a las 21:15"');
});

it('mesa desactivada con reservas y modo soporte: los huecos se ven, pero sin enlace de nueva reserva', () => {
  const r: GridReservation = { id: 'r2', startMs: at(1260), endMs: at(1290), tableIds: ['t2'], status: 'pending', name: 'Ruiz', partySize: 2 };
  const service = { startMinute: 1260, endMinute: 1320 };
  const { html } = render({ service, tables: [t('t1'), t('t2', false)], reservations: [r] });
  expect(html).toContain('desactivada');
  expect(html).toContain('mesa=t1');
  expect(html).not.toContain('mesa=t2');
  expect(html).toContain('aria-label="T2 desactivada, 21:30"');

  const support = render({ service, tables: [t('t1'), t('t2', false)], reservations: [r], readOnly: true }).html;
  expect(support).not.toContain('/reservas/nueva');
  expect(support).toContain(`href="/panel/${R}/reservas/r2"`);
  // Pendiente: marca visible «Pend.», borde discontinuo y nombre accesible que empieza por el texto visible.
  expect(support).toMatch(/aria-label="Pend\. Ruiz · 2 personas[^"]*"[^>]*>Pend\. Ruiz · 2</);
  expect(support).toContain('border-dashed');
  expect(support).toContain('aria-label="T1, 21:00, libre"');
  expect(count(support, 'tabindex="0"')).toBe(1);
});

it('la noche del adelanto de hora hay menos columnas: las cabeceras salen de la cuadrícula, y de madrugada se dice «del día siguiente»', () => {
  const date = '2030-03-30'; // la madrugada del 31 de marzo de 2030 no existen las 02:xx
  const service = { startMinute: 1380, endMinute: 1620 }; // 23:00–03:00
  const { html, layout } = render({ date, service, tables: [t('t1')] });
  expect(layout.columns.length).toBeLessThan(gridColumns(service).length);
  expect(count(html, 'role="columnheader"')).toBe(layout.columns.length + 1);
  expect(html).toContain(`aria-colcount="${layout.columns.length + 1}"`);
  expect(html).toContain('aria-label="Nueva reserva en T1 a las 01:00 del día siguiente"');
  expect(html).not.toContain('a las 02:00');
});
