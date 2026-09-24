import type { ComponentProps } from 'react';

const SIZES = {
  help: 'max-w-dialog rounded-2xl p-6',
  confirmation: 'max-w-confirmation rounded-xl p-6 sm:p-7',
};

/** The native dialog owns focus trapping and Escape; callers restore focus on close. */
export function Dialog({
  size = 'help',
  className = '',
  ...props
}: ComponentProps<'dialog'> & { size?: keyof typeof SIZES }) {
  return (
    <dialog
      className={`help-dialog m-auto max-h-[85dvh] w-[calc(100%-2rem)] border border-line bg-panel text-cloud backdrop:bg-black/65 ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
