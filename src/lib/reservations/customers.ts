import { CUSTOMER_TAG_LABELS_ES, type CustomerTag } from './codes';

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tags: CustomerTag[];
  visitsCount: number;
  noShowCount: number;
  cancelCount: number;
};

export type CustomerWarning = { text: string; tone: 'warning' | 'info' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Avisos del cliente que se ven en la reserva: etiquetas, no-shows, cancelaciones y visitas. */
export function customerWarnings(c: CustomerSummary): CustomerWarning[] {
  const out: CustomerWarning[] = [];
  if (c.tags.includes('problem')) out.push({ text: CUSTOMER_TAG_LABELS_ES.problem, tone: 'warning' });
  if (c.noShowCount > 0) out.push({ text: plural(c.noShowCount, 'no-show', 'no-shows'), tone: 'warning' });
  if (c.cancelCount > 0) out.push({ text: plural(c.cancelCount, 'cancelación', 'cancelaciones'), tone: 'warning' });
  if (c.tags.includes('vip')) out.push({ text: CUSTOMER_TAG_LABELS_ES.vip, tone: 'info' });
  if (c.tags.includes('regular')) out.push({ text: CUSTOMER_TAG_LABELS_ES.regular, tone: 'info' });
  out.push({ text: c.visitsCount === 0 ? 'Primera visita' : plural(c.visitsCount, 'visita', 'visitas'), tone: 'info' });
  return out;
}
