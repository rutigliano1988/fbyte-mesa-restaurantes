import { render } from '@react-email/components';
import { expect, it } from 'vitest';
import { InvitationEmail, invitationSubject } from './InvitationEmail';

it('incluye restaurante, rol y enlace', async () => {
  const html = await render(
    <InvitationEmail restaurantName="La Taberna" roleLabel="Encargado" inviteUrl="https://mesa.test/invitacion/abc" />,
  );
  expect(html).toContain('La Taberna');
  expect(html).toContain('Encargado');
  expect(html).toContain('https://mesa.test/invitacion/abc');
  expect(html).toContain('Aceptar invitación');
  expect(html).toContain('FByte Solutions');
});

it('asunto en castellano', () => {
  expect(invitationSubject('La Taberna')).toBe('Te han invitado a La Taberna en Mesa');
});
