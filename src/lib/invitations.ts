import 'server-only';
import { emailConfigured, isProductionDeploy, siteUrl } from '@/lib/env';
import type { FormState } from '@/lib/forms';

export type InviteState = FormState & { inviteUrl?: string; email?: string; emailSent?: boolean };

export function invitationUrl(token: string): string {
  return `${siteUrl()}/invitacion/${token}`;
}

/**
 * El enlace copiable solo lo ve FByte, o cualquiera en desarrollo/pruebas sin email configurado.
 * A un administrador de restaurante en producción nunca se le devuelve.
 */
export function canShowInviteLink(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin || (!emailConfigured() && !isProductionDeploy());
}

/** Estado que devuelve la acción tras crear una invitación. Sin permiso, el enlace no sale del servidor. */
export function inviteOutcome(input: { url: string; email: string; emailSent: boolean; showLink: boolean }): InviteState {
  const { url, email, emailSent, showLink } = input;
  if (showLink) return { success: 'Invitación creada.', inviteUrl: url, email, emailSent };
  if (emailSent) return { success: `Hemos enviado la invitación a ${email}.`, email, emailSent };
  return { error: `No pudimos enviar el email a ${email}. Vuelve a intentarlo en un momento.`, email, emailSent };
}
