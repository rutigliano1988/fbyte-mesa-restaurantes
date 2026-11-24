import type { EmailOtpType } from '@supabase/supabase-js';

const OTP_TYPES = ['recovery', 'invite', 'magiclink', 'email', 'signup', 'email_change'] as const satisfies readonly EmailOtpType[];

/** Solo los tipos de enlace por email que usamos; cualquier otro valor se rechaza. */
export function parseOtpType(value: string | null | undefined): EmailOtpType | null {
  return (OTP_TYPES as readonly string[]).includes(value ?? '') ? (value as EmailOtpType) : null;
}
