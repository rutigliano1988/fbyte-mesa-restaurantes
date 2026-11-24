export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Debe coincidir exactamente con la tabla public.reserved_slugs (lo comprueba tests/db/base.test.ts). */
export const RESERVED_SLUGS = [
  'admin',
  'panel',
  'login',
  'logout',
  'api',
  'auth',
  'invitacion',
  'recuperar',
  'nueva-contrasena',
  'legal',
  'privacidad',
  'cookies',
  'aviso-legal',
  'ayuda',
  'soporte',
  'static',
  'public',
  'assets',
  'brand',
  'www',
  'mesa',
  'fbyte',
] as const;

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 60 && SLUG_PATTERN.test(slug);
}
