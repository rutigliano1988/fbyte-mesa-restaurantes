import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { BRAND } from '@/config/brand';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-4 py-16">
      <Logo />
      <h1
        className="text-4xl font-extrabold leading-[1.02] tracking-[-0.04em] sm:text-5xl"
        style={{ fontStretch: '108%' }}
      >
        Tu restaurante, <span className="bg-peach px-2 [box-decoration-break:clone]">en un solo panel</span>.
      </h1>
      <p className="text-lg text-muted">{BRAND.tagline}</p>
      <div>
        <Link
          href="/login"
          className="inline-flex rounded-[6px] bg-orange px-6 py-3.5 font-bold text-ink hover:bg-orange-dark"
        >
          Entrar al panel →
        </Link>
      </div>
    </main>
  );
}
