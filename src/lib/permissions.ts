export type Role = 'admin' | 'manager' | 'staff';
export const ROLES = ['admin', 'manager', 'staff'] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  manager: 'Encargado',
  staff: 'Sala/Recepción',
};

const MATRIX = {
  'reservations.manage': ['admin', 'manager', 'staff'],
  'customers.view': ['admin', 'manager', 'staff'],
  'menu.edit': ['admin', 'manager'],
  'menu.toggle_unavailable': ['admin', 'manager', 'staff'],
  'settings.booking': ['admin', 'manager'],
  'stats.view': ['admin', 'manager'],
  'restaurant.edit': ['admin'],
  'users.manage': ['admin'],
  'customers.export': ['admin'],
  'customers.delete': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: Role, permission: Permission): boolean {
  return (MATRIX[permission] as readonly Role[]).includes(role);
}
