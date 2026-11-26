import { describe, expect, it } from 'vitest';
import { SAMPLE_RESTAURANT } from './fixtures';
import { directionsUrl, fullAddress, localeHref, mapEmbedUrl, menuPath, menuTabHref, priceLabel, withLang } from './format';
import { jsonLdScript, restaurantJsonLd } from './jsonld';
import { languageAlternates, metaDescription, OG_LOCALE } from './seo';

const site = 'https://mesa.example.com';

describe('formato público', () => {
  it('precio, dirección y enlaces de mapa', () => {
    expect(priceLabel(3)).toBe('€€€');
    expect(priceLabel(null)).toBeNull();
    expect(fullAddress(SAMPLE_RESTAURANT)).toBe('Calle Mayor 1, 28013 Madrid');
    expect(fullAddress({ addressLine: null, postalCode: null, city: 'Madrid' })).toBe('Madrid');
    expect(directionsUrl('Calle Mayor 1, 28013 Madrid')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Calle%20Mayor%201%2C%2028013%20Madrid%2C%20Espa%C3%B1a',
    );
    expect(mapEmbedUrl('Calle Mayor 1')).toBe('https://www.google.com/maps?q=Calle%20Mayor%201%2C%20Espa%C3%B1a&output=embed');
  });

  it('localeHref añade siempre ?lang=, también en castellano', () => {
    expect(localeHref('/la-taberna', 'es')).toBe('/la-taberna?lang=es');
    expect(localeHref('/la-taberna/aviso-legal', 'de')).toBe('/la-taberna/aviso-legal?lang=de');
  });

  it('withLang solo añade ?lang= si no es castellano', () => {
    expect(withLang('/la-taberna', 'es')).toBe('/la-taberna');
    expect(withLang('/la-taberna', 'en')).toBe('/la-taberna?lang=en');
    expect(withLang('/la-taberna', null)).toBe('/la-taberna');
  });

  it('menuPath y menuTabHref llevan a la carta conservando el idioma', () => {
    expect(menuPath('la-taberna')).toBe('/la-taberna/menu');
    expect(menuTabHref('la-taberna', 'en', 'abc-123')).toBe('/la-taberna/menu?lang=en&carta=abc-123');
  });
});

describe('SEO', () => {
  it('hreflang por idioma activo y x-default', () => {
    expect(languageAlternates(site, '/la-taberna', ['es', 'en'])).toEqual({
      es: `${site}/la-taberna`,
      en: `${site}/la-taberna?lang=en`,
      'x-default': `${site}/la-taberna`,
    });
  });

  it('Open Graph usa idioma_PAÍS', () => {
    expect(OG_LOCALE).toEqual({ es: 'es_ES', en: 'en_GB', ca: 'ca_ES', fr: 'fr_FR', de: 'de_DE', it: 'it_IT' });
  });

  it('metaDescription usa la descripción del idioma y recorta a 160', () => {
    expect(metaDescription(SAMPLE_RESTAURANT, 'en')).toBe('Market cuisine downtown.');
    const long = { ...SAMPLE_RESTAURANT, descriptions: { es: 'a '.repeat(200) } };
    expect(metaDescription(long, 'es').length).toBeLessThanOrEqual(160);
    expect(metaDescription({ ...SAMPLE_RESTAURANT, descriptions: {} }, 'es')).toBe('La Taberna de Pepe · Mediterránea · Madrid');
  });
});

describe('JSON-LD', () => {
  const ld = restaurantJsonLd(SAMPLE_RESTAURANT, { url: `${site}/la-taberna`, mediaUrl: (p) => `https://cdn.test/${p}` });

  it('describe el restaurante con dirección, contacto y precio', () => {
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: 'La Taberna de Pepe',
      servesCuisine: 'Mediterránea',
      priceRange: '€€',
      telephone: '910000000',
      address: { '@type': 'PostalAddress', streetAddress: 'Calle Mayor 1', postalCode: '28013', addressLocality: 'Madrid', addressCountry: 'ES' },
      sameAs: ['https://www.instagram.com/latabernapepe'],
    });
    expect(ld.image).toEqual([`https://cdn.test/${SAMPLE_RESTAURANT.coverPath}`, `https://cdn.test/${SAMPLE_RESTAURANT.photos[0]}`]);
  });

  it('incluye el horario y los cierres', () => {
    expect(ld.openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '13:00', closes: '16:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Friday', opens: '20:00', closes: '00:30' },
    ]);
    expect(ld.specialOpeningHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', validFrom: '2026-12-24', validThrough: '2026-12-26', opens: '00:00', closes: '00:00' },
      { '@type': 'OpeningHoursSpecification', validFrom: '2026-12-31', validThrough: '2026-12-31', opens: '21:00', closes: '03:00' },
    ]);
  });

  it('jsonLdScript no deja cerrar la etiqueta script', () => {
    expect(jsonLdScript({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });

  it('hasMenu apunta a la carta cuando la hay', () => {
    expect(ld.hasMenu).toBeUndefined();
    const withMenu = restaurantJsonLd(SAMPLE_RESTAURANT, {
      url: `${site}/la-taberna`,
      mediaUrl: (p) => `https://cdn.test/${p}`,
      menuUrl: `${site}/la-taberna/menu`,
    });
    expect(withMenu.hasMenu).toBe(`${site}/la-taberna/menu`);
  });
});
