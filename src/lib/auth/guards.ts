import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { can, type Permission, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/schemas';

export type SessionUser = { id: string; email: string };
export type RestaurantStatus = 'setup' | 'active' | 'disabled';
export type MyRestaurant = { id: string; name: string; slug: string; status: RestaurantStatus; role: Role };
export type PanelContext = {
  user: SessionUser;
  restaurant: { id: string; name: string; slug: string; status: RestaurantStatus };
  role: Role;
  readOnly: boolean;
};

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  return user;
}

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('is_platform_admin');
  return data === true;
});

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser('/admin');
  if (!(await isPlatformAdmin())) notFound();
  return user;
}

export const getMyRestaurants = cache(async (): Promise<MyRestaurant[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_restaurants');
  if (error) throw new Error(error.message);
  return (data ?? []) as MyRestaurant[];
});

export const getPanelContext = cache(async (restaurantId: string): Promise<PanelContext> => {
  if (!uuidSchema.safeParse(restaurantId).success) notFound();
  const user = await requireUser(`/panel/${restaurantId}`);
  const mine = (await getMyRestaurants()).find((r) => r.id === restaurantId);
  if (mine) {
    const { role, ...restaurant } = mine;
    return { user, restaurant, role, readOnly: false };
  }
  if (await isPlatformAdmin()) {
    const supabase = await createClient();
    const { data } = await supabase.from('restaurants').select('id, name, slug, status').eq('id', restaurantId).maybeSingle();
    if (!data) notFound();
    // FByte entra en modo soporte: ve como un administrador, pero no puede tocar nada.
    return { user, restaurant: data as PanelContext['restaurant'], role: 'admin', readOnly: true };
  }
  notFound();
});

/** Para server actions: lanza FORBIDDEN si no se puede actuar. */
export async function requirePermission(restaurantId: string, permission: Permission): Promise<PanelContext> {
  const ctx = await getPanelContext(restaurantId);
  if (ctx.readOnly || ctx.restaurant.status === 'disabled' || !can(ctx.role, permission)) {
    throw new Error('FORBIDDEN');
  }
  return ctx;
}

/**
 * Para páginas del panel: 404 si el restaurante está desactivado (salvo soporte de FByte)
 * o si el rol no tiene el permiso pedido.
 */
export async function requirePanelAccess(restaurantId: string, permission?: Permission): Promise<PanelContext> {
  const ctx = await getPanelContext(restaurantId);
  if (ctx.restaurant.status === 'disabled' && !ctx.readOnly) notFound();
  if (permission && !can(ctx.role, permission)) notFound();
  return ctx;
}
