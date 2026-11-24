import { z } from 'zod';
import { SLUG_PATTERN, isReservedSlug } from '@/lib/slug';
import { ROLES } from '@/lib/permissions';

const REQUIRED = 'Este campo es obligatorio.';
const NAME_MAX = 'El nombre puede tener como mucho 120 caracteres.';

const email = z
  .string({ error: REQUIRED })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Ese email no parece correcto.' }));

const password = z
  .string({ error: REQUIRED })
  .min(8, 'La contraseña necesita al menos 8 caracteres.')
  .max(72, 'La contraseña puede tener como mucho 72 caracteres.');

export const uuidSchema = z.uuid();

export const loginSchema = z.object({
  email,
  password: z.string({ error: REQUIRED }).min(1, 'Escribe tu contraseña.'),
});

export const emailOnlySchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password, confirm: z.string({ error: REQUIRED }) })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });

export const slugSchema = z
  .string({ error: REQUIRED })
  .trim()
  .toLowerCase()
  .min(3, 'La dirección necesita al menos 3 caracteres.')
  .max(60, 'La dirección puede tener como mucho 60 caracteres.')
  .regex(SLUG_PATTERN, 'Solo minúsculas, números y guiones (por ejemplo: la-taberna-de-pepe).')
  .refine((s) => !isReservedSlug(s), 'Esa dirección está reservada. Prueba con otra.');

export const createRestaurantSchema = z.object({
  name: z
    .string({ error: REQUIRED })
    .trim()
    .min(2, 'Escribe el nombre del restaurante (mínimo 2 letras).')
    .max(120, NAME_MAX),
  slug: slugSchema,
  adminEmail: email,
});

export const inviteMemberSchema = z.object({
  email,
  role: z.enum(ROLES, { error: 'Elige un rol.' }),
});

export const newAccountSchema = z.object({
  fullName: z
    .string({ error: REQUIRED })
    .trim()
    .min(2, 'Escribe tu nombre.')
    .max(120, NAME_MAX),
  password,
});
