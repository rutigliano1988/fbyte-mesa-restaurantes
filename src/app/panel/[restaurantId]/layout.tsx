import Link from 'next/link';
import { AppHeader } from '@/components/layout/AppHeader';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/Notice';
import { BRAND } from '@/config/brand';
import { getPanelContext } from '@/lib/auth/guards';
import { panelNav } from '@/lib/panel-nav';
import { createClient } from '@/lib/supabase/server';

export default async function RestaurantPanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const ctx = await getPanelContext(restaurantId);

  if (ctx.readOnly) {
    const supabase = await createClient();
    const { error } = await supabase.rpc('log_admin_view', { p_restaurant_id: restaurantId });
    // Sin registro de auditoría no se entra en modo soporte (lo recoge error.tsx).
    if (error) throw new Error(`log_admin_view: ${error.message}`);
  }

  if (ctx.restaurant.status === 'disabled' && !ctx.readOnly) {
    return (
      <>
        <AppHeader userEmail={ctx.user.email} homeHref="/panel" />
        <main className="mx-auto max-w-xl px-4 py-12">
          <Card>
            <h1 className="text-2xl font-extrabold">Este restaurante está desactivado</h1>
            <p className="mt-2 text-muted">
              Tus datos siguen guardados. Escribe a {BRAND.company} para reactivarlo.
            </p>
          </Card>
        </main>
      </>
    );
  }

  const nav = panelNav(restaurantId, ctx.role);
  return (
    <>
      <AppHeader title={ctx.readOnly ? 'Modo soporte' : undefined} userEmail={ctx.user.email} homeHref={`/panel/${restaurantId}`} />
      {ctx.readOnly && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Notice tone="info">Estás viendo este panel como {BRAND.company}, en modo solo lectura.</Notice>
        </div>
      )}
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <nav aria-label="Secciones del panel" className="md:w-52 md:shrink-0">
          <p className="mb-3 truncate text-sm font-bold text-muted">{ctx.restaurant.name}</p>
          <ul className="flex gap-2 overflow-x-auto md:flex-col">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block whitespace-nowrap rounded-[6px] px-3 py-2 font-bold hover:bg-peach-soft">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
