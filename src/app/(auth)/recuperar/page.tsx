import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/ui/Notice';
import { RecoverForm } from './RecoverForm';

export const metadata: Metadata = { title: 'Recuperar contraseña' };

export default async function RecoverPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight">¿Olvidaste tu contraseña?</h1>
      {error && <Notice tone="error">Ese enlace ya no funciona. Pide uno nuevo aquí abajo.</Notice>}
      <p className="text-muted">Escribe tu email y te mandamos un enlace para crear otra.</p>
      <RecoverForm />
      <Link href="/login" className="text-sm font-bold text-navy hover:underline">
        Volver a entrar
      </Link>
    </div>
  );
}
