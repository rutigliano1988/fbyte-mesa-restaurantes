'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isShownBlockDelete } from '@/lib/reservations/realtime';
import { browserClient } from '@/lib/supabase/browser';

type LiveState = 'connecting' | 'live' | 'offline';

const TEXT: Record<LiveState, string> = {
  connecting: 'Conectando para ver los cambios en directo…',
  live: 'En directo: los cambios de otros dispositivos salen solos.',
  offline: 'Sin conexión en directo. Recarga la página para ver los cambios de otros dispositivos.',
};

/**
 * Escucha los cambios de reservas, mesas de reserva y bloqueos del restaurante (Supabase Realtime, con las RLS del
 * usuario) y refresca la página. Los borrados no se pueden filtrar por restaurante (con RLS solo traen la clave):
 * - `reservation_tables`: no se escuchan; todo cambio de mesas pasa por una función que también escribe en
 *   `reservations`, cuyos eventos sí van filtrados.
 * - `blocks`: solo si la página pasa `blockIds`, y solo refresca si el borrado es de uno de esos bloqueos.
 * Al reconectar (y al volver a la pestaña) refresca: los cambios de mientras no han llegado.
 */
export function RealtimeRefresh({ restaurantId, blockIds }: { restaurantId: string; blockIds?: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>('connecting');
  // Los bloqueos que se ven cambian con cada refresco: se leen de una ref para no volver a suscribirse.
  const shownBlocks = useRef<string[]>([]);
  useEffect(() => {
    shownBlocks.current = blockIds ?? [];
  }, [blockIds]);
  const watchBlockDeletes = blockIds !== undefined;
  // ¿Ya se ha conectado alguna vez? Un SUBSCRIBED posterior es una reconexión (o un canal nuevo): hay que refrescar.
  const subscribedBefore = useRef(false);

  useEffect(() => {
    let active = true;
    const supabase = browserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) router.refresh();
      }, 400);
    };
    const filter = `restaurant_id=eq.${restaurantId}`;
    const channel = supabase.channel(`reservas:${restaurantId}`);
    for (const table of ['reservations', 'reservation_tables', 'blocks']) {
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, refresh);
    }
    if (watchBlockDeletes) {
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'blocks' }, (payload) => {
        if (isShownBlockDelete(payload.old, shownBlocks.current)) refresh();
      });
    }
    channel.subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        setState('live');
        // Reconexión: lo que cambió mientras no había conexión no llega solo.
        if (subscribedBefore.current) refresh();
        subscribedBefore.current = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setState('offline');
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel).catch(() => {});
    };
  }, [restaurantId, router, watchBlockDeletes]);

  return (
    <p role="status" className="text-sm text-muted">
      <span aria-hidden="true" className={`mr-2 inline-block size-2 rounded-full ${state === 'live' ? 'bg-navy' : state === 'offline' ? 'bg-red-700' : 'bg-ink/30'}`} />
      {TEXT[state]}
    </p>
  );
}
