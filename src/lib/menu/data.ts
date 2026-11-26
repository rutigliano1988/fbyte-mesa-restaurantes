import 'server-only';
import type { RestaurantStatus } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { parseMenuTree, type MenuTree } from './tree';

/** Todo el menú del restaurante (también lo desactivado), con la sesión del usuario (RLS). */
export async function getMenuTree(restaurantId: string): Promise<MenuTree> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_menu_tree', { p_restaurant_id: restaurantId });
  if (error) throw new Error(`get_menu_tree: ${error.message}`);
  return parseMenuTree(data);
}

export type QrBranding = {
  name: string;
  slug: string;
  status: RestaurantStatus;
  accentColor: string;
  logoPath: string | null;
};

/** Lo que lleva la tarjeta QR: nombre, logo y color de acento. */
export async function getQrBranding(restaurantId: string): Promise<QrBranding> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('restaurants')
    .select('name, slug, status, accent_color, logo_path')
    .eq('id', restaurantId)
    .single();
  if (error || !data) throw new Error(`restaurants: ${error?.message ?? 'sin datos'}`);
  const r = data as { name: string; slug: string; status: RestaurantStatus; accent_color: string; logo_path: string | null };
  return { name: r.name, slug: r.slug, status: r.status, accentColor: r.accent_color, logoPath: r.logo_path };
}
