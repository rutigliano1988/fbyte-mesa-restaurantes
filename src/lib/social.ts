export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok';

const RULES: Record<SocialNetwork, { hosts: string[]; base: string; handle: RegExp; at: boolean }> = {
  instagram: {
    hosts: ['instagram.com', 'www.instagram.com', 'm.instagram.com'],
    base: 'https://www.instagram.com/',
    handle: /^[A-Za-z0-9._]{1,30}$/,
    at: false,
  },
  facebook: {
    hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'es-es.facebook.com', 'fb.com', 'www.fb.com'],
    base: 'https://www.facebook.com/',
    handle: /^[A-Za-z0-9.-]{2,100}$/,
    at: false,
  },
  tiktok: {
    hosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
    base: 'https://www.tiktok.com/',
    handle: /^[A-Za-z0-9._]{2,24}$/,
    at: true,
  },
};

/**
 * '@pepe', 'pepe', 'instagram.com/pepe/', 'https://www.instagram.com/pepe?igsh=x' → 'https://www.instagram.com/pepe'.
 * Facebook admite también 'profile.php?id=123'. null si no se reconoce (llámala con texto no vacío).
 */
export function normalizeSocial(network: SocialNetwork, input: string): string | null {
  const rule = RULES[network];
  const value = input.trim();
  if (!value) return null;
  let handle: string;
  if (/^https?:\/\//i.test(value) || value.includes('/')) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (!rule.hosts.includes(url.hostname.toLowerCase())) return null;
    const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
    if (network === 'facebook' && segment === 'profile.php') {
      const id = url.searchParams.get('id');
      return id && /^\d{5,20}$/.test(id) ? `${rule.base}profile.php?id=${id}` : null;
    }
    handle = decodeURIComponent(segment);
  } else {
    handle = value;
  }
  handle = handle.replace(/^@/, '');
  if (!rule.handle.test(handle)) return null;
  return `${rule.base}${rule.at ? '@' : ''}${handle}`;
}

/** 'pepe.es' → 'https://pepe.es'; 'http://…' se pasa a https. null si no es una web válida. */
export function normalizeWebsite(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value.replace(/^http:\/\//i, 'https://') : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
  const out = url.pathname === '/' && !url.search && !url.hash ? url.origin : url.toString();
  return out.length <= 300 ? out : null;
}

/** Para mostrar: 'https://www.instagram.com/pepe' → '@pepe'. */
export function socialHandle(url: string): string {
  const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'profile.php') return 'Facebook';
  return path.startsWith('@') ? path : `@${path}`;
}
