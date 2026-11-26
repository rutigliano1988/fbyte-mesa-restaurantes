'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { setDishUnavailable } from '@/lib/actions/dishes';

/** Interruptor de «Agotado», grande para usarlo con el móvil en pleno servicio. Cambia al momento y se guarda detrás. */
export function UnavailableSwitch({
  restaurantId,
  dishId,
  dishName,
  unavailable,
  disabled = false,
}: {
  restaurantId: string;
  dishId: string;
  dishName: string;
  unavailable: boolean;
  disabled?: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(unavailable);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !optimistic;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setDishUnavailable(restaurantId, dishId, next);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={optimistic}
        aria-label={`Agotado: ${dishName}`}
        aria-busy={pending}
        disabled={disabled}
        onClick={toggle}
        className={
          'inline-flex min-h-12 min-w-36 items-center justify-center gap-2 rounded-full border-2 px-4 font-bold transition-colors ' +
          'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50 ' +
          (optimistic ? 'border-ink bg-ink text-white' : 'border-ink/25 bg-white text-ink')
        }
      >
        <span aria-hidden="true" className={`size-3 rounded-full ${optimistic ? 'bg-peach' : 'bg-ink/25'}`} />
        {optimistic ? 'Agotado' : 'Disponible'}
      </button>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
