import { AppHeader } from '@/components/layout/AppHeader';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <>
      <AppHeader title="Superadmin" userEmail={user.email} homeHref="/admin" />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
