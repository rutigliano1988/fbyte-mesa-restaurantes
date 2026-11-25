import { BRAND } from '@/config/brand';
import { fullAddress } from '@/lib/public/format';
import type { PublicRestaurant } from '@/lib/public/restaurant-schema';

type Holder = Pick<PublicRestaurant, 'name' | 'legalName' | 'taxId' | 'addressLine' | 'postalCode' | 'city' | 'contactEmail' | 'phone'>;

/** Aviso legal (LSSI-CE) de la mini-web. Plantilla en castellano, pendiente de revisión legal. */
export function legalNoticeSections(r: Holder): { heading: string; body: string }[] {
  const holder = r.legalName ?? r.name;
  const contact = [r.contactEmail, r.phone].filter(Boolean).join(' · ') || 'el del propio restaurante';
  return [
    {
      heading: 'Titular de la web',
      body:
        `En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), ` +
        `te informamos de que esta web pertenece a ${holder}, con CIF/NIF ${r.taxId ?? '—'} y domicilio en ${fullAddress(r) ?? '—'}. ` +
        `Contacto: ${contact}.`,
    },
    {
      heading: 'Para qué es esta web',
      body: `Muestra información de ${r.name}: horario, ubicación y formas de contacto.`,
    },
    {
      heading: 'Contenidos',
      body: `Los textos y las imágenes son de ${holder} o se usan con permiso. No se pueden copiar sin su autorización.`,
    },
    {
      heading: 'Responsabilidad',
      body: `${holder} intenta que la información esté siempre al día, pero el horario o los datos pueden cambiar. Si tienes dudas, contacta con el restaurante.`,
    },
    {
      heading: 'Plataforma',
      body: `Esta web funciona con ${BRAND.productName}, de ${BRAND.company}, que presta el servicio técnico a ${holder}.`,
    },
    {
      heading: 'Ley aplicable',
      body: 'Se aplica la legislación española.',
    },
  ];
}
