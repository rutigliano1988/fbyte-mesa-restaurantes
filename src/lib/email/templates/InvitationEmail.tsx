import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components';
import { BRAND } from '@/config/brand';

export type InvitationEmailProps = { restaurantName: string; roleLabel: string; inviteUrl: string };

export function invitationSubject(restaurantName: string): string {
  return `Te han invitado a ${restaurantName} en ${BRAND.productName}`;
}

const small = { fontSize: 13, color: '#3A4157', lineHeight: '20px' };

export function InvitationEmail({ restaurantName, roleLabel, inviteUrl }: InvitationEmailProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{`Te han invitado al panel de ${restaurantName}`}</Preview>
      <Body style={{ backgroundColor: '#F8F5EF', color: '#0A1330', fontFamily: 'Archivo, Arial, sans-serif' }}>
        <Container style={{ maxWidth: 520, margin: '0 auto', padding: '32px 24px' }}>
          <Text style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>{BRAND.productName}</Text>
          <Heading as="h1" style={{ fontSize: 26, lineHeight: '30px', margin: '24px 0 12px' }}>
            Te esperamos en {restaurantName}
          </Heading>
          <Text style={{ fontSize: 16, lineHeight: '24px' }}>
            Te han invitado a gestionar {restaurantName} en {BRAND.productName} como <strong>{roleLabel}</strong>.
          </Text>
          <Text style={{ fontSize: 16, lineHeight: '24px' }}>Pulsa el botón para crear tu acceso. El enlace caduca en 7 días.</Text>
          <Section style={{ margin: '24px 0' }}>
            <Button
              href={inviteUrl}
              style={{ backgroundColor: '#FF7A1A', color: '#0A1330', padding: '14px 24px', borderRadius: 6, fontWeight: 700 }}
            >
              Aceptar invitación
            </Button>
          </Section>
          <Text style={small}>Si el botón no funciona, copia este enlace en el navegador: {inviteUrl}</Text>
          <Text style={small}>Si no esperabas este email, puedes ignorarlo.</Text>
          <Text style={{ ...small, fontSize: 12, marginTop: 32 }}>
            {BRAND.productName} · un producto de {BRAND.company}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
