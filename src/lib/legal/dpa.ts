import { BRAND } from '@/config/brand';

/** Debe coincidir con la versión que acepta public.publish_restaurant() (lo comprueba tests/db/public.test.ts). */
export const DPA_VERSION = '2026-11-borrador';

export const DPA_TITLE = 'Contrato de encargado del tratamiento';
export const LEGAL_REVIEW_PENDING = 'PENDIENTE DE REVISIÓN LEGAL';

/** Plantilla. Hay que revisarla con un abogado antes de vender el producto (spec §11). */
export const DPA_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Quién es quién',
    body: `Tu restaurante es el responsable de los datos de sus clientes. ${BRAND.company} es el encargado del tratamiento: trata esos datos solo para darte el servicio de ${BRAND.productName} y siguiendo tus instrucciones.`,
  },
  {
    heading: 'Qué datos y para qué',
    body: 'Datos de contacto de tus clientes (nombre, email y teléfono), sus reservas y las notas que añada tu equipo. Se usan para gestionar reservas, enviar los emails de la reserva y mostrarte estadísticas. Nada más.',
  },
  {
    heading: 'Cuánto tiempo',
    body: `Mientras uses ${BRAND.productName}. Los clientes sin actividad durante 3 años se anonimizan de forma automática. Al terminar el servicio, borramos los datos o te los devolvemos, como prefieras.`,
  },
  {
    heading: 'Cómo los protegemos',
    body: 'Los datos se guardan en la Unión Europea (Fráncfort), con acceso solo para las personas de tu equipo y con permisos por rol. Las personas de FByte que dan soporte tienen deber de confidencialidad y su acceso queda registrado.',
  },
  {
    heading: 'Subencargados',
    body: 'Supabase (base de datos y archivos, UE), Vercel (alojamiento de la web) y Resend (envío de emails). Te avisaremos antes de añadir o cambiar alguno.',
  },
  {
    heading: 'Derechos de tus clientes',
    body: `Si un cliente pide ver, corregir o borrar sus datos, ${BRAND.productName} te da las herramientas para hacerlo. Si nos llega a nosotros, te lo pasamos sin demora.`,
  },
  {
    heading: 'Si algo falla',
    body: 'Si hay una brecha de seguridad que afecte a tus datos, te avisamos sin dilación indebida y en menos de 48 horas, con lo que sepamos y las medidas tomadas.',
  },
];
