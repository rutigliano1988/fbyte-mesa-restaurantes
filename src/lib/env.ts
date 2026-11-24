import 'server-only';
import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(3).default('Mesa <onboarding@resend.dev>'),
});

export type ServerEnv = z.infer<typeof schema>;

export function serverEnv(): ServerEnv {
  const parsed = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || undefined,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
  });
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Faltan o son incorrectas estas variables de entorno: ${keys}. Revisa .env.example.`);
  }
  return parsed.data;
}

export function siteUrl(): string {
  return serverEnv().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
}
