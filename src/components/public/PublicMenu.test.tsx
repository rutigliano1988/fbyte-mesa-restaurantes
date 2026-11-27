import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import { SAMPLE_MENU_JSON } from '@/lib/public/menu-fixtures';
import { parsePublicMenu, type PublicMenuData } from '@/lib/public/menu-schema';
import { buildMenuView } from '@/lib/public/menu-view';
import { PublicMenu, type PublicMenuLabels } from './PublicMenu';

const data = parsePublicMenu(SAMPLE_MENU_JSON) as PublicMenuData;
const m = getMessages('es');
const view = buildMenuView(data.menus[0], { locale: 'es', unavailableMode: 'strike', messages: m, mediaUrl: (p) => `https://cdn.test/${p}` });
const labels: PublicMenuLabels = {
  allergens: m.allergens,
  tags: m.tags,
  allergensLabel: m.allergensLabel,
  marketPriceTitle: m.marketPriceTitle,
  unavailable: m.unavailable,
  askStaffAllergens: m.askStaffAllergens,
  allergenDisclaimer: m.allergenDisclaimer,
  filterTitle: m.filterTitle,
  filterIntro: m.filterIntro,
  filterHidden: [0, 1, 2, 3, 4].map((n) => m.filterHidden(n)),
  filterClear: m.filterClear,
  filterAllHidden: m.filterAllHidden,
  menuIndex: m.menuIndex,
  closePhoto: m.closePhoto,
};

describe('carta pública: accesibilidad', () => {
  const html = renderToStaticMarkup(<PublicMenu view={view} labels={labels} />);

  it('la región que anuncia el recuento del filtro está en la página desde el principio', () => {
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(html).not.toContain('empty:hidden');
  });

  it('«S/M» se lee como «Según mercado» en los lectores de pantalla', () => {
    expect(html).toContain('<span aria-hidden="true">S/M</span><span class="sr-only">Según mercado</span>');
  });
});
