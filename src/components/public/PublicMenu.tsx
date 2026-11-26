'use client';

import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';
import { AllergenIcon, AllergenLabel } from '@/components/menu/AllergenIcon';
import { filterSections, needsAllergenNotice } from '@/lib/menu/allergen-filter';
import { ALLERGENS, type Allergen, type DishTag } from '@/lib/menu/codes';
import type { MenuView, MenuViewItem } from '@/lib/public/menu-view';

/** Textos ya traducidos: a un componente cliente no se le pueden pasar funciones. */
export type PublicMenuLabels = {
  allergens: Record<Allergen, string>;
  tags: Record<DishTag, string>;
  allergensLabel: string;
  marketPriceTitle: string;
  unavailable: string;
  askStaffAllergens: string;
  allergenDisclaimer: string;
  filterTitle: string;
  filterIntro: string;
  /** filterHidden[n]: texto para n platos ocultos. */
  filterHidden: string[];
  filterClear: string;
  filterAllHidden: string;
  menuIndex: string;
  closePhoto: string;
};

/**
 * Una carta: filtro de alérgenos (solo en el navegador: no se guarda ni se envía nada), índice de categorías fijo
 * al hacer scroll y platos.
 */
export function PublicMenu({ view, labels }: { view: MenuView; labels: PublicMenuLabels }) {
  const [excluded, setExcluded] = useState<Allergen[]>([]);
  const { sections, hiddenCount } = useMemo(() => filterSections(view.sections, excluded), [view, excluded]);
  const toggle = (allergen: Allergen) =>
    setExcluded((prev) => (prev.includes(allergen) ? prev.filter((a) => a !== allergen) : [...prev, allergen]));
  const status = excluded.length > 0 ? labels.filterHidden[Math.min(hiddenCount, labels.filterHidden.length - 1)] : '';

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={labels.filterTitle} className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <details>
          <summary className="cursor-pointer font-bold">
            {labels.filterTitle}
            {excluded.length > 0 && ` (${excluded.length})`}
          </summary>
          <p className="mt-2 text-sm text-neutral-600">{labels.filterIntro}</p>
          <fieldset className="mt-3">
            <legend className="sr-only">{labels.allergensLabel}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALLERGENS.map((allergen) => (
                <label
                  key={allergen}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 has-[:checked]:border-neutral-900"
                >
                  <input type="checkbox" checked={excluded.includes(allergen)} onChange={() => toggle(allergen)} className="size-4 accent-neutral-900" />
                  <AllergenIcon allergen={allergen} />
                  <span>{labels.allergens[allergen]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {excluded.length > 0 && (
            <button type="button" onClick={() => setExcluded([])} className="mt-3 text-sm font-bold underline">
              {labels.filterClear}
            </button>
          )}
        </details>
        <p role="status" className="mt-2 text-sm font-semibold empty:hidden">
          {status}
        </p>
        <p className="mt-2 text-xs text-neutral-600">{labels.allergenDisclaimer}</p>
      </section>

      {sections.length > 1 && (
        <nav aria-label={labels.menuIndex} className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur">
          <ul className="flex gap-2 whitespace-nowrap">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#s-${section.id}`} className="inline-block rounded-full border border-neutral-300 px-3 py-1 text-sm font-semibold hover:border-neutral-500">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {sections.length === 0 && <p className="text-neutral-600">{labels.filterAllHidden}</p>}

      {sections.map((section) => (
        <section key={section.id} id={`s-${section.id}`} aria-labelledby={`t-${section.id}`} className="scroll-mt-16">
          <h2 id={`t-${section.id}`} className="mb-1 text-xl font-bold text-[var(--accent-text)]">
            {section.title}
          </h2>
          <ul className="divide-y divide-neutral-200">
            {section.items.map((item) => (
              <DishCard key={item.id} item={item} labels={labels} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DishCard({ item, labels }: { item: MenuViewItem; labels: PublicMenuLabels }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const struck = item.unavailable ? 'text-neutral-500 line-through' : '';
  return (
    <li className="flex gap-3 py-4">
      <div className="min-w-0 flex-1">
        <h3 className={`font-bold ${struck}`}>{item.name}</h3>
        {item.unavailable && <p className="text-sm font-bold uppercase tracking-wide text-neutral-700">{labels.unavailable}</p>}
        {item.tags.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <li key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold">
                {labels.tags[tag]}
              </li>
            ))}
          </ul>
        )}
        {item.description && <p className="mt-1 text-sm text-neutral-700">{item.description}</p>}
        {item.prices.length > 0 && (
          <ul className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 ${struck}`}>
            {item.prices.map((price, i) => (
              <li key={i}>
                {price.label && <span className="text-neutral-600">{price.label}: </span>}
                {price.market ? (
                  <abbr title={labels.marketPriceTitle} className="font-bold no-underline">
                    {price.text}
                  </abbr>
                ) : (
                  <span className="font-bold">{price.text}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {needsAllergenNotice(item) ? (
          <p className="mt-2 text-sm text-neutral-600">{labels.askStaffAllergens}</p>
        ) : (
          <div className="mt-2">
            <span className="sr-only">{labels.allergensLabel}: </span>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-700">
              {item.allergens.map((allergen) => (
                <li key={allergen}>
                  <AllergenLabel allergen={allergen} name={labels.allergens[allergen]} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {item.photoUrl && (
        <>
          <button
            type="button"
            onClick={() => dialog.current?.showModal()}
            aria-label={item.enlargeLabel}
            className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-neutral-100 sm:size-24"
          >
            <Image src={item.photoUrl} alt="" fill unoptimized loading="lazy" sizes="96px" className="object-cover" />
          </button>
          <dialog ref={dialog} aria-label={item.photoAlt} className="m-auto w-[min(92vw,48rem)] rounded-xl p-0 backdrop:bg-black/70">
            <Image src={item.photoUrl} alt={item.photoAlt} width={1200} height={900} unoptimized className="h-auto max-h-[80vh] w-full object-contain" />
            <form method="dialog" className="p-3 text-right">
              <button type="submit" className="rounded-lg border-2 border-neutral-300 px-4 py-2 font-bold hover:border-neutral-500">
                {labels.closePhoto}
              </button>
            </form>
          </dialog>
        </>
      )}
    </li>
  );
}
