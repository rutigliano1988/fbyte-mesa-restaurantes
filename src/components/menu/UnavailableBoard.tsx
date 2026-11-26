import { nameEs, type PanelDish } from '@/lib/menu/tree';
import { UnavailableSwitch } from './UnavailableSwitch';

/** Pantalla de agotados: los platos agrupados por carta, con su interruptor. Nada más. */
export function UnavailableBoard({
  restaurantId,
  groups,
  readOnly,
}: {
  restaurantId: string;
  groups: { id: string; title: string; dishes: PanelDish[] }[];
  readOnly: boolean;
}) {
  if (groups.length === 0) {
    return <p className="text-muted">Todavía no hay platos. Cuando el Administrador o el Encargado los añadan, los verás aquí.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`agotados-${group.id}`} className="flex flex-col gap-2">
          <h2 id={`agotados-${group.id}`} className="text-xl font-extrabold">
            {group.title}
          </h2>
          <ul className="divide-y divide-ink/10 rounded-[6px] border-2 border-ink/10 bg-white">
            {group.dishes.map((dish) => (
              <li key={dish.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className={`font-bold ${dish.unavailable ? 'text-muted line-through' : ''}`}>{nameEs(dish.names)}</span>
                <UnavailableSwitch
                  restaurantId={restaurantId}
                  dishId={dish.id}
                  dishName={nameEs(dish.names)}
                  unavailable={dish.unavailable}
                  disabled={readOnly}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
