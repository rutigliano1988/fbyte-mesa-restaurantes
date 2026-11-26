import type { ReactNode, SVGProps } from 'react';
import type { Allergen } from '@/lib/menu/codes';

/**
 * Pictogramas de alérgenos dibujados para Mesa: línea de 1,75 sobre 24 × 24, sin licencias de terceros.
 * Son decorativos: siempre van con el nombre del alérgeno al lado (AllergenLabel).
 */
const ICONS: Record<Allergen, ReactNode> = {
  // Espiga de trigo
  gluten: (
    <>
      <path d="M12 21V7" />
      <path d="M12 7c-1.5-1-1.5-3.5 0-4.5 1.5 1 1.5 3.5 0 4.5z" />
      <path d="M12 11c-2.2.2-3.8-1.2-4-3.4 2.2-.2 3.8 1.2 4 3.4z" />
      <path d="M12 11c2.2.2 3.8-1.2 4-3.4-2.2-.2-3.8 1.2-4 3.4z" />
      <path d="M12 15.5c-2.2.2-3.8-1.2-4-3.4 2.2-.2 3.8 1.2 4 3.4z" />
      <path d="M12 15.5c2.2.2 3.8-1.2 4-3.4-2.2-.2-3.8 1.2-4 3.4z" />
    </>
  ),
  // Gamba
  crustaceans: (
    <>
      <path d="M7 6.5c4-2.5 10-.5 10.5 5S13 20 8.5 18.5" />
      <path d="M8.5 18.5 5 20.5m3.5-2L7 21.5" />
      <path d="M11 10.5 8.5 12M13.5 13 11 14.5M14 16.5l-2.5.5" />
      <path d="M7 6.5 3.5 4.5M7 6.5 4 8.5" />
      <circle cx="9" cy="7.5" r=".6" />
    </>
  ),
  // Huevo
  eggs: <path d="M12 3c-3.5 0-6 5.2-6 9.6a6 6 0 0 0 12 0C18 8.2 15.5 3 12 3z" />,
  // Pez
  fish: (
    <>
      <path d="M2.5 12c3-4.5 9.5-5.5 14 0-4.5 5.5-11 4.5-14 0z" />
      <path d="M16.5 12 21 8.5v7z" />
      <circle cx="7" cy="11.2" r=".7" />
    </>
  ),
  // Cacahuete con cáscara
  peanuts: (
    <>
      <path d="M12 3a4 4 0 0 1 4 4c0 2-1.2 3-1.2 5s1.2 3 1.2 5a4 4 0 0 1-8 0c0-2 1.2-3 1.2-5S8 9 8 7a4 4 0 0 1 4-4z" />
      <path d="M11 7h.01M13 9h.01M11 15h.01M13 17h.01" />
    </>
  ),
  // Vaina de soja
  soy: (
    <>
      <path d="M4 20C4 11.5 10.5 4 19.5 4c.3 0 .5.2.5.5C20 13.5 12.5 20 4.5 20.5c-.3 0-.5-.2-.5-.5z" />
      <circle cx="9" cy="15" r="1.6" />
      <circle cx="12.3" cy="11.7" r="1.6" />
      <circle cx="15.6" cy="8.4" r="1.6" />
    </>
  ),
  // Botella de leche
  milk: (
    <>
      <path d="M10 3h4v3l2 3.5V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.5L10 6z" />
      <path d="M8 13h8" />
    </>
  ),
  // Avellana con su caperuza
  nuts: (
    <>
      <path d="M5 10.5C5 6.9 8.1 4.5 12 4.5s7 2.4 7 6z" />
      <path d="M6.5 10.5c0 5 2.5 9 5.5 10 3-1 5.5-5 5.5-10" />
      <path d="M12 4.5V2.5" />
    </>
  ),
  // Tallos de apio
  celery: (
    <>
      <path d="M9 21V10.5M12 21V8.5M15 21V10.5M7.5 21h9" />
      <path d="M9 10.5C7 9.5 6 7.5 7 5.5c2 0 3 2 2 5zM12 8.5c-1.5-1.5-1.5-4 0-5.5 1.5 1.5 1.5 4 0 5.5zM15 10.5c2-1 3-3 2-5-2 0-3 2-2 5z" />
    </>
  ),
  // Tarro de mostaza
  mustard: (
    <>
      <rect x="9" y="3" width="6" height="3.5" rx="1" />
      <path d="M8.5 6.5h7l1.5 3V19a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9.5z" />
      <path d="M7 13.5h10" />
    </>
  ),
  // Semillas de sésamo
  sesame: (
    <>
      <path d="M8 3.5c2 2 2 5 0 7-2-2-2-5 0-7z" />
      <path d="M16 6c2 2 2 5 0 7-2-2-2-5 0-7z" />
      <path d="M10.5 13c2 2 2 5 0 7-2-2-2-5 0-7z" />
    </>
  ),
  // Copa de vino y «SO₂»
  sulphites: (
    <>
      <path d="M4.5 3h7l-.6 4.6a2.9 2.9 0 0 1-5.8 0z" />
      <path d="M8 10.5V17M5.5 17h5" />
      <text x="12.5" y="21" fill="currentColor" stroke="none" fontSize="6.5" fontWeight="700" fontFamily="inherit">
        SO₂
      </text>
    </>
  ),
  // Flor de altramuz
  lupin: (
    <>
      <path d="M12 21v-7" />
      <circle cx="12" cy="4.5" r="1.5" />
      <circle cx="9.5" cy="8" r="1.5" />
      <circle cx="14.5" cy="8" r="1.5" />
      <circle cx="9.5" cy="12" r="1.5" />
      <circle cx="14.5" cy="12" r="1.5" />
      <path d="M12 18c-2.5 0-4-1.2-4.5-3M12 18c2.5 0 4-1.2 4.5-3" />
    </>
  ),
  // Concha de mejillón
  molluscs: (
    <>
      <path d="M12 21c-5-3-8-8-6.5-13C7 4 11 2.5 14 3.5c4 1.5 5.5 6 4.5 10-1 3.5-3.5 6-6.5 7.5z" />
      <path d="M12 21c-.5-5 0-11 2-17.5M12 21c-2.5-4-3.5-9-3-14" />
    </>
  ),
};

export function AllergenIcon({
  allergen,
  className = 'size-5 shrink-0',
  ...props
}: { allergen: Allergen } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {ICONS[allergen]}
    </svg>
  );
}

/** Icono y nombre del alérgeno: el icono nunca va solo. */
export function AllergenLabel({ allergen, name, className = '' }: { allergen: Allergen; name: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <AllergenIcon allergen={allergen} />
      <span>{name}</span>
    </span>
  );
}
