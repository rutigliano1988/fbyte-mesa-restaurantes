import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, isReservedSlug, isValidSlug, slugify } from './slug';

describe('slugify', () => {
  it('convierte un nombre en una dirección limpia', () => {
    expect(slugify('La Taberna de Pepe')).toBe('la-taberna-de-pepe');
  });
  it('quita tildes, eñes y símbolos', () => {
    expect(slugify('Café & Tapas Ñandú')).toBe('cafe-tapas-nandu');
  });
  it('recorta guiones y espacios sobrantes', () => {
    expect(slugify('  --¡Hola!!  ')).toBe('hola');
  });
  it('limita a 60 caracteres sin dejar guion final', () => {
    const s = slugify('a'.repeat(59) + ' bcd');
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it.each(['la-taberna', 'bar123', 'abc'])('acepta %s', (s) => {
    expect(isValidSlug(s)).toBe(true);
  });
  it.each(['ab', 'La-Taberna', 'bar--pepe', '-bar', 'bar-', 'bar_pepe', 'a'.repeat(61)])(
    'rechaza %s',
    (s) => {
      expect(isValidSlug(s)).toBe(false);
    },
  );
});

describe('slugs reservados', () => {
  it('incluye las rutas de la propia app', () => {
    for (const s of ['admin', 'panel', 'login', 'api', 'invitacion', 'recuperar', 'auth']) {
      expect(RESERVED_SLUGS).toContain(s);
    }
  });
  it('detecta un slug reservado', () => {
    expect(isReservedSlug('panel')).toBe(true);
    expect(isReservedSlug('la-taberna')).toBe(false);
  });
});
