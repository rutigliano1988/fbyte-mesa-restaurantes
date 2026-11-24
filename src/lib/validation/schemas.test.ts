import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '../forms';
import { createRestaurantSchema, inviteMemberSchema, newAccountSchema, newPasswordSchema } from './schemas';

describe('createRestaurantSchema', () => {
  it('normaliza los datos', () => {
    const r = createRestaurantSchema.parse({ name: '  La Taberna ', slug: ' La-Taberna ', adminEmail: ' Pepe@Example.COM ' });
    expect(r).toEqual({ name: 'La Taberna', slug: 'la-taberna', adminEmail: 'pepe@example.com' });
  });

  it('rechaza slugs reservados o mal formados con mensajes en castellano', () => {
    const r = createRestaurantSchema.safeParse({ name: 'X', slug: 'panel', adminEmail: 'no' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error)).toEqual({
      name: 'Escribe el nombre del restaurante (mínimo 2 letras).',
      slug: 'Esa dirección está reservada. Prueba con otra.',
      adminEmail: 'Ese email no parece correcto.',
    });
    const r2 = createRestaurantSchema.safeParse({ name: 'Bar', slug: 'bar pepe', adminEmail: 'a@b.es' });
    expect(r2.success).toBe(false);
  });
});

describe('otros esquemas', () => {
  it('inviteMemberSchema solo acepta roles válidos', () => {
    expect(inviteMemberSchema.safeParse({ email: 'a@b.es', role: 'staff' }).success).toBe(true);
    expect(inviteMemberSchema.safeParse({ email: 'a@b.es', role: 'owner' }).success).toBe(false);
  });

  it('las contraseñas tienen al menos 8 caracteres y deben coincidir', () => {
    expect(newAccountSchema.safeParse({ fullName: 'Pepe', password: 'corta' }).success).toBe(false);
    expect(newAccountSchema.safeParse({ fullName: 'Pepe', password: 'larga-segura' }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: 'larga-segura', confirm: 'otra-cosa' }).success).toBe(false);
  });
});
