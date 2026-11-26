import { z } from 'zod';
import { formStrings } from '@/lib/forms';
import { LOCALES } from '@/lib/i18n/locales';
import { daysBetween, timeToMinutes, toServiceRange } from '@/lib/schedule';
import { isRealDate } from '@/lib/validation/schedule';
import {
  MENU_KINDS,
  PRICE_KINDS,
  sortAllergens,
  sortTags,
  tagAllergenConflict,
  UNAVAILABLE_MODES,
  type Allergen,
  type DishTag,
  type MenuKind,
  type PriceKind,
} from './codes';
import { localeKeys, type I18nText } from './i18n-text';
import { parsePriceInput } from './price';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NO_SUCH_DATE = 'Esa fecha no existe.';
const BAD_TIME = 'Escribe la hora así: 13:30.';
const BAD_RANGE = 'Revisa las horas: tiene que acabar después de empezar y, como mucho, a las 06:00 del día siguiente.';

type Issue = { code: 'custom'; path: string[]; message: string };
type Ctx = { addIssue: (issue: Issue) => void };

/** Cuenta las incidencias para devolver z.NEVER en cuanto haya alguna. */
function tracking(ctx: Ctx) {
  let count = 0;
  return {
    ctx: {
      addIssue: (issue: Issue) => {
        count += 1;
        ctx.addIssue(issue);
      },
    },
    failed: () => count > 0,
  };
}

/** `${prefix}_${idioma}` → texto por idioma, con longitud máxima y, si se pide, castellano obligatorio. */
function readI18n(
  texts: Record<string, string>,
  prefix: string,
  ctx: Ctx,
  opts: { max: number; tooLong: string; required?: string },
): I18nText {
  const out: I18nText = {};
  for (const l of LOCALES) {
    const key = `${prefix}_${l}`;
    const value = (texts[key] ?? '').trim();
    if (value.length > opts.max) ctx.addIssue({ code: 'custom', path: [key], message: opts.tooLong });
    else if (value) out[l] = value;
  }
  const es = (texts[`${prefix}_es`] ?? '').trim();
  if (opts.required && es === '') ctx.addIssue({ code: 'custom', path: [`${prefix}_es`], message: opts.required });
  return out;
}

const texts = z.record(z.string(), z.string());

// Cartas ----------------------------------------------------------------------------------------------------
export const MENU_TEXT_KEYS = [...localeKeys('name'), ...localeKeys('includes')];

export function readMenuForm(fd: FormData) {
  return {
    ...formStrings(fd, ['kind', 'price', 'start', 'end', 'dateFrom', 'dateTo'] as const),
    active: fd.get('active') === 'on',
    weekdays: fd.getAll('weekdays').map(String),
    texts: formStrings(fd, MENU_TEXT_KEYS),
  };
}

export type MenuFormValues = {
  kind: MenuKind;
  active: boolean;
  names: I18nText;
  includes: I18nText;
  priceCents: number | null;
  weekdays: number[] | null;
  startMinute: number | null;
  endMinute: number | null;
  dateFrom: string | null;
  dateTo: string | null;
};

