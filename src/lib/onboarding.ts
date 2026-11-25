import type { RestaurantStatus } from '@/lib/auth/guards';

export type OnboardingInput = {
  status: RestaurantStatus;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  contactEmail: string | null;
  logoPath: string | null;
  coverPath: string | null;
  servicesCount: number;
  enabledLocales: string[];
  descriptionLocales: string[];
};

export type OnboardingStepKey = 'basics' | 'images' | 'schedule' | 'languages' | 'publish';
export type OnboardingStep = { key: OnboardingStepKey; title: string; hint: string; href: string; done: boolean };

/** Asistente de bienvenida: cada paso se marca solo, a partir de los datos guardados. */
export function onboardingSteps(restaurantId: string, i: OnboardingInput): OnboardingStep[] {
  const base = `/panel/${restaurantId}`;
  return [
    {
      key: 'basics',
      title: 'Datos básicos',
      hint: 'Dirección y un teléfono o email para que te encuentren.',
      href: `${base}/local#contacto`,
      done: Boolean(i.addressLine && i.postalCode && i.city && (i.phone || i.contactEmail)),
    },
    {
      key: 'images',
      title: 'Logo y portada',
      hint: 'La primera impresión de tu web.',
      href: `${base}/local#imagen`,
      done: Boolean(i.logoPath && i.coverPath),
    },
    {
      key: 'schedule',
      title: 'Horario',
      hint: 'Tus servicios de cada día y los cierres.',
      href: `${base}/horario`,
      done: i.servicesCount > 0,
    },
    {
      key: 'languages',
      title: 'Idiomas',
      hint: 'Elige idiomas y escribe la descripción en cada uno.',
      href: `${base}/local#idiomas`,
      done: i.enabledLocales.length > 0 && i.enabledLocales.every((l) => i.descriptionLocales.includes(l)),
    },
    {
      key: 'publish',
      title: 'Publicar',
      hint: 'Revisa lo que falta, acepta el contrato y publica.',
      href: `${base}#publicar`,
      done: i.status === 'active',
    },
  ];
}

/** Códigos de public.restaurant_missing_fields(). */
export const MISSING_FIELD_LABELS: Record<string, string> = {
  address_line: 'Calle y número',
  postal_code: 'Código postal',
  city: 'Ciudad',
  contact: 'Teléfono o email de contacto',
  services: 'Al menos un servicio en el horario',
  legal_name: 'Razón social (datos fiscales)',
  tax_id: 'CIF o NIF (datos fiscales)',
};

export function missingFieldLabels(codes: string[]): string[] {
  return codes.map((code) => MISSING_FIELD_LABELS[code] ?? code);
}
