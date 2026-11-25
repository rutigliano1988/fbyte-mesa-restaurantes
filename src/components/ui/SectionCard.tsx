import { Card } from './Card';

export function SectionCard({
  id,
  title,
  intro,
  children,
}: {
  id?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-extrabold">{title}</h2>
          {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
        </div>
        {children}
      </Card>
    </section>
  );
}
