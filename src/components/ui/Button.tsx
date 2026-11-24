import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-orange text-ink hover:bg-orange-dark',
  secondary: 'border-2 border-ink bg-white text-ink hover:bg-peach-soft',
  ghost: 'text-navy underline-offset-4 hover:underline',
  danger: 'border-2 border-red-700 bg-white text-red-700 hover:bg-red-50',
};

export const buttonClass = (variant: ButtonVariant = 'primary', extra = '') =>
  `inline-flex items-center justify-center gap-2 rounded-[6px] px-5 py-3 font-bold transition-colors ` +
  `focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy ` +
  `disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}
