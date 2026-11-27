import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ALLERGENS } from '@/lib/menu/codes';
import { AllergenIcon, AllergenLabel } from './AllergenIcon';

describe('iconos de alérgenos', () => {
  it('hay un pictograma propio para cada uno de los 14, decorativo para los lectores de pantalla', () => {
    const drawings = new Set<string>();
    for (const allergen of ALLERGENS) {
      const html = renderToStaticMarkup(<AllergenIcon allergen={allergen} />);
      expect(html, allergen).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(html, allergen).toMatch(/<(path|circle|rect)\b/);
      expect(html, `${allergen}: solo trazos, sin texto`).not.toMatch(/<text\b/);
      drawings.add(html);
    }
    expect(drawings.size).toBe(14);
  });

  it('la etiqueta siempre lleva el nombre del alérgeno', () => {
    const html = renderToStaticMarkup(<AllergenLabel allergen="sulphites" name="Sulfitos" />);
    expect(html).toContain('Sulfitos');
    expect(html).toContain('aria-hidden="true"');
  });
});
