import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente del navegador con la sesión del usuario (cookies), para Supabase Realtime: los cambios llegan filtrados por
 * las RLS de quien mira. Las NEXT_PUBLIC_* se incrustan al compilar. Es único por pestaña (isSingleton).
 */
export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
