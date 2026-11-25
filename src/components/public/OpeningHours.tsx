import type { PublicMessages } from '@/lib/i18n/messages';
import { formatDateEs, formatRange, groupByWeekday, WEEKDAYS, type ScheduleException, type ServiceSlot } from '@/lib/schedule';

export function OpeningHours({
  services,
  upcoming,
  messages: m,
}: {
  services: ServiceSlot[];
  upcoming: ScheduleException[];
  messages: PublicMessages;
}) {
  const byDay = groupByWeekday(services);
  return (
    <div className="flex flex-col gap-6">
      {services.length === 0 ? (
        <p className="text-neutral-600">{m.noHours}</p>
      ) : (
        <dl className="divide-y divide-neutral-200">
          {WEEKDAYS.map((day) => (
            <div key={day} className="flex justify-between gap-4 py-2">
              <dt className="font-semibold">{m.weekdays[day - 1]}</dt>
              <dd className="text-right">
                {byDay[day].length === 0 ? (
                  <span className="text-neutral-500">{m.closed}</span>
                ) : (
                  byDay[day].map((s) => formatRange(s.startMinute, s.endMinute)).join(' · ')
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {upcoming.length > 0 && (
        <div>
          <h3 className="font-bold">{m.upcoming}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {upcoming.map((e) => {
              const from = formatDateEs(e.dateFrom);
              const to = formatDateEs(e.dateTo);
              const times = e.customServices.map((s) => formatRange(s.startMinute, s.endMinute)).join(' · ');
              return (
                <li key={`${e.dateFrom}-${e.dateTo}`}>
                  {e.kind === 'closed' ? m.closedOn(from, to) : `${m.specialOn(from, to)}: ${times}`}
                  {e.note && <span className="text-neutral-500"> · {e.note}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
