import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Small shared pieces: class joiner, buttons, icons, company tiles. */

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

const focusRing = 'focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-sun';
const pressable =
  'transition hover:brightness-110 active:translate-y-px disabled:opacity-40 disabled:hover:brightness-100 disabled:active:translate-y-0';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** The one loud button on every screen. */
export function PrimaryButton({ className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('rounded-2xl bg-sun px-8 font-display font-extrabold text-ink', pressable, focusRing, className)}
      {...props}
    />
  );
}

export function GhostButton({ tone = 'line', className, ...props }: ButtonProps & { tone?: 'line' | 'sun' }) {
  const tones = {
    line: 'border-line text-cloud text-sm font-semibold',
    sun: 'border-sun text-sun font-display font-bold text-[15px]',
  };
  return (
    <button
      type="button"
      className={cx('rounded-2xl border-2 bg-transparent', tones[tone], pressable, focusRing, className)}
      {...props}
    />
  );
}

/** A selectable card or pill. `selected` drives aria-pressed so it reads correctly to screen readers. */
export function ChoiceButton({ selected, className, ...props }: ButtonProps & { selected: boolean }) {
  return <button type="button" aria-pressed={selected} className={cx(pressable, focusRing, className)} {...props} />;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const LogoMark = () => (
  <span className="flex size-10 items-center justify-center rounded-xl bg-sun text-ink">
    <svg viewBox="0 0 24 24" className="size-6" strokeWidth="2.6" {...stroke} aria-hidden="true">
      <path d="M4 16l5-6 4 4 7-9" />
      <path d="M15 5h5v5" />
    </svg>
  </span>
);

export const ArrowUp = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} strokeWidth="3" {...stroke} aria-hidden="true">
    <path d="M6 18L18 6" />
    <path d="M9 6h9v9" />
  </svg>
);

export const ArrowDown = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} strokeWidth="3" {...stroke} aria-hidden="true">
    <path d="M6 6l12 12" />
    <path d="M18 9v9H9" />
  </svg>
);

export const Bulb = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} strokeWidth="2" {...stroke} aria-hidden="true">
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </svg>
);

/*
 * Generated company marks: a tile in the company's own tint holding a small
 * glyph. Every class name is written out in full because the utility engine
 * finds class names by reading the source as text.
 */
const MARKS: readonly { tile: string; glyph: ReactNode }[] = [
  {
    // Robot pets: a square head, two antennae, two eyes.
    tile: 'bg-company-0',
    glyph: (
      <>
        <rect x="5" y="8" width="14" height="11" rx="3" />
        <path d="M9 8V4.5M15 8V4.5M10 16h4" />
        <circle cx="9.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    // Fizzy drinks: a cup, a straw, two bubbles.
    tile: 'bg-company-1',
    glyph: (
      <>
        <path d="M6.5 9h11l-1.3 11H7.8zM13 9l2.5-5.5" />
        <circle cx="8.5" cy="5" r="1.2" />
        <circle cx="11.5" cy="14" r="1" />
      </>
    ),
  },
  {
    // Jet sneakers: a shoe, its sole, two lines of speed behind it.
    tile: 'bg-company-2',
    glyph: (
      <>
        <path d="M6 16.5V10l3.5-.5 2.5 3.5 7 1.5c1.5.3 2.5 1 2.5 2z" />
        <path d="M6 19.5h15.5M1.5 11.5h2.5M2.5 15h1.5" />
      </>
    ),
  },
  {
    // Space snacks: a crescent moon and two crumbs.
    tile: 'bg-company-3',
    glyph: (
      <>
        <path d="M14 3.5a8.5 8.5 0 1 0 6.5 12.5A7 7 0 0 1 14 3.5z" />
        <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="20" cy="10" r="0.7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    // Video games: a small creature made of squares.
    tile: 'bg-company-4',
    glyph: (
      <g fill="currentColor" stroke="none">
        <rect x="7" y="4" width="2" height="2" />
        <rect x="15" y="4" width="2" height="2" />
        <rect x="6" y="6" width="12" height="2" />
        <rect x="4" y="8" width="4" height="3" />
        <rect x="10" y="8" width="4" height="3" />
        <rect x="16" y="8" width="4" height="3" />
        <rect x="4" y="11" width="16" height="4" />
        <rect x="6" y="15" width="3" height="2" />
        <rect x="15" y="15" width="3" height="2" />
        <rect x="4" y="17" width="3" height="2" />
        <rect x="17" y="17" width="3" height="2" />
      </g>
    ),
  },
  {
    // Super batteries: a battery, its cap, two bars of charge.
    tile: 'bg-company-5',
    glyph: (
      <>
        <rect x="3" y="7.5" width="16" height="9" rx="2" />
        <path d="M21.5 10.5v3" />
        <rect x="6" y="10" width="2.5" height="4" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="10" y="10" width="2.5" height="4" rx="0.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

const TILE_SIZES = {
  xs: { box: 'size-5 rounded-md', icon: 'size-3.5' },
  sm: { box: 'size-8 rounded-[10px]', icon: 'size-5' },
  md: { box: 'size-11 rounded-[14px]', icon: 'size-[26px]' },
  lg: { box: 'size-14 rounded-[18px]', icon: 'size-8' },
} as const;

export function CompanyTile({ companyId, size = 'md' }: { companyId: number; size?: keyof typeof TILE_SIZES }) {
  const mark = MARKS[companyId] ?? MARKS[0];
  const { box, icon } = TILE_SIZES[size];
  return (
    <span className={cx('flex shrink-0 items-center justify-center text-ink', box, mark?.tile)}>
      <svg viewBox="0 0 24 24" className={icon} strokeWidth="2" {...stroke} aria-hidden="true">
        {mark?.glyph}
      </svg>
    </span>
  );
}

/**
 * Bottom-of-panel actions. Sticks to the bottom of a scrolling panel so the
 * main button is always reachable on short screens.
 */
export const ActionDock = ({ children }: { children: ReactNode }) => (
  <div className="sticky bottom-0 -mb-6 mt-auto flex flex-col gap-2.5 bg-panel pt-3 pb-6">{children}</div>
);

export const Label = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx('text-[13px] text-muted', className)}>{children}</div>
);
