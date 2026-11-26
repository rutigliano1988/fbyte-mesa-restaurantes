import type { Allergen } from './codes';

export type FilterableItem = { allergens: readonly Allergen[] };

/** ¿Lleva alguno de los alérgenos que el comensal ha marcado? */
export function containsAny(item: FilterableItem, excluded: readonly Allergen[]): boolean {
  return item.allergens.some((a) => excluded.includes(a));
}

/**
 * Oculta los platos con alguno de los alérgenos marcados. Los platos sin ningún alérgeno marcado se quedan
 * (con el aviso de preguntar al personal). Las secciones que se quedan vacías desaparecen.
 * Solo en el navegador: no se guarda ni se envía nada.
 */
export function filterSections<S extends { items: readonly FilterableItem[] }>(
  sections: readonly S[],
  excluded: readonly Allergen[],
): { sections: S[]; hiddenCount: number } {
  let hiddenCount = 0;
  const out: S[] = [];
  for (const section of sections) {
    const items = section.items.filter((item) => {
      const hide = excluded.length > 0 && containsAny(item, excluded);
      if (hide) hiddenCount += 1;
      return !hide;
    });
    if (items.length > 0) out.push({ ...section, items });
  }
  return { sections: out, hiddenCount };
}

/** Sin alérgenos marcados hay que preguntar al personal. */
export function needsAllergenNotice(item: FilterableItem): boolean {
  return item.allergens.length === 0;
}
