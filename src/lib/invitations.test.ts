import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

afterEach(() => vi.unstubAllEnvs());

function setEnv({ prod, email }: { prod: boolean; email: boolean }) {
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('NODE_ENV', prod ? 'production' : 'development');
  vi.stubEnv('RESEND_API_KEY', email ? 're_123' : '');
}

describe('canShowInviteLink', () => {
  it('FByte siempre ve el enlace', async () => {
    const { canShowInviteLink } = await import('./invitations');
    for (const prod of [true, false]) {
      for (const email of [true, false]) {
        setEnv({ prod, email });
        expect(canShowInviteLink(true)).toBe(true);
      }
    }
  });

  it('un administrador de restaurante solo lo ve en desarrollo y sin email configurado', async () => {
    const { canShowInviteLink } = await import('./invitations');
    setEnv({ prod: false, email: false });
    expect(canShowInviteLink(false)).toBe(true);
    setEnv({ prod: false, email: true });
    expect(canShowInviteLink(false)).toBe(false);
    setEnv({ prod: true, email: false });
    expect(canShowInviteLink(false)).toBe(false);
    setEnv({ prod: true, email: true });
    expect(canShowInviteLink(false)).toBe(false);
  });
});

describe('inviteOutcome', () => {
  it('sin permiso para ver el enlace, el estado no lo incluye', async () => {
    const { inviteOutcome } = await import('./invitations');
    const ok = inviteOutcome({ url: 'https://x/invitacion/t', email: 'a@b.es', emailSent: true, showLink: false });
    expect(ok).toEqual({ success: 'Hemos enviado la invitación a a@b.es.', email: 'a@b.es', emailSent: true });
    const ko = inviteOutcome({ url: 'https://x/invitacion/t', email: 'a@b.es', emailSent: false, showLink: false });
    expect(ko).toEqual({ error: 'No pudimos enviar el email a a@b.es. Vuelve a intentarlo en un momento.', email: 'a@b.es', emailSent: false });
    expect(JSON.stringify([ok, ko])).not.toContain('invitacion/t');
  });

  it('con permiso, incluye el enlace', async () => {
    const { inviteOutcome } = await import('./invitations');
    const r = inviteOutcome({ url: 'https://x/invitacion/t', email: 'a@b.es', emailSent: false, showLink: true });
    expect(r.inviteUrl).toBe('https://x/invitacion/t');
    expect(r.emailSent).toBe(false);
    expect(r.error).toBeUndefined();
  });
});
