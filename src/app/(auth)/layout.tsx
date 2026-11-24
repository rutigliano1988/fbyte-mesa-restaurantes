import { Logo } from '@/components/brand/Logo';
import { Card } from '@/components/ui/Card';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Logo />
      <Card>{children}</Card>
    </main>
  );
}
