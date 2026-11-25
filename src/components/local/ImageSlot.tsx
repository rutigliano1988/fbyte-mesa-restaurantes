import Image from 'next/image';
import { removeRestaurantImage } from '@/lib/actions/media';
import { ImageUploader } from './ImageUploader';

/** Logo o portada: vista previa, subir y quitar. */
export function ImageSlot({
  restaurantId,
  kind,
  title,
  hint,
  url,
  readOnly,
}: {
  restaurantId: string;
  kind: 'logo' | 'cover';
  title: string;
  hint: string;
  url: string | null;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-bold">{title}</h3>
      <div
        className={`relative overflow-hidden rounded-[6px] border-2 border-ink/15 bg-paper ${kind === 'logo' ? 'size-32' : 'aspect-video w-full'}`}
      >
        {url ? (
          <Image src={url} alt="" fill unoptimized sizes="(min-width: 640px) 50vw, 100vw" className={kind === 'logo' ? 'object-contain' : 'object-cover'} />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-sm text-muted">Sin imagen</span>
        )}
      </div>
      <p className="text-sm text-muted">{hint}</p>
      {!readOnly && (
        <div className="flex flex-wrap items-start gap-3">
          <ImageUploader restaurantId={restaurantId} kind={kind} label={url ? 'Cambiar' : 'Subir'} />
          {url && (
            <form action={removeRestaurantImage}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="kind" value={kind} />
              <button
                type="submit"
                aria-label={kind === 'logo' ? 'Quitar el logo' : 'Quitar la portada'}
                className="px-2 py-3 text-sm font-bold text-navy hover:underline"
              >
                Quitar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
