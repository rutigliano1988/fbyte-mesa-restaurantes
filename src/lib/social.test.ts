import { describe, expect, it } from 'vitest';
import { normalizeSocial, normalizeWebsite, socialHandle } from './social';

describe('normalizeSocial', () => {
  it('Instagram: usuario, @usuario o enlace', () => {
    const want = 'https://www.instagram.com/la.taberna_pepe';
    for (const input of ['la.taberna_pepe', '@la.taberna_pepe', 'instagram.com/la.taberna_pepe/', 'https://www.instagram.com/la.taberna_pepe?igsh=abc']) {
      expect(normalizeSocial('instagram', input), input).toBe(want);
    }
  });

  it('TikTok siempre lleva @ en la URL', () => {
    expect(normalizeSocial('tiktok', 'pepebar')).toBe('https://www.tiktok.com/@pepebar');
    expect(normalizeSocial('tiktok', 'https://www.tiktok.com/@pepebar/video/123')).toBe('https://www.tiktok.com/@pepebar');
  });

  it('Facebook: página o perfil por id', () => {
    expect(normalizeSocial('facebook', 'm.facebook.com/Taberna-Pepe')).toBe('https://www.facebook.com/Taberna-Pepe');
    expect(normalizeSocial('facebook', 'https://www.facebook.com/profile.php?id=100064123456')).toBe(
      'https://www.facebook.com/profile.php?id=100064123456',
    );
  });

  it('rechaza otras webs y usuarios imposibles', () => {
    expect(normalizeSocial('instagram', 'https://twitter.com/pepe')).toBeNull();
    expect(normalizeSocial('instagram', 'pepe bar')).toBeNull();
    expect(normalizeSocial('tiktok', 'a')).toBeNull();
    expect(normalizeSocial('facebook', 'facebook.com/profile.php')).toBeNull();
    expect(normalizeSocial('instagram', '')).toBeNull();
  });
});

describe('normalizeSocial: entradas malformadas y no-perfiles', () => {
  it('no lanza con porcentajes mal codificados', () => {
    expect(() => normalizeSocial('instagram', 'instagram.com/%E0%A4%A')).not.toThrow();
    expect(normalizeSocial('instagram', 'instagram.com/%E0%A4%A')).toBeNull();
  });

  it('rechaza publicaciones y rutas que no son un perfil', () => {
    for (const [network, input] of [
      ['instagram', 'instagram.com/p/ABC123'],
      ['instagram', 'https://www.instagram.com/reel/x'],
      ['instagram', 'https://www.instagram.com/explore/tags/x'],
      ['facebook', 'facebook.com/groups/123'],
      ['facebook', 'https://www.facebook.com/sharer'],
      ['facebook', 'https://www.facebook.com/events/123'],
      ['tiktok', 'tiktok.com/discover'],
      ['tiktok', 'https://www.tiktok.com/tag/comida'],
      ['tiktok', 'https://www.tiktok.com/pepebar'],
    ] as const) {
      expect(normalizeSocial(network, input), input).toBeNull();
    }
  });

  it('un dominio sin usuario no es un perfil', () => {
    for (const [network, input] of [
      ['instagram', 'instagram.com'],
      ['instagram', 'www.instagram.com'],
      ['facebook', 'facebook.com'],
      ['tiktok', 'tiktok.com'],
      ['tiktok', 'https://www.tiktok.com/'],
    ] as const) {
      expect(normalizeSocial(network, input), input).toBeNull();
    }
  });
});

describe('normalizeWebsite', () => {
  it('añade https y pasa http a https', () => {
    expect(normalizeWebsite('pepe.es')).toBe('https://pepe.es');
    expect(normalizeWebsite('http://www.pepe.es/carta')).toBe('https://www.pepe.es/carta');
    expect(normalizeWebsite('https://pepe.es/')).toBe('https://pepe.es');
  });

  it('rechaza lo que no es una web', () => {
    for (const bad of ['pepe', 'ftp://pepe.es', 'https://user:pass@pepe.es', 'pepe .es', '']) {
      expect(normalizeWebsite(bad), bad).toBeNull();
    }
  });
});

it('socialHandle muestra el usuario', () => {
  expect(socialHandle('https://www.instagram.com/pepe')).toBe('@pepe');
  expect(socialHandle('https://www.tiktok.com/@pepe')).toBe('@pepe');
  expect(socialHandle('https://www.facebook.com/profile.php?id=123456')).toBe('Facebook');
});

it('socialHandle no lanza con un valor guardado corrupto', () => {
  expect(() => socialHandle('esto no es una url')).not.toThrow();
  expect(socialHandle('esto no es una url')).toBe('esto no es una url');
});
