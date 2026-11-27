import Link from 'next/link';

export type ReservationsSection = 'dia' | 'cuadricula' | 'bloqueos' | 'ajustes';

/** Subsecciones de «Reservas». Bloqueos y Ajustes, solo para quien configura (Administrador y Encargado). */
export function ReservationsNav({
  restaurantId,
  current,
  date,
  canConfigure,
}: {
  restaurantId: string;
  current: ReservationsSection;
  date?: string;
  canConfigure: boolean;
}) {
  const base = `/panel/${restaurantId}/reservas`;
  const q = date ? `?fecha=${date}` : '';
  const items: { key: ReservationsSection; label: string; href: string }[] = [
    { key: 'dia', label: 'Día', href: `${base}${q}` },
    { key: 'cuadricula', label: 'Cuadrícula', href: `${base}/cuadricula${q}` },
    ...(canConfigure
      ? [
          { key: 'bloqueos' as const, label: 'Bloqueos', href: `${base}/bloqueos${q}` },
          { key: 'ajustes' as const, label: 'Ajustes', href: `${base}/ajustes` },
        ]
      : []),
  ];
  return (
    <nav aria-label="Reservas" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
          className={
            'rounded-[6px] border-2 px-4 py-2 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy ' +
            (item.key === current ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white text-ink hover:bg-peach-soft')
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
