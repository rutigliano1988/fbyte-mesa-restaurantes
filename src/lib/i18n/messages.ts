import type { Locale } from './locales';

/** Textos de la interfaz pública (mini-web). Los textos del restaurante los escribe el restaurante. */
export type PublicMessages = {
  directions: string;
  viewMap: string;
  mapNotice: string;
  mapTitle: (name: string) => string;
  about: string;
  gallery: string;
  hours: string;
  closed: string;
  noHours: string;
  /** Lunes … domingo. */
  weekdays: readonly [string, string, string, string, string, string, string];
  upcoming: string;
  closedOn: (from: string, to: string) => string;
  specialOn: (from: string, to: string) => string;
  contact: string;
  address: string;
  phone: string;
  call: string;
  email: string;
  website: string;
  social: string;
  language: string;
  price: string;
  legalNotice: string;
  legalSpanishOnly: string;
  backToRestaurant: string;
  poweredBy: (product: string, company: string) => string;
  logoAlt: (name: string) => string;
  coverAlt: (name: string) => string;
  photoAlt: (name: string, n: number) => string;
};

const es: PublicMessages = {
  directions: 'Cómo llegar',
  viewMap: 'Ver mapa',
  mapNotice: 'El mapa lo carga Google Maps, que puede usar cookies.',
  mapTitle: (name) => `Mapa de ${name}`,
  about: 'Sobre nosotros',
  gallery: 'Fotos',
  hours: 'Horario',
  closed: 'Cerrado',
  noHours: 'Consulta el horario con el restaurante.',
  weekdays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
  upcoming: 'Próximos cierres y horarios especiales',
  closedOn: (from, to) => (from === to ? `Cerrado el ${from}` : `Cerrado del ${from} al ${to}`),
  specialOn: (from, to) => (from === to ? `Horario especial el ${from}` : `Horario especial del ${from} al ${to}`),
  contact: 'Contacto',
  address: 'Dirección',
  phone: 'Teléfono',
  call: 'Llamar',
  email: 'Email',
  website: 'Web',
  social: 'Síguenos',
  language: 'Idioma',
  price: 'Precio',
  legalNotice: 'Aviso legal',
  legalSpanishOnly: '',
  backToRestaurant: 'Volver a la web del restaurante',
  poweredBy: (product, company) => `Reservas y menú con ${product} · ${company}`,
  logoAlt: (name) => `Logo de ${name}`,
  coverAlt: (name) => `Foto de ${name}`,
  photoAlt: (name, n) => `Foto ${n} de ${name}`,
};

const en: PublicMessages = {
  directions: 'Get directions',
  viewMap: 'Show map',
  mapNotice: 'The map is loaded from Google Maps, which may use cookies.',
  mapTitle: (name) => `Map of ${name}`,
  about: 'About us',
  gallery: 'Photos',
  hours: 'Opening hours',
  closed: 'Closed',
  noHours: 'Please ask the restaurant for its opening hours.',
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  upcoming: 'Upcoming closures and special hours',
  closedOn: (from, to) => (from === to ? `Closed on ${from}` : `Closed from ${from} to ${to}`),
  specialOn: (from, to) => (from === to ? `Special hours on ${from}` : `Special hours from ${from} to ${to}`),
  contact: 'Contact',
  address: 'Address',
  phone: 'Phone',
  call: 'Call',
  email: 'Email',
  website: 'Website',
  social: 'Follow us',
  language: 'Language',
  price: 'Price',
  legalNotice: 'Legal notice',
  legalSpanishOnly: 'This legal notice is only available in Spanish.',
  backToRestaurant: 'Back to the restaurant',
  poweredBy: (product, company) => `Bookings and menu by ${product} · ${company}`,
  logoAlt: (name) => `${name} logo`,
  coverAlt: (name) => `Photo of ${name}`,
  photoAlt: (name, n) => `Photo ${n} of ${name}`,
};

const ca: PublicMessages = {
  directions: 'Com arribar-hi',
  viewMap: 'Veure el mapa',
  mapNotice: 'El mapa el carrega Google Maps, que pot fer servir galetes.',
  mapTitle: (name) => `Mapa de ${name}`,
  about: 'Qui som',
  gallery: 'Fotos',
  hours: 'Horari',
  closed: 'Tancat',
  noHours: 'Consulta l’horari amb el restaurant.',
  weekdays: ['Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte', 'Diumenge'],
  upcoming: 'Propers tancaments i horaris especials',
  closedOn: (from, to) => (from === to ? `Tancat el ${from}` : `Tancat del ${from} al ${to}`),
  specialOn: (from, to) => (from === to ? `Horari especial el ${from}` : `Horari especial del ${from} al ${to}`),
  contact: 'Contacte',
  address: 'Adreça',
  phone: 'Telèfon',
  call: 'Trucar',
  email: 'Correu electrònic',
  website: 'Web',
  social: 'Segueix-nos',
  language: 'Idioma',
  price: 'Preu',
  legalNotice: 'Avís legal',
  legalSpanishOnly: 'Aquest avís legal només està disponible en castellà.',
  backToRestaurant: 'Tornar al web del restaurant',
  poweredBy: (product, company) => `Reserves i carta amb ${product} · ${company}`,
  logoAlt: (name) => `Logotip de ${name}`,
  coverAlt: (name) => `Foto de ${name}`,
  photoAlt: (name, n) => `Foto ${n} de ${name}`,
};

