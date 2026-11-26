import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '@/lib/forms';
import {
  confirmSchema,
  dishFormSchema,
  inlineItemSchema,
  menuFormSchema,
  readDishForm,
  readInlineItemForm,
  readMenuForm,
  readSectionForm,
  sectionFormSchema,
  unavailableModeSchema,
} from './validation';

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

function errors(result: { success: boolean; error?: Parameters<typeof fieldErrorsFrom>[0] }) {
  expect(result.success).toBe(false);
  return result.error ? fieldErrorsFrom(result.error) : {};
}

const noSchedule = { includes: {}, priceCents: null, weekdays: null, startMinute: null, endMinute: null, dateFrom: null, dateTo: null };

describe('formulario de carta', () => {
  it('una carta solo necesita el nombre en castellano; lo del menú del día se ignora', () => {
    const r = menuFormSchema.safeParse(
      readMenuForm(form([['kind', 'carta'], ['name_es', ' Carta '], ['name_en', 'Menu'], ['active', 'on'], ['price', '12'], ['weekdays', '1']])),
    );
    expect(r.success && r.data).toEqual({ kind: 'carta', active: true, names: { es: 'Carta', en: 'Menu' }, ...noSchedule });
  });

  it('sin nombre en castellano o con un nombre largo, el error sale junto al campo', () => {
    const r = menuFormSchema.safeParse(readMenuForm(form([['kind', 'carta'], ['name_en', 'x'.repeat(61)]])));
    expect(errors(r)).toEqual({
      name_en: 'El nombre puede tener como mucho 60 caracteres.',
      name_es: 'Ponle nombre a la carta (por ejemplo, Carta o Menú del día).',
    });
  });

  it('menú del día con precio, días, «incluye» y una franja que pasa de medianoche', () => {
    const r = menuFormSchema.safeParse(
      readMenuForm(
        form([
          ['kind', 'daily'],
          ['name_es', 'Menú del día'],
          ['price', '15,50'],
          ['weekdays', '5'],
          ['weekdays', '1'],
          ['weekdays', '1'],
          ['start', '20:00'],
          ['end', '02:00'],
          ['includes_es', 'Pan, bebida y postre'],
        ]),
      ),
    );
    expect(r.success && r.data).toEqual({
      kind: 'daily',
      active: false,
      names: { es: 'Menú del día' },
      includes: { es: 'Pan, bebida y postre' },
      priceCents: 1550,
      weekdays: [1, 5],
      startMinute: 1200,
      endMinute: 1560,
      dateFrom: null,
      dateTo: null,
    });
  });

  it('menú del día sin precio, sin días y con una sola hora', () => {
    const r = menuFormSchema.safeParse(readMenuForm(form([['kind', 'daily'], ['name_es', 'Menú'], ['price', 'quince'], ['start', '13:00']])));
    expect(errors(r)).toEqual({
      price: 'Escribe el precio del menú (por ejemplo, 15,50).',
      weekdays: 'Elige al menos un día.',
      end: 'Pon la hora de inicio y la de fin, o deja las dos vacías.',
    });
  });

  it('menú especial: fechas obligatorias, un solo día si falta la final y fechas que existan', () => {
    const base: [string, string][] = [['kind', 'special'], ['name_es', 'Nochebuena'], ['price', '45'], ['weekdays', '4']];
    expect(errors(menuFormSchema.safeParse(readMenuForm(form(base))))).toEqual({ dateFrom: 'Elige las fechas del menú especial.' });
    const oneDay = menuFormSchema.safeParse(readMenuForm(form([...base, ['dateFrom', '2026-12-24']])));
    expect(oneDay.success && [oneDay.data.dateFrom, oneDay.data.dateTo]).toEqual(['2026-12-24', '2026-12-24']);
    expect(errors(menuFormSchema.safeParse(readMenuForm(form([...base, ['dateFrom', '2026-02-31']]))))).toEqual({
      dateFrom: 'Esa fecha no existe.',
    });
    expect(
      errors(menuFormSchema.safeParse(readMenuForm(form([...base, ['dateFrom', '2026-12-24'], ['dateTo', '2026-12-20']])))),
    ).toEqual({ dateTo: 'La fecha final no puede ser anterior a la inicial.' });
  });
});

