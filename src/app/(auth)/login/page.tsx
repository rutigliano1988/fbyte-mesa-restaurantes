import type { Metadata } from 'next';
import Link from 'next/link';
import { safeNext } from '@/lib/safe-next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Entra en tu panel</h1>
      <LoginForm next={safeNext(next)} />
      <Link href="/recuperar" className="text-sm font-bold text-navy hover:underline">
        ¿Olvidaste tu contraseña?
      </Link>
    </div>
  );
}
