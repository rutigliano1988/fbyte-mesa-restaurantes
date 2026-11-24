import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo />
      <Card className="flex w-full flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">No encontramos esta página</h1>
        <p className="text-muted">Puede que la dirección esté mal escrita o que ya no exista.</p>
        <div>
          <Link href="/" className={buttonClass('primary')}>
            Ir al inicio
          </Link>
        </div>
      </Card>
    </main>
  );
}
