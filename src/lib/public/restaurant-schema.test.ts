import { describe, expect, it } from 'vitest';
import { SAMPLE_RESTAURANT } from './fixtures';
import { descriptionFor, parsePublicLookup } from './restaurant-schema';
import { publicRestaurantTag } from './tags';

const raw = {
  id: SAMPLE_RESTAURANT.id,
  slug: 'la-taberna',
  name: 'La Taberna de Pepe',
  timezone: 'Europe/Madrid',
  enabled_locales: ['en', 'es'],
  cuisine: 'Mediterránea',
  price_range: 2,
  address_line: 'Calle Mayor 1',
  postal_code: '28013',
  city: 'Madrid',
  phone: '910000000',
  contact_email: 'hola@lataberna.es',
  website: 'https://lataberna.es',
  instagram: 'https://www.instagram.com/latabernapepe',
  facebook: null,
  tiktok: null,
  accent_color: '#17317F',
  logo_path: SAMPLE_RESTAURANT.logoPath,
  cover_path: SAMPLE_RESTAURANT.coverPath,
  legal_name: 'Taberna Pepe SL',
  tax_id: 'B12345674',
  descriptions: { es: 'Cocina de mercado en el centro.', en: 'Market cuisine downtown.' },
  photos: SAMPLE_RESTAURANT.photos,
  services: [
    { name: 'Comida', weekday: 1, start_minute: 780, end_minute: 960 },
    { name: 'Cena', weekday: 5, start_minute: 1200, end_minute: 1470 },
  ],
  exceptions: [
    { date_from: '2026-12-24', date_to: '2026-12-26', kind: 'closed', custom_services: [], note: 'Navidad' },
    { date_from: '2026-12-31', date_to: '2026-12-31', kind: 'custom', custom_services: [{ name: 'Cena', start_minute: 1260, end_minute: 1620 }], note: null },
  ],
};

describe('parsePublicLookup', () => {
  it('convierte el JSON de la BD al formato de la app', () => {
    expect(parsePublicLookup(raw)).toEqual({ kind: 'restaurant', restaurant: SAMPLE_RESTAURANT });
  });

  it('reconoce redirecciones y restaurantes que no existen', () => {
    expect(parsePublicLookup({ redirect: 'nuevo-slug' })).toEqual({ kind: 'redirect', slug: 'nuevo-slug' });
    expect(parsePublicLookup(null)).toBeNull();
  });

  it('falla si la BD devuelve algo inesperado', () => {
    expect(() => parsePublicLookup({ ...raw, services: [{ weekday: 9 }] })).toThrow();
  });
});

it('descriptionFor cae al castellano si falta el idioma', () => {
  expect(descriptionFor(SAMPLE_RESTAURANT, 'en')).toBe('Market cuisine downtown.');
  expect(descriptionFor(SAMPLE_RESTAURANT, 'fr')).toBe('Cocina de mercado en el centro.');
  expect(descriptionFor({ ...SAMPLE_RESTAURANT, descriptions: {} }, 'fr')).toBeNull();
});

it('publicRestaurantTag usa la dirección pública', () => {
  expect(publicRestaurantTag('la-taberna')).toBe('public-restaurant:la-taberna');
});
