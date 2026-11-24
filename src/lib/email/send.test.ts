import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const base = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  SUPABASE_SECRET_KEY: 'sb_secret_x',
  NEXT_PUBLIC_SITE_URL: 'https://mesa.example.com',
};
const input = { to: 'pepe@example.com', subject: 'Hola', react: null as unknown as React.ReactElement };

beforeEach(() => {
  for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('VERCEL_ENV', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  sendMock.mockReset();
});

it('en desarrollo sin clave no envía y el log no incluye el destinatario', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const { sendEmail } = await import('./send');
  expect(await sendEmail(input)).toEqual({ ok: true });
  expect(sendMock).not.toHaveBeenCalled();
  const logged = JSON.stringify(info.mock.calls);
  expect(logged).toContain('Hola');
  expect(logged).not.toContain('pepe@example.com');
});

it('en producción sin clave falla con EMAIL_NOT_CONFIGURED y registra un error sin destinatario', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { sendEmail } = await import('./send');
  expect(await sendEmail(input)).toEqual({ ok: false, error: 'EMAIL_NOT_CONFIGURED' });
  expect(sendMock).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalled();
  expect(JSON.stringify(error.mock.calls)).not.toContain('pepe@example.com');
});

it('con clave envía con Resend', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('RESEND_API_KEY', 're_123');
  sendMock.mockResolvedValue({ data: { id: 'em_1' }, error: null });
  const { sendEmail } = await import('./send');
  expect(await sendEmail(input)).toEqual({ ok: true, id: 'em_1' });
  expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'pepe@example.com', subject: 'Hola' }));
});
