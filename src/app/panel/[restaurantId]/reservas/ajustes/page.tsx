import type { Metadata } from 'next';
import { BookingSettingsForm } from '@/components/reservations/BookingSettingsForm';
import { ReservationsNav } from '@/components/reservations/ReservationsNav';
import { NewTableForm, NewZoneForm, TableEditor, ZoneEditor } from '@/components/reservations/TableSettings';
import { SectionCard } from '@/components/ui/SectionCard';
import { requirePanelAccess } from '@/lib/auth/guards';
import { compareTablesForDisplay } from '@/lib/reservations/availability';
import { BOOKING_LIMITS } from '@/lib/reservations/codes';
import { getBookingConfig } from '@/lib/reservations/data';

export const metadata: Metadata = { title: 'Ajustes de reservas' };

export default async function BookingSettingsPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await requirePanelAccess(restaurantId, 'settings.booking');
  const config = await getBookingConfig(restaurantId);
  const readOnly = ctx.readOnly;
  const tables = [...config.tables].sort(compareTablesForDisplay);

  return (
    <div className="flex flex-col gap-6">
      <ReservationsNav restaurantId={restaurantId} current="ajustes" canConfigure />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Ajustes de reservas</h1>
        <p className="mt-1 text-muted">Tus zonas y mesas, cuánto dura una reserva y las reglas de la reserva online. El horario está en «Horario».</p>
      </header>

      <SectionCard id="zonas" title="Zonas" intro={`Sala, terraza, reservado… Como mucho ${BOOKING_LIMITS.zones}. Se ordenan de menor a mayor.`}>
        {config.zones.length === 0 ? (
          <p className="text-sm text-muted">Aún no tienes zonas. Si creas una mesa sin zona, la pondremos en «Sala».</p>
        ) : (
          <ul>
            {config.zones.map((z) => (
              <ZoneEditor key={z.id} restaurantId={restaurantId} zone={z} tableCount={tables.filter((t) => t.zoneId === z.id).length} readOnly={readOnly} />
            ))}
          </ul>
        )}
        {!readOnly && config.zones.length < BOOKING_LIMITS.zones && <NewZoneForm restaurantId={restaurantId} />}
      </SectionCard>

      <SectionCard
        id="mesas"
        title="Mesas"
        intro={`Como mucho ${BOOKING_LIMITS.tables}. Una mesa con reservas por delante no se borra: desactívala y no saldrá para reservas nuevas.`}
      >
        {tables.length === 0 ? (
          <p className="text-sm text-muted">Aún no tienes mesas. Crea la primera aquí abajo.</p>
        ) : (
          <ul>
            {tables.map((t) => (
              <TableEditor key={t.id} restaurantId={restaurantId} zones={config.zones} table={t} readOnly={readOnly} />
            ))}
          </ul>
        )}
        {!readOnly && tables.length < BOOKING_LIMITS.tables && <NewTableForm restaurantId={restaurantId} zones={config.zones} />}
      </SectionCard>

      <SectionCard id="duracion" title="Duración y reglas">
        <BookingSettingsForm restaurantId={restaurantId} settings={config.settings} readOnly={readOnly} />
      </SectionCard>
    </div>
  );
}
