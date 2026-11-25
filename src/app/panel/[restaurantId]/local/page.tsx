import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, FormCheckboxGroup, FormField, FormSelect, FormTextArea } from '@/components/forms/ActionForm';
import { AccentColorField } from '@/components/local/AccentColorField';
import { Gallery } from '@/components/local/Gallery';
import { ImageSlot } from '@/components/local/ImageSlot';
import { Notice } from '@/components/ui/Notice';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  changeSlug,
  saveAccentColor,
  saveBasics,
  saveContact,
  saveLanguages,
  saveLegal,
  saveSocial,
} from '@/lib/actions/restaurant';
import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { LOCALE_LABELS_ES, LOCALES } from '@/lib/i18n/locales';
import { getRestaurantLocal } from '@/lib/local/data';
import { mediaUrl } from '@/lib/public/data';

export const metadata: Metadata = { title: 'Local' };

const PRICE_OPTIONS = [
  { value: '', label: 'Sin indicar' },
  { value: '1', label: '€ · económico' },
  { value: '2', label: '€€ · normal' },
  { value: '3', label: '€€€ · alto' },
  { value: '4', label: '€€€€ · muy alto' },
];

const TIMEZONE_OPTIONS = [
  { value: 'Europe/Madrid', label: 'Península, Baleares, Ceuta y Melilla' },
  { value: 'Atlantic/Canary', label: 'Canarias' },
];

