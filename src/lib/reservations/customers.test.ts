import { expect, it } from 'vitest';
import { customerWarnings, type CustomerSummary } from './customers';

const base: CustomerSummary = { id: 'c', name: 'Ana', phone: null, email: null, tags: [], visitsCount: 0, noShowCount: 0, cancelCount: 0 };

it('un cliente nuevo: primera visita', () => {
  expect(customerWarnings(base)).toEqual([{ text: 'Primera visita', tone: 'info' }]);
});

it('primero los avisos (problemático, no-shows, cancelaciones) y después VIP, habitual y visitas', () => {
  expect(customerWarnings({ ...base, tags: ['vip', 'problem', 'regular'], noShowCount: 2, cancelCount: 1, visitsCount: 1 })).toEqual([
    { text: 'Problemático', tone: 'warning' },
    { text: '2 no-shows', tone: 'warning' },
    { text: '1 cancelación', tone: 'warning' },
    { text: 'VIP', tone: 'info' },
    { text: 'Habitual', tone: 'info' },
    { text: '1 visita', tone: 'info' },
  ]);
  expect(customerWarnings({ ...base, noShowCount: 1, visitsCount: 5 }).map((w) => w.text)).toEqual(['1 no-show', '5 visitas']);
});
