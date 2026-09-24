import type { ComponentProps } from 'react';

const VARIANTS = {
  primary: 'bg-sun text-ink hover:brightness-105',
  secondary: 'border border-line bg-transparent text-cloud hover:bg-raised',
  danger: 'bg-coral text-ink hover:brightness-110',
  'danger-outline':
    'border border-coral/65 bg-coral/10 text-coral hover:border-coral hover:bg-coral/20',
  plain: '',
} as const;

export function Button({
  variant = 'plain',
  className = '',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      type={type}
      className={`desk-control focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-sun disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