export default async function LocalPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'restaurant.edit');
  const readOnly = ctx.readOnly;
  const { profile, descriptions, photos, oldSlugs } = await getRestaurantLocal(restaurantId);
  const hidden = { restaurantId };
  const publicUrl = `${siteUrl()}/${profile.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Tu local</h1>
        <p className="mt-1 text-muted">
          Esto es lo que verán tus clientes en tu web.{' '}
          {profile.status === 'active' ? (
            <Link href={`/${profile.slug}`} target="_blank" className="font-bold text-navy hover:underline">
              Ver mi web
            </Link>
          ) : (
            'Se verá cuando la publiques desde el inicio del panel.'
          )}
        </p>
      </header>

      <SectionCard id="datos-basicos" title="Datos básicos" intro="El nombre, qué cocina haces y una descripción corta.">
        <ActionForm action={saveBasics} hidden={hidden} readOnly={readOnly}>
          <FormField label="Nombre del restaurante" name="name" defaultValue={profile.name} maxLength={120} required />
          <FormField
            label="Tipo de cocina"
            name="cuisine"
            defaultValue={profile.cuisine ?? ''}
            maxLength={60}
            hint="Por ejemplo: mediterránea, japonesa, de mercado."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect label="Rango de precio" name="priceRange" defaultValue={profile.priceRange ? String(profile.priceRange) : ''} options={PRICE_OPTIONS} />
            <FormSelect label="Dónde está" name="timezone" defaultValue={profile.timezone} options={TIMEZONE_OPTIONS} />
          </div>
          {profile.enabledLocales.map((locale) => (
            <FormTextArea
              key={locale}
              label={`Descripción (${LOCALE_LABELS_ES[locale]})`}
              name={`description_${locale}`}
              defaultValue={descriptions[locale] ?? ''}
              maxLength={1000}
              rows={4}
              hint={
                locale === 'es'
                  ? 'Cuenta en pocas líneas qué hace especial tu restaurante. Máximo 1000 caracteres.'
                  : 'Si la dejas vacía, se muestra la de castellano.'
              }
            />
          ))}
        </ActionForm>
      </SectionCard>

      <SectionCard id="contacto" title="Contacto y ubicación" intro="Para que te encuentren y te llamen. Hace falta un teléfono o un email.">
        <ActionForm action={saveContact} hidden={hidden} readOnly={readOnly}>
          <FormField label="Calle y número" name="addressLine" defaultValue={profile.addressLine ?? ''} maxLength={200} autoComplete="street-address" />
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <FormField label="Código postal" name="postalCode" defaultValue={profile.postalCode ?? ''} inputMode="numeric" maxLength={5} autoComplete="postal-code" />
            <FormField label="Ciudad" name="city" defaultValue={profile.city ?? ''} maxLength={100} autoComplete="address-level2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Teléfono" name="phone" type="tel" defaultValue={profile.phone ?? ''} autoComplete="tel" />
            <FormField label="Email de contacto" name="contactEmail" type="email" defaultValue={profile.contactEmail ?? ''} autoComplete="email" />
          </div>
          <FormField label="Web" name="website" defaultValue={profile.website ?? ''} placeholder="https://turestaurante.es" hint="Si ya tienes otra web. Es opcional." />
        </ActionForm>
      </SectionCard>

      <SectionCard id="redes" title="Redes sociales" intro="Escribe tu usuario o pega el enlace. Lo dejamos bien escrito.">
        <ActionForm action={saveSocial} hidden={hidden} readOnly={readOnly}>
          <FormField label="Instagram" name="instagram" defaultValue={profile.instagram ?? ''} placeholder="@turestaurante" />
          <FormField label="Facebook" name="facebook" defaultValue={profile.facebook ?? ''} placeholder="https://www.facebook.com/turestaurante" />
          <FormField label="TikTok" name="tiktok" defaultValue={profile.tiktok ?? ''} placeholder="@turestaurante" />
        </ActionForm>
      </SectionCard>

      <SectionCard id="imagen" title="Imagen" intro="Logo, foto de portada y el color de los botones de tu web.">
        <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
          <ImageSlot
            restaurantId={restaurantId}
            kind="logo"
            title="Logo"
            hint="Cuadrado, mejor con fondo transparente."
            url={profile.logoPath ? mediaUrl(profile.logoPath) : null}
            readOnly={readOnly}
          />
          <ImageSlot
            restaurantId={restaurantId}
            kind="cover"
            title="Portada"
            hint="Una foto horizontal del local o de un plato."
            url={profile.coverPath ? mediaUrl(profile.coverPath) : null}
            readOnly={readOnly}
          />
        </div>
        <ActionForm action={saveAccentColor} hidden={hidden} readOnly={readOnly} submitLabel="Guardar color">
          <AccentColorField defaultValue={profile.accentColor} />
        </ActionForm>
      </SectionCard>

      <SectionCard id="galeria" title="Galería" intro="Fotos del local y de tus platos. La primera es la que se ve antes.">
        <Gallery restaurantId={restaurantId} photos={photos.map((p) => ({ id: p.id, url: mediaUrl(p.path) }))} readOnly={readOnly} />
      </SectionCard>

      <SectionCard id="idiomas" title="Idiomas" intro="En qué idiomas se ve tu web. El castellano va siempre.">
        <ActionForm action={saveLanguages} hidden={hidden} readOnly={readOnly}>
          <FormCheckboxGroup
            legend="Idiomas de tu web"
            name="locales"
            options={LOCALES.map((l) => ({
              value: l,
              label: LOCALE_LABELS_ES[l],
              defaultChecked: profile.enabledLocales.includes(l),
              disabled: l === 'es',
            }))}
          />
          <p className="text-sm text-muted">Los botones y textos de la web se traducen solos. Tu descripción la escribes tú en «Datos básicos».</p>
        </ActionForm>
      </SectionCard>

      <SectionCard id="direccion" title="Dirección de tu web" intro={publicUrl}>
        <Notice tone="info">
          Si la cambias, la dirección antigua seguirá llevando a la nueva, así que los QR que ya tengas impresos siguen valiendo.
        </Notice>
        <ActionForm action={changeSlug} hidden={hidden} readOnly={readOnly} submitLabel="Cambiar dirección" pendingLabel="Cambiando…">
          <FormField label="Dirección" name="slug" defaultValue={profile.slug} maxLength={60} hint="Solo minúsculas, números y guiones." required />
        </ActionForm>
        {oldSlugs.length > 0 && (
          <p className="text-sm text-muted">Direcciones antiguas que siguen funcionando: {oldSlugs.map((s) => `/${s}`).join(', ')}</p>
        )}
      </SectionCard>

      <SectionCard id="datos-fiscales" title="Datos fiscales" intro="Salen en el aviso legal de tu web. La ley lo pide.">
        <ActionForm action={saveLegal} hidden={hidden} readOnly={readOnly}>
          <FormField label="Razón social" name="legalName" defaultValue={profile.legalName ?? ''} maxLength={200} hint="El nombre de tu empresa, o el tuyo si eres autónomo." />
          <FormField label="CIF o NIF" name="taxId" defaultValue={profile.taxId ?? ''} maxLength={12} autoCapitalize="characters" />
        </ActionForm>
      </SectionCard>
    </div>
  );
}
