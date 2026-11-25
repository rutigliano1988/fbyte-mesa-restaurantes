import { describe, expect, it } from 'vitest';
import { missingFieldLabels, onboardingSteps, type OnboardingInput } from './onboarding';

const id = '11111111-1111-1111-1111-111111111111';
const empty: OnboardingInput = {
  status: 'setup',
  addressLine: null,
  postalCode: null,
  city: null,
  phone: null,
  contactEmail: null,
  logoPath: null,
  coverPath: null,
  servicesCount: 0,
  enabledLocales: ['es'],
  descriptionLocales: [],
};

describe('onboardingSteps', () => {
  it('cinco pasos en orden, ninguno hecho al empezar', () => {
    const steps = onboardingSteps(id, empty);
    expect(steps.map((s) => s.title)).toEqual(['Datos básicos', 'Logo y portada', 'Horario', 'Idiomas', 'Publicar']);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[2].href).toBe(`/panel/${id}/horario`);
  });

  it('se marcan solos con los datos guardados', () => {
    const steps = onboardingSteps(id, {
      ...empty,
      addressLine: 'Calle Mayor 1',
      postalCode: '28013',
      city: 'Madrid',
      contactEmail: 'hola@pepe.es',
      logoPath: 'x',
      coverPath: 'y',
      servicesCount: 2,
      enabledLocales: ['es', 'en'],
      descriptionLocales: ['es', 'en'],
      status: 'active',
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('Idiomas no está hecho si falta la descripción de algún idioma activo', () => {
    const steps = onboardingSteps(id, { ...empty, enabledLocales: ['es', 'en'], descriptionLocales: ['es'] });
    expect(steps.find((s) => s.key === 'languages')?.done).toBe(false);
  });
});

it('missingFieldLabels traduce los códigos de la BD', () => {
  expect(missingFieldLabels(['contact', 'tax_id', 'otro'])).toEqual(['Teléfono o email de contacto', 'CIF o NIF (datos fiscales)', 'otro']);
});
