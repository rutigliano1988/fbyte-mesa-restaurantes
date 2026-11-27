import { can, type Permission, type Role } from './permissions';

export type NavItem = { href: string; label: string };

// Cada hito añade aquí sus secciones (Local, Menú, Reservas, Clientes, Estadísticas).
const ITEMS: { path: string; label: string; permission: Permission | null }[] = [
  { path: '', label: 'Inicio', permission: null },
  { path: '/reservas', label: 'Reservas', permission: 'reservations.manage' },
  { path: '/local', label: 'Local', permission: 'restaurant.edit' },
  // Sala también entra: ahí marca los platos agotados.
  { path: '/menu', label: 'Menú', permission: 'menu.toggle_unavailable' },
  { path: '/horario', label: 'Horario', permission: 'settings.booking' },
  { path: '/usuarios', label: 'Equipo', permission: 'users.manage' },
];

export function panelNav(restaurantId: string, role: Role): NavItem[] {
  return ITEMS.filter((i) => i.permission === null || can(role, i.permission)).map((i) => ({
    href: `/panel/${restaurantId}${i.path}`,
    label: i.label,
  }));
}
