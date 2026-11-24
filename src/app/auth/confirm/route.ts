import { NextResponse, type NextRequest } from 'next/server';
import { parseOtpType } from '@/lib/auth/otp-type';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = parseOtpType(url.searchParams.get('type'));
  const next = safeNext(url.searchParams.get('next'));

  let ok = false;
  if (code) {
    const supabase = await createClient();
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    const supabase = await createClient();
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  // token_hash con un type desconocido (o sin type) se trata como enlace no válido.
  return NextResponse.redirect(new URL(ok ? next : '/recuperar?error=enlace', request.url));
}
