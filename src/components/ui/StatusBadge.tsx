import type { RestaurantStatus } from '@/lib/auth/guards';

const LABELS: Record<RestaurantStatus, { text: string; className: string }> = {
  setup: { text: 'En configuración', className: 'bg-peach text-ink' },
  active: { text: 'Activo', className: 'bg-navy text-white' },
  disabled: { text: 'Desactivado', className: 'bg-ink/10 text-muted' },
};

export function StatusBadge({ status }: { status: RestaurantStatus }) {
  const s = LABELS[status];
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${s.className}`}>{s.text}</span>;
}
