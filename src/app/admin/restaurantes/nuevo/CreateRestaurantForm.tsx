'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { slugify } from '@/lib/slug';
import { createRestaurant, type CreateRestaurantState } from './actions';

export function CreateRestaurantForm() {
  const [state, action] = useActionState<CreateRestaurantState, FormData>(createRestaurant, {});
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  if (state.restaurantId) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone={state.emailSent ? 'success' : 'info'}>
          {state.emailSent
            ? `Restaurante creado. Hemos enviado la invitación a ${state.email}.`
            : `Restaurante creado, pero no pudimos enviar el email a ${state.email}.`}{' '}
          {state.inviteUrl && (
            <>
              Si no le llega, pásale este enlace (caduca en 7 días):
              <input
                aria-label="Enlace de invitación"
                readOnly
                value={state.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 w-full rounded-[6px] border-2 border-ink/25 bg-white px-3 py-2 font-mono text-xs"
              />
            </>
          )}
        </Notice>
        <Link href={`/admin/restaurantes/${state.restaurantId}`} className={buttonClass('secondary')}>
          Ver el restaurante
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field
        label="Nombre del restaurante"
        name="name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        error={state.fieldErrors?.name}
        required
      />
      <Field
        label="Dirección pública"
        name="slug"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value);
        }}
        hint={`Su web será /${slug || 'nombre-del-restaurante'}. Solo minúsculas, números y guiones.`}
        error={state.fieldErrors?.slug}
        required
      />
      <Field
        label="Email del administrador"
        name="adminEmail"
        type="email"
        hint="Le llegará una invitación para crear su acceso."
        error={state.fieldErrors?.adminEmail}
        required
      />
      <SubmitButton pendingText="Creando…">Crear restaurante</SubmitButton>
    </form>
  );
}