/** Crear o editar una carta. En «carta» se ignoran precio y programación; en «daily»/«special» son obligatorios. */
export const menuFormSchema = z
  .object({
    kind: z.enum(MENU_KINDS, { error: 'Elige qué tipo de carta es.' }),
    active: z.boolean(),
    price: z.string(),
    start: z.string(),
    end: z.string(),
    dateFrom: z.string(),
    dateTo: z.string(),
    weekdays: z.array(z.string()),
    texts,
  })
  .transform((v, rawCtx): MenuFormValues => {
    const t = tracking(rawCtx);
    const names = readI18n(v.texts, 'name', t.ctx, {
      max: 60,
      tooLong: 'El nombre puede tener como mucho 60 caracteres.',
      required: 'Ponle nombre a la carta (por ejemplo, Carta o Menú del día).',
    });
    if (v.kind === 'carta') {
      if (t.failed()) return z.NEVER;
      return { kind: v.kind, active: v.active, names, includes: {}, priceCents: null, weekdays: null, startMinute: null, endMinute: null, dateFrom: null, dateTo: null };
    }
    const includes = readI18n(v.texts, 'includes', t.ctx, { max: 300, tooLong: 'Como mucho 300 caracteres.' });
    const priceCents = parsePriceInput(v.price);
    if (priceCents === null) t.ctx.addIssue({ code: 'custom', path: ['price'], message: 'Escribe el precio del menú (por ejemplo, 15,50).' });
    const weekdays = [...new Set(v.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
    if (weekdays.length === 0) t.ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Elige al menos un día.' });

    let startMinute: number | null = null;
    let endMinute: number | null = null;
    const start = v.start.trim();
    const end = v.end.trim();
    if (start || end) {
      if (!start || !end) {
        t.ctx.addIssue({ code: 'custom', path: [start ? 'end' : 'start'], message: 'Pon la hora de inicio y la de fin, o deja las dos vacías.' });
      } else if (timeToMinutes(start) === null) {
        t.ctx.addIssue({ code: 'custom', path: ['start'], message: BAD_TIME });
      } else if (timeToMinutes(end) === null) {
        t.ctx.addIssue({ code: 'custom', path: ['end'], message: BAD_TIME });
      } else {
        const range = toServiceRange(start, end);
        if (!range) t.ctx.addIssue({ code: 'custom', path: ['end'], message: BAD_RANGE });
        else ({ startMinute, endMinute } = range);
      }
    }

    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    const from = v.dateFrom.trim();
    const to = v.dateTo.trim() || from;
    if (from) {
      if (!ISO_DATE.test(from) || !isRealDate(from)) t.ctx.addIssue({ code: 'custom', path: ['dateFrom'], message: NO_SUCH_DATE });
      else if (!ISO_DATE.test(to) || !isRealDate(to)) t.ctx.addIssue({ code: 'custom', path: ['dateTo'], message: NO_SUCH_DATE });
      else if (to < from) t.ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'La fecha final no puede ser anterior a la inicial.' });
      else if (daysBetween(from, to) > 366) t.ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Como mucho, un año seguido.' });
      else [dateFrom, dateTo] = [from, to];
    } else if (v.dateTo.trim()) {
      t.ctx.addIssue({ code: 'custom', path: ['dateFrom'], message: 'Elige también la fecha de inicio.' });
    } else if (v.kind === 'special') {
      t.ctx.addIssue({ code: 'custom', path: ['dateFrom'], message: 'Elige las fechas del menú especial.' });
    }

    if (t.failed()) return z.NEVER;
    return { kind: v.kind, active: v.active, names, includes, priceCents, weekdays, startMinute, endMinute, dateFrom, dateTo };
  });

// Secciones -------------------------------------------------------------------------------------------------
export const SECTION_TEXT_KEYS = localeKeys('name');

export function readSectionForm(fd: FormData) {
  return { texts: formStrings(fd, SECTION_TEXT_KEYS) };
}

export const sectionFormSchema = z.object({ texts }).transform((v, rawCtx): { names: I18nText } => {
  const t = tracking(rawCtx);
  const names = readI18n(v.texts, 'name', t.ctx, {
    max: 60,
    tooLong: 'El nombre puede tener como mucho 60 caracteres.',
    required: 'Ponle nombre a la sección (por ejemplo, Entrantes).',
  });
  if (t.failed()) return z.NEVER;
  return { names };
});

// Platos ----------------------------------------------------------------------------------------------------
/** Filas de precio del formulario (como mucho 4, igual que la BD). */
export const PRICE_ROWS = [0, 1, 2, 3] as const;
export const DISH_TEXT_KEYS = [
  ...localeKeys('name'),
  ...localeKeys('description'),
  ...PRICE_ROWS.flatMap((n) => localeKeys(`price${n}_label`)),
];

export function readDishForm(fd: FormData) {
  return {
    allergens: fd.getAll('allergens').map(String),
    tags: fd.getAll('tags').map(String),
    prices: PRICE_ROWS.map((n) => {
      const kind = fd.get(`price${n}_kind`);
      const amount = fd.get(`price${n}_amount`);
      return { kind: typeof kind === 'string' ? kind : 'fixed', amount: typeof amount === 'string' ? amount : '' };
    }),
    texts: formStrings(fd, DISH_TEXT_KEYS),
  };
}

