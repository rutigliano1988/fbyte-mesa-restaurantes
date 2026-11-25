import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '../forms';
import { accentColorSchema, basicsSchema, contactSchema, languagesSchema, legalSchema, publishSchema, socialSchema } from './local';

const noDescriptions = { description_es: '', description_en: '', description_ca: '', description_fr: '', description_de: '', description_it: '' };

describe('basicsSchema', () => {
  it('normaliza y convierte el precio', () => {
    const r = basicsSchema.parse({ name: ' La Taberna ', cuisine: '', priceRange: '2', timezone: 'Atlantic/Canary', ...noDescriptions });
    expect(r).toMatchObject({ name: 'La Taberna', cuisine: null, priceRange: 2, timezone: 'Atlantic/Canary' });
  });

  it('rechaza descripciones de más de 1000 caracteres', () => {
    const r = basicsSchema.safeParse({ name: 'Bar', cuisine: '', priceRange: '', timezone: 'Europe/Madrid', ...noDescriptions, description_en: 'a'.repeat(1001) });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).description_en).toBe('La descripción puede tener como mucho 1000 caracteres.');
  });
});

describe('contactSchema', () => {
  it('normaliza teléfono, email y web; lo vacío queda en null', () => {
    const r = contactSchema.parse({ addressLine: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', phone: '910 00 00 00', contactEmail: ' Hola@Pepe.es ', website: 'pepe.es' });
    expect(r).toEqual({ addressLine: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', phone: '910000000', contactEmail: 'hola@pepe.es', website: 'https://pepe.es' });
    const empty = contactSchema.parse({ addressLine: '', postalCode: '', city: '', phone: '', contactEmail: '', website: '' });
    expect(Object.values(empty).every((v) => v === null)).toBe(true);
  });

  it('mensajes en castellano', () => {
    const r = contactSchema.safeParse({ addressLine: 'C', postalCode: '99999', city: 'M', phone: '123', contactEmail: 'no', website: 'no es web' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error)).toEqual({
      addressLine: 'Escribe la calle y el número.',
      postalCode: 'El código postal tiene 5 cifras (por ejemplo, 28013).',
      city: 'Escribe la ciudad.',
      phone: 'Ese teléfono no parece correcto. Escribe 9 cifras, con +34 delante si quieres.',
      contactEmail: 'Ese email no parece correcto.',
      website: 'Esa web no parece correcta (por ejemplo, https://turestaurante.es).',
    });
  });
});

describe('redes, color, idiomas, datos fiscales y publicar', () => {
  it('socialSchema convierte usuarios en enlaces', () => {
    expect(socialSchema.parse({ instagram: '@pepe', facebook: '', tiktok: 'pepebar' })).toEqual({
      instagram: 'https://www.instagram.com/pepe',
      facebook: null,
      tiktok: 'https://www.tiktok.com/@pepebar',
    });
    expect(socialSchema.safeParse({ instagram: 'twitter.com/pepe', facebook: '', tiktok: '' }).success).toBe(false);
  });

  it('accentColorSchema exige contraste', () => {
    expect(accentColorSchema.parse({ accentColor: '#ff7a1a' })).toEqual({ accentColor: '#FF7A1A' });
    const r = accentColorSchema.safeParse({ accentColor: '#7A7A7A' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).accentColor).toBe('Con ese color, el texto de los botones no se lee bien. Elige uno más claro o más oscuro.');
  });

  it('languagesSchema siempre incluye el castellano', () => {
    expect(languagesSchema.parse({ locales: ['it', 'en'] })).toEqual({ locales: ['es', 'en', 'it'] });
    expect(languagesSchema.parse({ locales: [] })).toEqual({ locales: ['es'] });
    expect(languagesSchema.safeParse({ locales: ['pt'] }).success).toBe(false);
  });

  it('legalSchema valida el CIF', () => {
    expect(legalSchema.parse({ legalName: 'Taberna Pepe SL', taxId: 'b-12345674' })).toEqual({ legalName: 'Taberna Pepe SL', taxId: 'B12345674' });
    const r = legalSchema.safeParse({ legalName: '', taxId: 'B12345675' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).taxId).toBe('Ese CIF, NIF o NIE no parece correcto. Revisa las letras y los números.');
  });

  it('publishSchema exige aceptar el contrato', () => {
    expect(publishSchema.safeParse({ accept: 'on' }).success).toBe(true);
    const r = publishSchema.safeParse({ accept: undefined });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).accept).toBe('Tienes que aceptar el contrato para publicar.');
  });
});
