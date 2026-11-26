import { describe, expect, it } from 'vitest';
import type { Allergen } from './codes';
import { containsAny, filterSections, needsAllergenNotice } from './allergen-filter';

const item = (id: string, allergens: Allergen[]) => ({ id, allergens });
const sections = [
  { id: 'entrantes', title: 'Entrantes', items: [item('croquetas', ['gluten', 'milk']), item('ensalada', []), item('gambas', ['crustaceans'])] },
  { id: 'postres', title: 'Postres', items: [item('flan', ['eggs', 'milk'])] },
];

describe('filtro de alérgenos', () => {
  it('sin nada marcado no oculta nada', () => {
    const r = filterSections(sections, []);
    expect(r.hiddenCount).toBe(0);
    expect(r.sections.map((s) => s.items.map((i) => i.id))).toEqual([['croquetas', 'ensalada', 'gambas'], ['flan']]);
  });

  it('oculta los platos que llevan algo de lo marcado y cuenta cuántos quedan fuera', () => {
    const r = filterSections(sections, ['crustaceans', 'gluten']);
    expect(r.hiddenCount).toBe(2);
    expect(r.sections.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['entrantes', ['ensalada']],
      ['postres', ['flan']],
    ]);
    expect(r.sections[0].title).toBe('Entrantes');
  });

  it('las secciones que se quedan vacías desaparecen; los platos sin alérgenos marcados nunca se ocultan', () => {
    const r = filterSections(sections, ['milk', 'eggs', 'gluten', 'crustaceans']);
    expect(r.sections.map((s) => s.id)).toEqual(['entrantes']);
    expect(r.sections[0].items.map((i) => i.id)).toEqual(['ensalada']);
    expect(r.hiddenCount).toBe(3);
  });

  it('containsAny y needsAllergenNotice', () => {
    expect(containsAny(item('x', ['soy']), ['soy', 'milk'])).toBe(true);
    expect(containsAny(item('x', ['soy']), ['milk'])).toBe(false);
    expect(needsAllergenNotice(item('x', []))).toBe(true);
    expect(needsAllergenNotice(item('x', ['soy']))).toBe(false);
  });
});
