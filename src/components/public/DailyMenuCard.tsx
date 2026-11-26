import Link from 'next/link';
import type { Locale } from '@/lib/i18n/locales';
import type { PublicMessages } from '@/lib/i18n/messages';
import { textFor } from '@/lib/menu/i18n-text';
import { formatCents } from '@/lib/menu/price';
import type { PublicMenu } from '@/lib/public/menu-schema';

/** Menú del día (o especial) que toca ahora, en la mini-web: nombre, precio, qué incluye y enlace. */
export function DailyMenuCard({
  menu,
  locale,
  messages: m,
  href,
}: {
  menu: PublicMenu;
  locale: Locale;
  messages: PublicMessages;
  href: string;
}) {
  const includes = textFor(menu.includes, locale);
  return (
    <section aria-labelledby="menu-del-dia" className="rounded-xl border-2 border-[var(--accent)] p-5">
      <p className="text-sm font-bold uppercase tracking-wide text-[var(--accent-text)]">{menu.kind === 'daily' ? m.dailyMenu : m.specialMenu}</p>
      <h2 id="menu-del-dia" className="text-2xl font-extrabold">
        {textFor(menu.names, locale)}
      </h2>
      {menu.priceCents !== null && <p className="mt-1 text-xl font-bold">{formatCents(menu.priceCents, locale)}</p>}
      {includes && (
        <p className="mt-1 text-neutral-700">
          <span className="font-semibold">{m.menuIncludes}:</span> {includes}
        </p>
      )}
      <Link href={href} className="mt-3 inline-flex items-center rounded-lg bg-[var(--accent)] px-5 py-3 font-bold text-[var(--on-accent)] hover:opacity-90">
        {m.viewDailyMenu}
      </Link>
    </section>
  );
}
