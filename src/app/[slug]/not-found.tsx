import { BRAND } from '@/config/brand';
import { getMessages } from '@/lib/i18n/messages';

/** Slug que no existe, restaurante en configuración o desactivado: página neutra, sin marca FByte.
 *  No conoce el idioma del restaurante: castellano e inglés, ambos desde los mensajes. */
export default function RestaurantNotFound() {
  const es = getMessages('es');
  const en = getMessages('en');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 bg-white px-4 text-center text-neutral-900">
      <h1 className="text-2xl font-extrabold tracking-tight">{es.notFoundTitle}</h1>
      <p className="text-neutral-600">{es.notFoundText(BRAND.productName)}</p>
      <p lang="en" className="text-sm text-neutral-500">
        {en.notFoundTitle}.
      </p>
    </main>
  );
}
