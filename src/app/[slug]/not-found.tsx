import { BRAND } from '@/config/brand';

/** Slug que no existe, restaurante en configuración o desactivado: página neutra, sin marca FByte. */
export default function RestaurantNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 bg-white px-4 text-center text-neutral-900">
      <h1 className="text-2xl font-extrabold tracking-tight">Este restaurante no está disponible</h1>
      <p className="text-neutral-600">
        Puede que la dirección esté mal escrita o que el restaurante ya no esté en {BRAND.productName}.
      </p>
      <p lang="en" className="text-sm text-neutral-500">
        This restaurant is not available.
      </p>
    </main>
  );
}