describe('formulario de plato', () => {
  it('textos, alérgenos y etiquetas en orden y dos precios con etiqueta; las filas vacías no cuentan', () => {
    const r = dishFormSchema.safeParse(
      readDishForm(
        form([
          ['name_es', 'Croquetas'],
          ['description_es', 'De jamón'],
          ['allergens', 'milk'],
          ['allergens', 'gluten'],
          ['allergens', 'pollen'],
          ['tags', 'recommended'],
          ['price0_kind', 'fixed'],
          ['price0_amount', '9'],
          ['price0_label_es', 'Media'],
          ['price1_kind', 'fixed'],
          ['price1_amount', '15,00'],
          ['price1_label_es', 'Ración'],
          ['price1_label_en', 'Portion'],
          ['price2_kind', 'fixed'],
          ['price2_amount', ''],
          ['price3_kind', 'per_kg'],
          ['price3_amount', ''],
        ]),
      ),
    );
    expect(r.success && r.data).toEqual({
      names: { es: 'Croquetas' },
      descriptions: { es: 'De jamón' },
      allergens: ['gluten', 'milk'],
      tags: ['recommended'],
      prices: [
        { kind: 'fixed', priceCents: 900, labels: { es: 'Media' } },
        { kind: 'fixed', priceCents: 1500, labels: { es: 'Ración', en: 'Portion' } },
      ],
    });
  });

  it('«según mercado» va solo y sin importe', () => {
    const ok = dishFormSchema.safeParse(readDishForm(form([['name_es', 'Pescado del día'], ['price0_kind', 'market'], ['price0_amount', '12']])));
    expect(ok.success && ok.data.prices).toEqual([{ kind: 'market', priceCents: null, labels: {} }]);
    const bad = dishFormSchema.safeParse(
      readDishForm(form([['name_es', 'Pescado'], ['price0_kind', 'fixed'], ['price0_amount', '12'], ['price1_kind', 'market']])),
    );
    expect(errors(bad)).toEqual({ price1_kind: 'Un precio «según mercado» va solo: deja vacías las demás filas.' });
  });

  it('importes que no valen, etiqueta sin importe, etiquetas incompatibles y sin nombre', () => {
    const r = dishFormSchema.safeParse(
      readDishForm(
        form([
          ['price0_kind', 'fixed'],
          ['price0_amount', 'doce'],
          ['price1_kind', 'fixed'],
          ['price1_label_es', 'Media'],
          ['allergens', 'milk'],
          ['tags', 'vegan'],
        ]),
      ),
    );
    expect(errors(r)).toEqual({
      name_es: 'Ponle nombre al plato.',
      tags: 'Un plato con leche no puede llevar la etiqueta «Vegano».',
      price0_amount: 'Escribe un importe entre 0 y 99.999,99 (por ejemplo, 12,50).',
      price1_amount: 'Escribe el importe o deja la fila vacía.',
    });
  });

  it('un plato sin precios también vale', () => {
    const r = dishFormSchema.safeParse(readDishForm(form([['name_es', 'Pan']])));
    expect(r.success && r.data.prices).toEqual([]);
  });
});

describe('sección, plato escrito a mano y ajustes', () => {
  it('la sección necesita nombre en castellano', () => {
    expect(errors(sectionFormSchema.safeParse(readSectionForm(form([['name_en', 'Starters']]))))).toEqual({
      name_es: 'Ponle nombre a la sección (por ejemplo, Entrantes).',
    });
    const ok = sectionFormSchema.safeParse(readSectionForm(form([['name_es', 'Entrantes'], ['name_en', 'Starters']])));
    expect(ok.success && ok.data).toEqual({ names: { es: 'Entrantes', en: 'Starters' } });
  });

  it('el plato escrito a mano: nombre y alérgenos en orden', () => {
    const ok = inlineItemSchema.safeParse(
      readInlineItemForm(form([['name_es', 'Sopa de pescado'], ['allergens', 'celery'], ['allergens', 'fish']])),
    );
    expect(ok.success && ok.data).toEqual({ names: { es: 'Sopa de pescado' }, allergens: ['fish', 'celery'] });
    expect(errors(inlineItemSchema.safeParse(readInlineItemForm(form([]))))).toEqual({ name_es: 'Ponle nombre al plato.' });
  });

  it('modo de agotados y confirmación de borrado', () => {
    expect(unavailableModeSchema.safeParse('hide').success).toBe(true);
    expect(unavailableModeSchema.safeParse('blur').success).toBe(false);
    expect(confirmSchema.safeParse({ confirm: 'on' }).success).toBe(true);
    expect(errors(confirmSchema.safeParse({ confirm: '' }))).toEqual({ confirm: 'Marca la casilla para confirmar.' });
  });
});
