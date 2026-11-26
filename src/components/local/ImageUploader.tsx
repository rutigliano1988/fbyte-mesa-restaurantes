'use client';

import { useState, useTransition } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { uploadDishPhoto } from '@/lib/actions/dishes';
import { uploadRestaurantImage } from '@/lib/actions/media';
import type { FormState } from '@/lib/forms';
import { checkSourceFile, compressImage, type ImageTarget } from '@/lib/images/compress';

/**
 * Elige fotos, las reduce y pasa a WebP en el navegador y las sube una a una con la server action.
 * kind="dish" (con dishId) sube la foto de un plato; el resto, las imágenes del local.
 */
export function ImageUploader({
  restaurantId,
  kind,
  dishId,
  label,
  multiple = false,
  disabled = false,
}: {
  restaurantId: string;
  kind: ImageTarget;
  dishId?: string;
  label: string;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  function upload(files: File[]) {
    startTransition(async () => {
      setState({});
      for (const file of files) {
        const problem = checkSourceFile(file);
        if (problem) {
          setState({ error: problem });
          return;
        }
        let blob: Blob;
        try {
          blob = await compressImage(file, kind);
        } catch {
          setState({ error: 'No hemos podido preparar esa foto. Prueba con otra.' });
          return;
        }
        const fd = new FormData();
        fd.set('restaurantId', restaurantId);
        fd.set('kind', kind);
        if (dishId) fd.set('dishId', dishId);
        fd.set('file', new File([blob], blob.type === 'image/webp' ? 'foto.webp' : 'foto.jpg', { type: blob.type }));
        const result = await (kind === 'dish' ? uploadDishPhoto(fd) : uploadRestaurantImage(fd));
        setState(result);
        if (result.error) return;
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* El input real es sr-only: el foco se ve en la etiqueta con forma de botón, como en Button. */}
      <label
        className={buttonClass(
          'secondary',
          'focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-navy ' +
            (disabled || pending ? 'pointer-events-none opacity-50' : 'cursor-pointer'),
        )}
      >
        {pending ? 'Subiendo…' : label}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={multiple}
          disabled={disabled || pending}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length) upload(files);
          }}
        />
      </label>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.success && !pending && <Notice tone="success">{state.success}</Notice>}
    </div>
  );
}
