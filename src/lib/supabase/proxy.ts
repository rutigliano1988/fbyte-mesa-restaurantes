import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Refresca el token de Supabase en cada petición y lo propaga a la respuesta. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // Cabeceras anti-caché para que una CDN no comparta la sesión
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, String(value)));
        },
      },
    },
  );

  await supabase.auth.getClaims();
  return response;
}
