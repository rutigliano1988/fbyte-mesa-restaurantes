import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND } from '@/config/brand';

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
  vi.stubEnv('EMAIL_FROM', '');
  const { serverEnv, siteUrl } = await import('./env');
  expect(serverEnv().EMAIL_FROM).toBe(`${BRAND.productName} <onboarding@resend.dev>`);
  expect(siteUrl()).toBe('https://mesa.example.com');
});

it('falla con un mensaje claro si falta algo', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  const { serverEnv } = await import('./env');
  expect(() => serverEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
});

describe('isProductionDeploy', () => {
  it('manda VERCEL_ENV si existe', async () => {
    const { isProductionDeploy } = await import('./env');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(isProductionDeploy()).toBe(false);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(isProductionDeploy()).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    expect(isProductionDeploy()).toBe(true);
  });

  it('sin VERCEL_ENV usa NODE_ENV', async () => {
    const { isProductionDeploy } = await import('./env');
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isProductionDeploy()).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    expect(isProductionDeploy()).toBe(false);
    vi.stubEnv('NODE_ENV', 'test');
    expect(isProductionDeploy()).toBe(false);
  });
});

it('emailConfigured depende de RESEND_API_KEY', async () => {
  const { emailConfigured } = await import('./env');
  vi.stubEnv('RESEND_API_KEY', '');
  expect(emailConfigured()).toBe(false);
  vi.stubEnv('RESEND_API_KEY', 're_123');
  expect(emailConfigured()).toBe(true);
});
