'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
 * cualquier borrado refresca.
 */
export function RealtimeRefresh({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    const supabase = browserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const filter = `restaurant_id=eq.${restaurantId}`;
    const channel = supabase.channel(`reservas:${restaurantId}`);
    for (const table of ['reservations', 'reservation_tables', 'blocks']) {
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, refresh);
    }
    for (const table of ['reservation_tables', 'blocks']) {
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, refresh);
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') setState('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setState('offline');
    });
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel).catch(() => {});
    };
  }, [restaurantId, router]);

  return (
    <p role="status" className="text-sm text-muted">
      <span aria-hidden="true" className={`mr-2 inline-block size-2 rounded-full ${state === 'live' ? 'bg-navy' : state === 'offline' ? 'bg-red-700' : 'bg-ink/30'}`} />
      {TEXT[state]}
    </p>
  );
}
