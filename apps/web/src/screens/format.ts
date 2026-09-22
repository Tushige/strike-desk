import { STEP_MS } from '@strike-desk/shared/time';

/**
 * How money and time are written on screen. Every amount arrives in whole
 * cents from the server; nothing here works a value out, it only spells one.
 */

const MINUS = '−';

/** Whole dollars, grouped: $1,000,000. A negative amount gets a proper minus sign. */
export function money(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? MINUS : ''}$${dollars.toLocaleString('en-US')}`;
}

/** Whole dollars with a sign either way: +$12,000 or −$3,000. */
export function signedMoney(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? MINUS : '+'}$${dollars.toLocaleString('en-US')}`;
}

/** A share price, to the cent: $84.00. */
export function price(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** How far `now` is from `from`, as a signed percentage: +3.2% or −1.0%. */
export function percentChange(from: number, now: number): string {
  if (from === 0) return '+0.0%';
  const change = now / from - 1;
  return `${change < 0 ? MINUS : '+'}${Math.abs(change * 100).toFixed(1)}%`;
}

export function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** m:ss, never negative. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Real seconds until a number of game steps have passed. A step is 200 ms of
 * game time, and a faster pace covers more steps per real second.
 */
export function secondsFor(steps: number, pace: number | null): number {
  return (steps * STEP_MS) / 1000 / (pace ?? 1);
}
