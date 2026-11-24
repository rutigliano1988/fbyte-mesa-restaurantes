import 'server-only';
import { Resend } from 'resend';
import { isProductionDeploy, serverEnv } from '@/lib/env';

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  react: React.ReactElement;
  replyTo?: string;
}): Promise<SendResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) {
    if (isProductionDeploy()) {
      // En producción nunca fingimos que se ha enviado.
      console.error('[email] falta RESEND_API_KEY en producción: no se envía nada', { subject: input.subject });
      return { ok: false, error: 'EMAIL_NOT_CONFIGURED' };
    }
    // Modo desarrollo: sin clave no se envía nada (y no registramos el destinatario).
    console.info(`[email:dev] asunto="${input.subject}"`);
    return { ok: true };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      react: input.react,
      replyTo: input.replyTo,
    });
    if (error) {
      console.error('[email] Resend rechazó el envío', { subject: input.subject, error: error.message });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error('[email] fallo de red al enviar', { subject: input.subject });
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