const fr: PublicMessages = {
  directions: 'Itinéraire',
  viewMap: 'Voir la carte',
  mapNotice: 'La carte est chargée depuis Google Maps, qui peut utiliser des cookies.',
  mapTitle: (name) => `Carte de ${name}`,
  about: 'À propos',
  gallery: 'Photos',
  hours: 'Horaires',
  closed: 'Fermé',
  noHours: 'Renseignez-vous auprès du restaurant pour les horaires.',
  weekdays: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  upcoming: 'Prochaines fermetures et horaires spéciaux',
  closedOn: (from, to) => (from === to ? `Fermé le ${from}` : `Fermé du ${from} au ${to}`),
  specialOn: (from, to) => (from === to ? `Horaires spéciaux le ${from}` : `Horaires spéciaux du ${from} au ${to}`),
  contact: 'Contact',
  address: 'Adresse',
  phone: 'Téléphone',
  call: 'Appeler',
  email: 'E-mail',
  website: 'Site web',
  social: 'Suivez-nous',
  language: 'Langue',
  price: 'Prix',
  legalNotice: 'Mentions légales',
  legalSpanishOnly: 'Ces mentions légales ne sont disponibles qu’en espagnol.',
  backToRestaurant: 'Retour au restaurant',
  poweredBy: (product, company) => `Réservations et menu avec ${product} · ${company}`,
  logoAlt: (name) => `Logo de ${name}`,
  coverAlt: (name) => `Photo de ${name}`,
  photoAlt: (name, n) => `Photo ${n} de ${name}`,
};

const de: PublicMessages = {
  directions: 'Route planen',
  viewMap: 'Karte anzeigen',
  mapNotice: 'Die Karte wird von Google Maps geladen, das Cookies verwenden kann.',
  mapTitle: (name) => `Karte von ${name}`,
  about: 'Über uns',
  gallery: 'Fotos',
  hours: 'Öffnungszeiten',
  closed: 'Geschlossen',
  noHours: 'Bitte fragen Sie das Restaurant nach den Öffnungszeiten.',
  weekdays: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  upcoming: 'Kommende Schließtage und Sonderöffnungszeiten',
  closedOn: (from, to) => (from === to ? `Geschlossen am ${from}` : `Geschlossen vom ${from} bis ${to}`),
  specialOn: (from, to) => (from === to ? `Sonderöffnungszeiten am ${from}` : `Sonderöffnungszeiten vom ${from} bis ${to}`),
  contact: 'Kontakt',
  address: 'Adresse',
  phone: 'Telefon',
  call: 'Anrufen',
  email: 'E-Mail',
  website: 'Website',
  social: 'Folgen Sie uns',
  language: 'Sprache',
  price: 'Preis',
  legalNotice: 'Impressum',
  legalSpanishOnly: 'Dieses Impressum ist nur auf Spanisch verfügbar.',
  backToRestaurant: 'Zurück zum Restaurant',
  poweredBy: (product, company) => `Reservierungen und Speisekarte mit ${product} · ${company}`,
  logoAlt: (name) => `Logo von ${name}`,
  coverAlt: (name) => `Foto von ${name}`,
  photoAlt: (name, n) => `Foto ${n} von ${name}`,
};

const it: PublicMessages = {
  directions: 'Indicazioni',
  viewMap: 'Mostra la mappa',
  mapNotice: 'La mappa viene caricata da Google Maps, che può usare cookie.',
  mapTitle: (name) => `Mappa di ${name}`,
  about: 'Chi siamo',
  gallery: 'Foto',
  hours: 'Orari',
  closed: 'Chiuso',
  noHours: 'Chiedi gli orari al ristorante.',
  weekdays: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
  upcoming: 'Prossime chiusure e orari speciali',
  closedOn: (from, to) => (from === to ? `Chiuso il ${from}` : `Chiuso dal ${from} al ${to}`),
  specialOn: (from, to) => (from === to ? `Orario speciale il ${from}` : `Orario speciale dal ${from} al ${to}`),
  contact: 'Contatti',
  address: 'Indirizzo',
  phone: 'Telefono',
  call: 'Chiama',
  email: 'Email',
  website: 'Sito web',
  social: 'Seguici',
  language: 'Lingua',
  price: 'Prezzo',
  legalNotice: 'Note legali',
  legalSpanishOnly: 'Queste note legali sono disponibili solo in spagnolo.',
  backToRestaurant: 'Torna al ristorante',
  poweredBy: (product, company) => `Prenotazioni e menù con ${product} · ${company}`,
  logoAlt: (name) => `Logo di ${name}`,
  coverAlt: (name) => `Foto di ${name}`,
  photoAlt: (name, n) => `Foto ${n} di ${name}`,
};

export const MESSAGES: Record<Locale, PublicMessages> = { es, en, ca, fr, de, it };

export function getMessages(locale: Locale): PublicMessages {
  return MESSAGES[locale];
}
