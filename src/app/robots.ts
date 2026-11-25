import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Las zonas privadas fuera de los buscadores (deben coincidir con las rutas de src/app). */
const PRIVATE_PATHS = ['/admin', '/panel', '/invitacion', '/auth', '/login', '/recuperar', '/nueva-contrasena'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
