'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Logo } from '@/components/brand/Logo';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo />
      <Card className="flex w-full flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Algo ha fallado</h1>
        <p className="text-muted">Vuelve a intentarlo en un momento. Si sigue pasando, escríbenos y lo miramos.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => reset()}>
            Reintentar
          </Button>
          <Link href="/" className={buttonClass('ghost')}>
            Ir al inicio
          </Link>
        </div>
      </Card>
    </main>
  );
}
