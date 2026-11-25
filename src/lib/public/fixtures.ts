import type { PublicRestaurant } from './restaurant-schema';

/** Restaurante de ejemplo para las pruebas unitarias. */
export const SAMPLE_RESTAURANT: PublicRestaurant = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'la-taberna',
  name: 'La Taberna de Pepe',
  timezone: 'Europe/Madrid',
  enabledLocales: ['es', 'en'],
  cuisine: 'Mediterránea',
  priceRange: 2,
  addressLine: 'Calle Mayor 1',
  postalCode: '28013',
  city: 'Madrid',
  phone: '910000000',
  contactEmail: 'hola@lataberna.es',
  website: 'https://lataberna.es',
  instagram: 'https://www.instagram.com/latabernapepe',
  facebook: null,
  tiktok: null,
  accentColor: '#17317F',
  logoPath: '11111111-1111-4111-8111-111111111111/logo-a.webp',
  coverPath: '11111111-1111-4111-8111-111111111111/cover-b.webp',
  legalName: 'Taberna Pepe SL',
  taxId: 'B12345674',
  descriptions: { es: 'Cocina de mercado en el centro.', en: 'Market cuisine downtown.' },
  photos: ['11111111-1111-4111-8111-111111111111/gallery/c.webp'],
  services: [
    { name: 'Comida', weekday: 1, startMinute: 780, endMinute: 960 },
    { name: 'Cena', weekday: 5, startMinute: 1200, endMinute: 1470 },
  ],
  exceptions: [
    { dateFrom: '2026-12-24', dateTo: '2026-12-26', kind: 'closed', customServices: [], note: 'Navidad' },
    {
      dateFrom: '2026-12-31',
      dateTo: '2026-12-31',
      kind: 'custom',
      customServices: [{ name: 'Cena', startMinute: 1260, endMinute: 1620 }],
      note: null,
    },
  ],
};
