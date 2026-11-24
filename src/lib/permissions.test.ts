import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, can, type Permission, type Role } from './permissions';

// Matriz de la spec §3.1
const expected: Record<Permission, Role[]> = {
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
};

describe('can', () => {
  for (const [permission, roles] of Object.entries(expected) as [Permission, Role[]][]) {
    for (const role of ['admin', 'manager', 'staff'] as Role[]) {
      it(`${role} ${roles.includes(role) ? 'puede' : 'no puede'} ${permission}`, () => {
        expect(can(role, permission)).toBe(roles.includes(role));
      });
    }
  }
});

it('etiquetas de rol en castellano', () => {
  expect(ROLE_LABELS).toEqual({ admin: 'Administrador', manager: 'Encargado', staff: 'Sala/Recepción' });
});
