import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import { SAMPLE_MENU_JSON } from './menu-fixtures';
import { parsePublicMenu, type PublicMenuData } from './menu-schema';
import { buildMenuView, menusToShow } from './menu-view';

const data = parsePublicMenu(SAMPLE_MENU_JSON) as PublicMenuData;
const [carta, daily] = data.menus;
const mediaUrl = (p: string) => `https://cdn.test/${p}`;
const nb = (s: string) => s.replace(/ /g, ' ');
const view = (menu = carta, locale: 'es' | 'en' = 'es', unavailableMode: 'hide' | 'strike' = 'strike') =>
  buildMenuView(menu, { locale, unavailableMode, messages: getMessages(locale), mediaUrl });

describe('buildMenuView', () => {
  it('textos en el idioma pedido, con el castellano de respaldo', () => {
    const v = view(carta, 'en');
    expect(v.title).toBe('Menu');
    expect(v.sections.map((s) => s.title)).toEqual(['Starters', 'Principales']);
    expect(v.sections[0].items[0]).toMatchObject({ name: 'Croquettes', description: 'De jamón ibérico.' });
  });

  it('precios con formato y etiqueta', () => {
    const v = view();
    expect(v.sections[0].items[0].prices).toEqual([
      { label: 'Media', text: nb('9,00 €'), market: false },
      { label: 'Ración', text: nb('15,00 €'), market: false },
    ]);
    expect(v.sections[1].items.map((i) => i.prices)).toEqual([
      [{ label: null, text: nb('45,00 €/kg'), market: false }],
      [{ label: null, text: 'S/M', market: true }],
    ]);
    expect(view(carta, 'en').sections[0].items[0].prices.map((p) => [p.label, p.text])).toEqual([
      ['Half', '€9.00'],
      ['Ración', '€15.00'],
    ]);
  });

  it('agotados: tachados con «strike» y fuera con «hide»', () => {
    expect(view().sections[0].items.map((i) => [i.name, i.unavailable])).toEqual([
      ['Croquetas', false],
      ['Ensalada de la huerta', true],
    ]);
    expect(view(carta, 'es', 'hide').sections[0].items.map((i) => i.name)).toEqual(['Croquetas']);
  });

  it('menú del día: precio cerrado, «incluye» y platos escritos a mano con sus alérgenos', () => {
    const v = view(daily);
    expect([v.kind, v.title, v.priceText, v.includes]).toEqual(['daily', 'Menú del día', nb('14,50 €'), 'Pan, bebida y postre']);
    expect(v.sections[0].items[0]).toEqual({
      id: 'i-sopa',
      name: 'Sopa de pescado',
      description: null,
      prices: [],
      allergens: ['fish', 'celery'],
      tags: [],
      photoUrl: null,
      photoAlt: 'Foto de Sopa de pescado',
      enlargeLabel: 'Ampliar la foto de Sopa de pescado',
      unavailable: false,
    });
  });

  it('las secciones vacías no salen; las fotos llevan su URL y sus textos alternativos', () => {
    const v = view();
    expect(v.sections.map((s) => s.id)).toEqual(['entrantes', 'principales']);
    expect(v.sections[0].items[0]).toMatchObject({
      photoUrl: 'https://cdn.test/11111111-1111-4111-8111-111111111111/dishes/croquetas.webp',
      photoAlt: 'Foto de Croquetas',
      enlargeLabel: 'Ampliar la foto de Croquetas',
      allergens: ['gluten', 'milk'],
      tags: ['recommended'],
    });
    expect(v.priceText).toBeNull();
  });
});

describe('menusToShow', () => {
  it('el menú del día que toca va primero y las cartas sin platos no salen', () => {
    expect(menusToShow(data, new Date('2026-11-30T12:30:00Z'), 'Europe/Madrid').map((m) => m.id)).toEqual(['daily-1', 'carta-1']);
    expect(menusToShow(data, new Date('2026-12-05T12:30:00Z'), 'Europe/Madrid').map((m) => m.id)).toEqual(['carta-1']);
    expect(menusToShow(null, new Date(), 'Europe/Madrid')).toEqual([]);
  });
});
