'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonVariant } from './Button';

export function SubmitButton({
  children,
  pendingText = 'Un momento…',
  variant = 'primary',
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingText : children}
    </Button>
  );
}
