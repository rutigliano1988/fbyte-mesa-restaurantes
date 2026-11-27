'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useActionForm } from '@/components/forms/ActionForm';

/** Si la BD rechaza (p. ej., la mesa se acaba de ocupar), se vuelven a pedir los datos para proponer otra. */
export function RefreshOnError({ only }: { only?: string } = {}) {
  const { state } = useActionForm();
  const router = useRouter();
  useEffect(() => {
    if (state.error && (only === undefined || state.error === only)) router.refresh();
  }, [state, only, router]);
  return null;
}
