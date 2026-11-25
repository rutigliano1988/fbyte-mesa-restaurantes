import { describe, expect, it } from 'vitest';
import { isLocale, parseAcceptLanguage, resolveLocale, sortLocales } from './locales';

describe('parseAcceptLanguage', () => {
  it('ordena por calidad y respeta el orden ante empates', () => {
    expect(parseAcceptLanguage('fr;q=0.5, ca-ES, en;q=0.8, de')).toEqual(['ca-es', 'de', 'en', 'fr']);
  });

  it('ignora comodines, calidades 0 y cabeceras vacías', () => {
    expect(parseAcceptLanguage('*, en;q=0, it;q=abc')).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe('resolveLocale', () => {
  const enabled = ['es', 'en', 'ca'];

  it('?lang= manda si el idioma está activo', () => {
    expect(resolveLocale({ lang: 'EN', acceptLanguage: 'ca', enabled })).toBe('en');
  });

  it('?lang= de un idioma no activo se ignora', () => {
    expect(resolveLocale({ lang: 'fr', acceptLanguage: 'ca-ES', enabled })).toBe('ca');
    expect(resolveLocale({ lang: 'xx', acceptLanguage: null, enabled })).toBe('es');
  });

  it('usa el primer idioma del navegador que esté activo', () => {
    expect(resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9,en-GB;q=0.8', enabled })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'ca-ES-valencia', enabled })).toBe('ca');
  });

  it('el respaldo es el castellano', () => {
    expect(resolveLocale({ acceptLanguage: 'ja', enabled })).toBe('es');
    expect(resolveLocale({ enabled: ['es'] })).toBe('es');
  });
});

it('isLocale y sortLocales', () => {
  expect(isLocale('ca')).toBe(true);
  expect(isLocale('pt')).toBe(false);
  expect(sortLocales(['it', 'pt', 'es', 'it', 'en'])).toEqual(['es', 'en', 'it']);
});
