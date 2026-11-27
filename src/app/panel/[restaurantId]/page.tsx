import Link from 'next/link';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { PublishCard } from '@/components/onboarding/PublishCard';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { requirePanelAccess } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { getMissingFields, getRestaurantLocal, getRestaurantSchedule } from '@/lib/local/data';
import { missingFieldLinks, onboardingSteps, type MissingFieldLink } from '@/lib/onboarding';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { countTables } from '@/lib/reservations/data';

export default async function PanelHome({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId);
  const { status, slug } = ctx.restaurant;
  const canEdit = can(ctx.role, 'restaurant.edit');

  let setup: { steps: ReturnType<typeof onboardingSteps>; missing: MissingFieldLink[] } | null = null;
  if (status === 'setup' && canEdit) {
    const [{ profile, descriptions }, { services }, missing, tablesCount] = await Promise.all([
      getRestaurantLocal(restaurantId),
      getRestaurantSchedule(restaurantId),
      getMissingFields(restaurantId),
      countTables(restaurantId),
    ]);
    setup = {
      steps: onboardingSteps(restaurantId, {
        status,
        addressLine: profile.addressLine,
        postalCode: profile.postalCode,
        city: profile.city,
        phone: profile.phone,
        contactEmail: profile.contactEmail,
        logoPath: profile.logoPath,
        coverPath: profile.coverPath,
        servicesCount: services.length,
        tablesCount,
        enabledLocales: profile.enabledLocales,
        descriptionLocales: Object.keys(descriptions),
      }),
      missing: missingFieldLinks(restaurantId, missing),
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">{ctx.restaurant.name}</h1>
        <StatusBadge status={status} />
      </div>

      {status === 'active' && (
        <Card>
          <p>
            Tu web está publicada en{' '}
            <Link href={`/${slug}`} target="_blank" className="font-bold text-navy hover:underline">
              {siteUrl()}/{slug}
            </Link>
            .
          </p>
        </Card>
      )}

      {status === 'setup' && !canEdit && (
        <Card>
          <p>Tu administrador está preparando la web del restaurante. Cuando la publique, la verás aquí.</p>
        </Card>
      )}

      {setup && (
        <>
          <OnboardingChecklist steps={setup.steps} />
          <PublishCard restaurantId={restaurantId} missing={setup.missing} readOnly={ctx.readOnly} />
        </>
      )}

      <Card>
        <p>
          Entras como <strong>{ROLE_LABELS[ctx.role]}</strong>.{' '}
          <Link href={`/panel/${restaurantId}/reservas`} className="font-bold text-navy hover:underline">
            Ver las reservas de hoy
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
