import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const base = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  SUPABASE_SECRET_KEY: 'sb_secret_x',
  NEXT_PUBLIC_SITE_URL: 'https://mesa.example.com/',
};

afterEach(() => vi.unstubAllEnvs());

it('lee y normaliza las variables', async () => {
  for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
  const { serverEnv, siteUrl } = await import('./env');
  expect(serverEnv().EMAIL_FROM).toBe('Mesa <onboarding@resend.dev>');
  expect(siteUrl()).toBe('https://mesa.example.com');
});

it('falla con un mensaje claro si falta algo', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  const { serverEnv } = await import('./env');
  expect(() => serverEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
});
