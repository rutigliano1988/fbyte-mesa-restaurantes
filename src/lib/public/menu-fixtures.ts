const RID = '11111111-1111-4111-8111-111111111111';

const croquetas = {
  id: 'd-croquetas',
  names: { es: 'Croquetas', en: 'Croquettes' },
  descriptions: { es: 'De jamón ibérico.' },
  photo_path: `${RID}/dishes/croquetas.webp`,
  allergens: ['milk', 'gluten'],
  tags: ['recommended'],
  unavailable: false,
  prices: [
    { kind: 'fixed', price_cents: 900, labels: { es: 'Media', en: 'Half' } },
    { kind: 'fixed', price_cents: 1500, labels: { es: 'Ración' } },
  ],
};

const noSchedule = { price_cents: null, includes: {}, weekdays: null, start_minute: null, end_minute: null, date_from: null, date_to: null };

/** Lo que devuelve public.get_public_menu() (snake_case), para las pruebas. */
export const SAMPLE_MENU_JSON = {
  unavailable_mode: 'strike',
  menus: [
    {
      id: 'carta-1',
      kind: 'carta',
      names: { es: 'Carta', en: 'Menu' },
      ...noSchedule,
      sections: [
        {
          id: 'entrantes',
          names: { es: 'Entrantes', en: 'Starters' },
          items: [
            { id: 'i-croquetas', inline_names: null, inline_allergens: [], dish: croquetas },
            {
              id: 'i-ensalada',
              inline_names: null,
              inline_allergens: [],
              dish: {
                id: 'd-ensalada',
                names: { es: 'Ensalada de la huerta' },
                descriptions: {},
                photo_path: null,
                allergens: [],
                tags: ['gluten_free', 'vegan'],
                unavailable: true,
                prices: [{ kind: 'fixed', price_cents: 850, labels: {} }],
              },
            },
          ],
        },
        {
          id: 'principales',
          names: { es: 'Principales' },
          items: [
            {
              id: 'i-chuleton',
              inline_names: null,
              inline_allergens: [],
              dish: {
                id: 'd-chuleton',
                names: { es: 'Chuletón' },
                descriptions: {},
                photo_path: null,
                allergens: [],
                tags: [],
                unavailable: false,
                prices: [{ kind: 'per_kg', price_cents: 4500, labels: {} }],
              },
            },
            {
              id: 'i-pescado',
              inline_names: null,
              inline_allergens: [],
              dish: {
                id: 'd-pescado',
                names: { es: 'Pescado del día' },
                descriptions: {},
                photo_path: null,
                allergens: ['fish'],
                tags: [],
                unavailable: false,
                prices: [{ kind: 'market', price_cents: null, labels: {} }],
              },
            },
          ],
        },
        { id: 'vacia', names: { es: 'Sin platos' }, items: [] },
      ],
    },
    {
      id: 'daily-1',
      kind: 'daily',
      names: { es: 'Menú del día' },
      price_cents: 1450,
      includes: { es: 'Pan, bebida y postre' },
      weekdays: [1, 2, 3, 4, 5],
      start_minute: 780,
      end_minute: 960,
      date_from: null,
      date_to: null,
      sections: [
        {
          id: 'primeros',
          names: { es: 'Primeros' },
          items: [
            { id: 'i-sopa', inline_names: { es: 'Sopa de pescado' }, inline_allergens: ['celery', 'fish'], dish: null },
            { id: 'i-croquetas-2', inline_names: null, inline_allergens: [], dish: croquetas },
          ],
        },
      ],
    },
    { id: 'bebidas', kind: 'carta', names: { es: 'Bebidas' }, ...noSchedule, sections: [{ id: 'refrescos', names: { es: 'Refrescos' }, items: [] }] },
  ],
};
