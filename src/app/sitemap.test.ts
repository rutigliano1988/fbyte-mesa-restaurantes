import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ siteUrl: () => 'https://mesa.test' }));
vi.mock('@/lib/public/data', () => ({
  getPublicSlugs: vi.fn(async () => [{ slug: 'la-taberna', enabledLocales: ['es'], updatedAt: '2026-11-20T10:00:00Z' }]),
  getPublicMenuSlugs: vi.fn(async () => [{ slug: 'la-taberna', enabledLocales: ['es'], updatedAt: '2026-11-21T10:00:00Z' }]),
}));

const { getPublicMenuSlugs } = await import('@/lib/public/data');
const { default: sitemap } = await import('./sitemap');

afterEach(() => vi.restoreAllMocks());

describe('sitemap', () => {
  it('lleva las mini-webs y sus cartas', async () => {
    expect((await sitemap()).map((e) => e.url)).toEqual(['https://mesa.test/la-taberna', 'https://mesa.test/la-taberna/menu']);
  });

  it('si fallan las cartas, registra el error y sigue con las mini-webs', async () => {
    vi.mocked(getPublicMenuSlugs).mockRejectedValueOnce(new Error('list_public_menus: caído'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await sitemap()).map((e) => e.url)).toEqual(['https://mesa.test/la-taberna']);
    expect(log).toHaveBeenCalledOnce();
  });
});
