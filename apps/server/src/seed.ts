import { randomBytes } from 'node:crypto';
import { isValidSeed } from '@strike-desk/shared';

/**
 * A new game's master seed: uniform over the whole 48-bit seed range, from
 * the operating system's random source. Never from a clock, and never from
 * anything a browser sends.
 *
 * `crypto.randomInt` is not used on purpose: the size of its range is capped
 * at 2^48 - 1, so asking it for the full seed range throws. Six random bytes
 * read as one unsigned integer are exactly 48 bits, with no rejection step
 * and no modulo bias.
 */
export function drawSeed(): number {
  const seed = randomBytes(6).readUIntBE(0, 6);
  if (!isValidSeed(seed)) throw new Error('the drawn seed is outside the seed range');
  return seed;
}

/**
 * A session id: 128 random bits as 22 URL-safe characters. It is the only
 * credential a session has, so it is drawn separately from the seed and says
 * nothing about it.
 */
export function drawSessionId(): string {
  return randomBytes(16).toString('base64url');
}
