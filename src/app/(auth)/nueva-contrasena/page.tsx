import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/guards';
import { NewPasswordForm } from './NewPasswordForm';

export const metadata: Metadata = { title: 'Nueva contraseña' };

export default async function NewPasswordPage() {
  await requireUser('/nueva-contrasena');
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Crea tu contraseña nueva</h1>
      <NewPasswordForm />
    </div>
  );
}
