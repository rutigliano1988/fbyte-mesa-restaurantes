import Link from 'next/link';
import { ActionForm, FormCheckbox } from '@/components/forms/ActionForm';
import { Card } from '@/components/ui/Card';
import { publishRestaurant } from '@/lib/actions/publish';
import { DPA_SECTIONS, DPA_TITLE, DPA_VERSION, LEGAL_REVIEW_PENDING } from '@/lib/legal/dpa';
import type { MissingFieldLink } from '@/lib/onboarding';

/** Marca de plantilla legal sin revisar: ink sobre melocotón, con borde naranja (paleta FByte). */
const LEGAL_PENDING_CLASS = 'w-fit rounded-[6px] border-2 border-orange bg-peach-soft px-2 py-1 text-sm font-extrabold text-ink';

export function PublishCard({
  restaurantId,
  missing,
  readOnly,
}: {
  restaurantId: string;
  missing: MissingFieldLink[];
  readOnly: boolean;
}) {
  return (
    <section id="publicar" className="scroll-mt-6">
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-extrabold">Publicar tu web</h2>
        {missing.length > 0 ? (
          <div>
            <p>Antes de publicar, te falta:</p>
            <ul className="mt-2 list-disc pl-6">
              {missing.map((m) => (
                <li key={m.code}>
                  <Link href={m.href} className="font-bold text-navy underline-offset-4 hover:underline">
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>Ya está todo. Lee el contrato, acéptalo y publica.</p>
        )}
        <details className="rounded-[6px] border-2 border-ink/15 bg-paper p-4">
          <summary className="cursor-pointer font-bold">Leer el {DPA_TITLE.toLowerCase()}</summary>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p className={LEGAL_PENDING_CLASS}>{LEGAL_REVIEW_PENDING}</p>
            {DPA_SECTIONS.map((s) => (
              <div key={s.heading}>
                <h3 className="font-bold">{s.heading}</h3>
                <p>{s.body}</p>
              </div>
            ))}
            <p className="text-muted">Versión {DPA_VERSION}</p>
          </div>
        </details>
        <ActionForm
          action={publishRestaurant}
          hidden={{ restaurantId }}
          readOnly={readOnly}
          submitLabel="Publicar mi web"
          pendingLabel="Publicando…"
          submitDisabled={missing.length > 0}
        >
          <p className={LEGAL_PENDING_CLASS}>{LEGAL_REVIEW_PENDING}</p>
          <FormCheckbox name="accept" label={`He leído y acepto el ${DPA_TITLE.toLowerCase()} en nombre del restaurante.`} />
        </ActionForm>
      </Card>
    </section>
  );
}
