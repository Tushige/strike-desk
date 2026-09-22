import type { ConnectionOptions } from './ports';

/**
 * The two ready-made answers to one question: after a reconnect, does a
 * command nobody has answered go out again by itself? The connection picks
 * neither. Whoever assembles a page hands one in as `resendOnResume`.
 *
 * Either is safe for the player's money: a resend reuses the command id, and
 * the server answers a repeated id with the first receipt. What differs is
 * who presses. With `resendNever` only the player does, through `resend`.
 */

type ResendOnResume = ConnectionOptions['resendOnResume'];

/** Nothing resends by itself. An unanswered command stays `checking` until a frame settles it or the page calls `resend`. */
export const resendNever: ResendOnResume = () => false;

export interface FreshOptions {
  /** How old a press may be, in milliseconds on `now`'s clock, and still go out again. This block holds no such number. */
  maxAgeMs: number;
  /** The same clock the connection's seam reads: `sentAt` is a reading of it. */
  now: () => number;
}

/**
 * A command resends by itself only while the press is recent and, when the
 * command names a game day, while it is still that day. Anything older, or
 * from a day that has ended, waits for the player.
 */
export function resendWhileFresh({ maxAgeMs, now }: FreshOptions): ResendOnResume {
  return (pending, frame) => {
    const age = now() - pending.sentAt;
    if (age < 0 || age > maxAgeMs) return false;
    const { command } = pending;
    if ('day' in command && command.day !== frame.clock.day) return false;
    return true;
  };
}
