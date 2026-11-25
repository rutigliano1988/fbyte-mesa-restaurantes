import { z } from 'zod';
import { accentTheme, normalizeHex } from '@/lib/color';
import { LOCALES, sortLocales } from '@/lib/i18n/locales';
import { normalizeSocial, normalizeWebsite, type SocialNetwork } from '@/lib/social';
import { isValidPhone, isValidPostalCode, isValidTaxId, normalizePhone, normalizeTaxId } from '@/lib/spain';
import { slugSchema } from './schemas';

const REQUIRED = 'Este campo es obligatorio.';

/** Texto opcional: '' → null. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((v) => (v === '' ? null : v));

const description = z.string().trim().max(1000, 'La descripción puede tener como mucho 1000 caracteres.');

export const basicsSchema = z.object({
  name: z
    .string({ error: REQUIRED })
    .trim()
    .min(2, 'Escribe el nombre del restaurante (mínimo 2 letras).')
    .max(120, 'El nombre puede tener como mucho 120 caracteres.'),
  cuisine: optionalText(60, 'El tipo de cocina puede tener como mucho 60 caracteres.'),
  priceRange: z
    .enum(['', '1', '2', '3', '4'], { error: 'Elige un rango de precio.' })
    .transform((v) => (v === '' ? null : Number(v))),
  timezone: z.enum(['Europe/Madrid', 'Atlantic/Canary'], { error: 'Elige dónde está tu restaurante.' }),
  description_es: description,
  description_en: description,
  description_ca: description,
  description_fr: description,
  description_de: description,
  description_it: description,
});

export const contactSchema = z.object({
  addressLine: optionalText(200, 'La dirección puede tener como mucho 200 caracteres.').refine(
    (v) => v === null || v.length >= 3,
    'Escribe la calle y el número.',
  ),
  postalCode: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isValidPostalCode(v), 'El código postal tiene 5 cifras (por ejemplo, 28013).'),
  city: optionalText(100, 'La ciudad puede tener como mucho 100 caracteres.').refine(
    (v) => v === null || v.length >= 2,
    'Escribe la ciudad.',
  ),
  phone: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : normalizePhone(v)))
    .refine((v) => v === null || isValidPhone(v), 'Ese teléfono no parece correcto. Escribe 9 cifras, con +34 delante si quieres.'),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Ese email no parece correcto.'),
  website: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const url = normalizeWebsite(v);
      if (!url) {
        ctx.addIssue({ code: 'custom', message: 'Esa web no parece correcta (por ejemplo, https://turestaurante.es).' });
        return z.NEVER;
      }
      return url;
    }),
});

const social = (network: SocialNetwork, message: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const url = normalizeSocial(network, v);
      if (!url) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return url;
    });

export const socialSchema = z.object({
  instagram: social('instagram', 'Escribe tu usuario de Instagram (por ejemplo, @turestaurante) o el enlace a tu perfil.'),
  facebook: social('facebook', 'Pega el enlace a tu página de Facebook.'),
  tiktok: social('tiktok', 'Escribe tu usuario de TikTok (por ejemplo, @turestaurante) o el enlace a tu perfil.'),
});

export const accentColorSchema = z.object({
  accentColor: z.string({ error: REQUIRED }).transform((v, ctx) => {
    const hex = normalizeHex(v);
    if (!hex) {
      ctx.addIssue({ code: 'custom', message: 'Elige un color válido.' });
      return z.NEVER;
    }
    if (!accentTheme(hex).meetsAA) {
      ctx.addIssue({
        code: 'custom',
        message: 'Con ese color, el texto de los botones no se lee bien. Elige uno más claro o más oscuro.',
      });
      return z.NEVER;
    }
    return hex;
  }),
});

/** El castellano siempre va incluido. */
export const languagesSchema = z.object({
  locales: z.array(z.enum(LOCALES, { error: 'Elige idiomas de la lista.' })).transform((l) => sortLocales(['es', ...l])),
});

export const changeSlugSchema = z.object({ slug: slugSchema });

export const legalSchema = z.object({
  legalName: optionalText(200, 'La razón social puede tener como mucho 200 caracteres.').refine(
    (v) => v === null || v.length >= 2,
    'Escribe la razón social (o tu nombre si eres autónomo).',
  ),
  taxId: z
    .string()
    .transform((v) => normalizeTaxId(v))
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isValidTaxId(v), 'Ese CIF, NIF o NIE no parece correcto. Revisa las letras y los números.'),
});

export const publishSchema = z.object({
  accept: z.literal('on', { error: 'Tienes que aceptar el contrato para publicar.' }),
});
