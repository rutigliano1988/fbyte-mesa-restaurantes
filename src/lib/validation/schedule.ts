import { z } from 'zod';
import { daysBetween, timeToMinutes, toServiceRange } from '@/lib/schedule';

const REQUIRED = 'Este campo es obligatorio.';
const BAD_TIME = 'Escribe la hora así: 13:30.';
const BAD_RANGE = 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const serviceName = z
  .string({ error: REQUIRED })
  .trim()
  .min(1, 'Ponle nombre al servicio (por ejemplo, Comida o Cena).')
  .max(40, 'El nombre puede tener como mucho 40 caracteres.');

type RangeCtx = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

function rangeOrIssue(start: string, end: string, ctx: RangeCtx, startKey: string, endKey: string) {
  if (timeToMinutes(start) === null) ctx.addIssue({ code: 'custom', path: [startKey], message: BAD_TIME });
  if (timeToMinutes(end) === null) ctx.addIssue({ code: 'custom', path: [endKey], message: BAD_TIME });
  if (timeToMinutes(start) === null || timeToMinutes(end) === null) return null;
  const range = toServiceRange(start, end);
  if (!range) ctx.addIssue({ code: 'custom', path: [endKey], message: BAD_RANGE });
  return range;
}

/** Editar un servicio: nombre y horas. */
export const serviceSchema = z
  .object({ name: serviceName, start: z.string({ error: REQUIRED }), end: z.string({ error: REQUIRED }) })
  .transform((v, ctx) => {
    const range = rangeOrIssue(v.start, v.end, ctx, 'start', 'end');
    if (!range) return z.NEVER;
    return { name: v.name, ...range };
  });

/** Crear un servicio en uno o varios días a la vez. */
export const newServicesSchema = z
  .object({
    name: serviceName,
    start: z.string({ error: REQUIRED }),
    end: z.string({ error: REQUIRED }),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, 'Elige al menos un día.'),
  })
  .transform((v, ctx) => {
    const range = rangeOrIssue(v.start, v.end, ctx, 'start', 'end');
    if (!range) return z.NEVER;
    return { name: v.name, weekdays: [...new Set(v.weekdays)].sort(), ...range };
  });

/** Cierre (closed) u horario especial (custom) de una fecha o un rango de fechas, con hasta dos servicios. */
export const exceptionSchema = z
  .object({
    dateFrom: z.string({ error: REQUIRED }).regex(ISO_DATE, 'Elige una fecha.'),
    dateTo: z.string().trim(),
    kind: z.enum(['closed', 'custom'], { error: 'Elige si cierras o abres con otro horario.' }),
    note: z
      .string()
      .trim()
      .max(140, 'La nota puede tener como mucho 140 caracteres.')
      .transform((v) => (v === '' ? null : v)),
    name1: z.string().trim(),
    start1: z.string().trim(),
    end1: z.string().trim(),
    name2: z.string().trim(),
    start2: z.string().trim(),
    end2: z.string().trim(),
  })
  .transform((v, ctx) => {
    const dateTo = v.dateTo === '' ? v.dateFrom : v.dateTo;
    let ok = true;
    if (!ISO_DATE.test(dateTo)) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Elige una fecha.' });
      ok = false;
    } else if (dateTo < v.dateFrom) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'La fecha final no puede ser anterior a la inicial.' });
      ok = false;
    } else if (daysBetween(v.dateFrom, dateTo) > 366) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Como mucho, un año seguido.' });
      ok = false;
    }
    const customServices: { name: string; start_minute: number; end_minute: number }[] = [];
    if (v.kind === 'custom') {
      const rows = [
        { n: '1', name: v.name1, start: v.start1, end: v.end1 },
        { n: '2', name: v.name2, start: v.start2, end: v.end2 },
      ];
      for (const row of rows) {
        if (!row.name && !row.start && !row.end) continue;
        if (!row.name) {
          ctx.addIssue({ code: 'custom', path: [`name${row.n}`], message: 'Ponle nombre al servicio.' });
          ok = false;
          continue;
        }
        const range = rangeOrIssue(row.start, row.end, ctx, `start${row.n}`, `end${row.n}`);
        if (!range) {
          ok = false;
          continue;
        }
        customServices.push({ name: row.name.slice(0, 40), start_minute: range.startMinute, end_minute: range.endMinute });
      }
      const [a, b] = customServices;
      if (a && b && a.start_minute < b.end_minute && b.start_minute < a.end_minute) {
        ctx.addIssue({ code: 'custom', path: ['end2'], message: 'Los dos servicios se solapan.' });
        ok = false;
      }
      if (ok && customServices.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['name1'], message: 'Añade al menos un servicio para el horario especial.' });
        ok = false;
      }
    }
    if (!ok) return z.NEVER;
    return { dateFrom: v.dateFrom, dateTo, kind: v.kind, note: v.note, customServices };
  });