export type DishFormValues = {
  names: I18nText;
  descriptions: I18nText;
  allergens: Allergen[];
  tags: DishTag[];
  prices: { kind: PriceKind; priceCents: number | null; labels: I18nText }[];
};

export const dishFormSchema = z
  .object({
    allergens: z.array(z.string()),
    tags: z.array(z.string()),
    prices: z.array(z.object({ kind: z.string(), amount: z.string() })).max(PRICE_ROWS.length),
    texts,
  })
  .transform((v, rawCtx): DishFormValues => {
    const t = tracking(rawCtx);
    const names = readI18n(v.texts, 'name', t.ctx, {
      max: 120,
      tooLong: 'El nombre puede tener como mucho 120 caracteres.',
      required: 'Ponle nombre al plato.',
    });
    const descriptions = readI18n(v.texts, 'description', t.ctx, {
      max: 500,
      tooLong: 'La descripción puede tener como mucho 500 caracteres.',
    });
    const allergens = sortAllergens(v.allergens);
    const tags = sortTags(v.tags);
    const conflict = tagAllergenConflict(tags, allergens);
    if (conflict) t.ctx.addIssue({ code: 'custom', path: ['tags'], message: conflict });

    const prices: DishFormValues['prices'] = [];
    v.prices.forEach((row, n) => {
      const kind: PriceKind = (PRICE_KINDS as readonly string[]).includes(row.kind) ? (row.kind as PriceKind) : 'fixed';
      const labels = readI18n(v.texts, `price${n}_label`, t.ctx, { max: 40, tooLong: 'La etiqueta puede tener como mucho 40 caracteres.' });
      if (kind === 'market') {
        prices.push({ kind, priceCents: null, labels });
        return;
      }
      const amount = row.amount.trim();
      if (!amount) {
        if (Object.keys(labels).length > 0) {
          t.ctx.addIssue({ code: 'custom', path: [`price${n}_amount`], message: 'Escribe el importe o deja la fila vacía.' });
        }
        return;
      }
      const priceCents = parsePriceInput(amount);
      if (priceCents === null) {
        t.ctx.addIssue({ code: 'custom', path: [`price${n}_amount`], message: 'Escribe un importe entre 0 y 99.999,99 (por ejemplo, 12,50).' });
        return;
      }
      prices.push({ kind, priceCents, labels });
    });
    const marketRow = v.prices.findIndex((row) => row.kind === 'market');
    if (marketRow >= 0 && prices.length > 1) {
      t.ctx.addIssue({ code: 'custom', path: [`price${marketRow}_kind`], message: 'Un precio «según mercado» va solo: deja vacías las demás filas.' });
    }

    if (t.failed()) return z.NEVER;
    return { names, descriptions, allergens, tags, prices };
  });

// Platos escritos solo para un menú del día o especial ---------------------------------------------------------
export const INLINE_TEXT_KEYS = localeKeys('name');

export function readInlineItemForm(fd: FormData) {
  return { allergens: fd.getAll('allergens').map(String), texts: formStrings(fd, INLINE_TEXT_KEYS) };
}

export const inlineItemSchema = z
  .object({ allergens: z.array(z.string()), texts })
  .transform((v, rawCtx): { names: I18nText; allergens: Allergen[] } => {
    const t = tracking(rawCtx);
    const names = readI18n(v.texts, 'name', t.ctx, {
      max: 120,
      tooLong: 'El nombre puede tener como mucho 120 caracteres.',
      required: 'Ponle nombre al plato.',
    });
    if (t.failed()) return z.NEVER;
    return { names, allergens: sortAllergens(v.allergens) };
  });

// Ajustes ---------------------------------------------------------------------------------------------------
export const unavailableModeSchema = z.enum(UNAVAILABLE_MODES, { error: 'Elige cómo se ven los platos agotados.' });

/** Casilla «Sí, quiero borrarlo» de los formularios de borrado. */
export const confirmSchema = z.object({ confirm: z.literal('on', { error: 'Marca la casilla para confirmar.' }) });
