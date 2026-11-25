import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { OnboardingStep } from '@/lib/onboarding';

export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-extrabold">Pon tu web en marcha</h2>
        <p className="mt-1 text-sm text-muted">
          {done} de {steps.length} pasos hechos. Cada paso se marca solo cuando guardas los datos.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={step.key}>
            <Link href={step.href} className="flex items-start gap-3 rounded-[6px] p-2 hover:bg-peach-soft">
              <span
                aria-hidden="true"
                className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-sm font-bold ${step.done ? 'border-navy bg-navy text-white' : 'border-ink/30'}`}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <span>
                <span className="font-bold">{step.title}</span>
                <span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                <span className="block text-sm text-muted">{step.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
