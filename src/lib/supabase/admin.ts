import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

/** Clave secreta: se salta RLS. Úsalo solo para crear cuentas y en scripts. */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
