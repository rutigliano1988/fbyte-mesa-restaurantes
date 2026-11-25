import { describe, expect, it } from 'vitest';
import { SAMPLE_RESTAURANT } from '@/lib/public/fixtures';
import { DPA_SECTIONS, DPA_VERSION } from './dpa';
import { legalNoticeSections } from './legal-notice';

describe('textos legales', () => {
  it('el contrato tiene versión y secciones', () => {
    expect(DPA_VERSION).toBe('2026-11-borrador');
    expect(DPA_SECTIONS.length).toBeGreaterThan(3);
    expect(DPA_SECTIONS.map((s) => s.body).join(' ')).toContain('Supabase');
  });

  it('el aviso legal lleva los datos LSSI del restaurante', () => {
    const text = legalNoticeSections(SAMPLE_RESTAURANT).map((s) => s.body).join(' ');
    expect(text).toContain('Taberna Pepe SL');
    expect(text).toContain('B12345674');
    expect(text).toContain('Calle Mayor 1, 28013 Madrid');
    expect(text).toContain('hola@lataberna.es');
  });

  it('sin razón social usa el nombre del restaurante', () => {
    const text = legalNoticeSections({ ...SAMPLE_RESTAURANT, legalName: null, taxId: null }).map((s) => s.body).join(' ');
    expect(text).toContain('pertenece a La Taberna de Pepe, con CIF/NIF —');
  });
});
