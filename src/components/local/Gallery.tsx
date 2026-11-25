import Image from 'next/image';
import { deletePhoto, movePhoto } from '@/lib/actions/media';
import { MAX_GALLERY_PHOTOS } from '@/lib/media';
import { ImageUploader } from './ImageUploader';

export function Gallery({
  restaurantId,
  photos,
  readOnly,
}: {
  restaurantId: string;
  photos: { id: string; url: string }[];
  readOnly: boolean;
}) {
  const full = photos.length >= MAX_GALLERY_PHOTOS;
  return (
    <div className="flex flex-col gap-4">
      {photos.length === 0 ? (
        <p className="text-sm text-muted">Aún no hay fotos. Sube las que mejor enseñen tu local y tus platos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[6px] border-2 border-ink/15">
                <Image src={p.url} alt={`Foto ${i + 1}`} fill unoptimized sizes="(min-width: 640px) 33vw, 50vw" className="object-cover" />
              </div>
              {!readOnly && (
                <div className="flex items-center justify-between gap-1 text-sm font-bold">
                  <span className="flex gap-1">
                    {(['up', 'down'] as const).map((direction) => (
                      <form key={direction} action={movePhoto}>
                        <input type="hidden" name="restaurantId" value={restaurantId} />
                        <input type="hidden" name="photoId" value={p.id} />
                        <input type="hidden" name="direction" value={direction} />
                        <button
                          type="submit"
                          disabled={direction === 'up' ? i === 0 : i === photos.length - 1}
                          aria-label={direction === 'up' ? `Mover la foto ${i + 1} antes` : `Mover la foto ${i + 1} después`}
                          className="rounded-[6px] px-2 py-1 hover:bg-peach-soft disabled:opacity-30"
                        >
                          {direction === 'up' ? '←' : '→'}
                        </button>
                      </form>
                    ))}
                  </span>
                  <form action={deletePhoto}>
                    <input type="hidden" name="restaurantId" value={restaurantId} />
                    <input type="hidden" name="photoId" value={p.id} />
                    <button type="submit" className="px-2 py-1 text-red-700 hover:underline">
                      Borrar
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-col gap-1">
          <ImageUploader restaurantId={restaurantId} kind="gallery" label="Añadir fotos" multiple disabled={full} />
          <p className="text-sm text-muted">
            {full ? `Has llegado al máximo de ${MAX_GALLERY_PHOTOS} fotos.` : `Hasta ${MAX_GALLERY_PHOTOS} fotos. Las reducimos antes de subirlas.`}
          </p>
        </div>
      )}
    </div>
  );
}
