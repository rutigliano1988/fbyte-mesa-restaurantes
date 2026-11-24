import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverEnv } from '@/lib/env';

/** Cliente con la sesión del usuario: todas las consultas pasan por RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  const env = serverEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: no puede escribir cookies. El proxy refresca la sesión.
        }
      },
    },
  });
}
