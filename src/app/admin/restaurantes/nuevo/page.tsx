import type { Metadata } from 'next';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { CreateRestaurantForm } from './CreateRestaurantForm';

export const metadata: Metadata = { title: 'Nuevo restaurante' };

export default async function NewRestaurantPage() {
  await requirePlatformAdmin();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Nuevo restaurante</h1>
      <Card>
        <CreateRestaurantForm />
      </Card>
    </div>
  );
}
