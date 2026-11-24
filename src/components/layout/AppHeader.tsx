import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { signOut } from '@/lib/auth/actions';

export function AppHeader({ title, userEmail, homeHref }: { title?: string; userEmail: string; homeHref: string }) {
  return (
    <header className="bg-ink text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href={homeHref} aria-label="Ir al inicio">
            <Logo onDark />
          </Link>
          {title && <span className="rounded-full border border-pill px-3 py-1 text-xs font-bold text-pill">{title}</span>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-on-ink sm:inline">{userEmail}</span>
          <form action={signOut}>
            <button type="submit" className="font-bold text-orange hover:underline">
              Salir
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
