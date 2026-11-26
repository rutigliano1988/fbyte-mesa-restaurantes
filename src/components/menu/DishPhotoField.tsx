import Image from 'next/image';
import { ImageUploader } from '@/components/local/ImageUploader';
import { removeDishPhoto } from '@/lib/actions/dishes';

/** Foto del plato: vista previa, subir (reducida a 1200 px en el navegador) y quitar. */
export function DishPhotoField({
  restaurantId,
  dishId,
  dishName,
  url,
  readOnly,
}: {
  restaurantId: string;
  dishId: string;
  dishName: string;
  url: string | null;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full max-w-sm overflow-hidden rounded-[6px] border-2 border-ink/15 bg-paper">
        {url ? (
          <Image src={url} alt={`Foto de ${dishName}`} fill unoptimized sizes="384px" className="object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-sm text-muted">Sin foto</span>
        )}
      </div>
      <p className="text-sm text-muted">Opcional. JPG, PNG o WebP: la reducimos antes de subirla.</p>
      {!readOnly && (
        <div className="flex flex-wrap items-start gap-3">
          <ImageUploader restaurantId={restaurantId} kind="dish" dishId={dishId} label={url ? 'Cambiar foto' : 'Subir foto'} />
          {url && (
            <form action={removeDishPhoto}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="dishId" value={dishId} />
              <button type="submit" aria-label={`Quitar la foto de «${dishName}»`} className="px-2 py-3 text-sm font-bold text-navy hover:underline">
                Quitar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
