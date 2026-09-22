import { exactLn } from './exact';

/**
 * Seeded random streams. One 48-bit master seed per market; every concern
 * draws from its own labelled stream, so adding a draw to one concern can
 * never shift another. Labels may carry indexes ("prices/2/4") to give each
 * day and company its own stream.
 */

/**
 * Upper bound of a master seed, exclusive: 2^48, exact in a JS number. A
 * valid seed is a whole number from 0 up to, and not including, this value.
 *
 * Do not pass this to `crypto.randomInt` to draw a seed. That function caps
 * the size of its range at 2^48 - 1, one below this bound, and throws when
 * asked for more. The server draws six random bytes instead and reads them
 * as one unsigned integer: exactly 48 bits, the whole seed range.
 */
export const SEED_LIMIT = 281474976710656;

export type StreamName = 'prices' | 'marketWide' | 'newsPick' | 'newsWording' | 'newsOutcome' | 'cosmetics' | 'leadInMarketWide' | 'leadInPrices';

export interface Rng {
  /** Uniform integer in [0, 2^32). */
  nextU32(): number;
  /** Uniform in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [0, n). */
  nextInt(n: number): number;
  /** Standard normal draw. */
  nextNormal(): number;
  pick<T>(items: readonly T[]): T;
}

const TWO_32 = 4294967296;

function hashLabel(label: string): number {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function isValidSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed < SEED_LIMIT;
}

/** sfc32 seeded from all 48 seed bits plus the label. */
export function createStream(seed: number, name: StreamName, ...indexes: number[]): Rng {
  if (!isValidSeed(seed)) throw new Error('seed must be an integer in [0, 2^48)');
  const label = [name, ...indexes].join('/');
  let a = seed % TWO_32 >>> 0;
  let b = Math.floor(seed / TWO_32) >>> 0;
  let c = hashLabel(label);
  let d = 1;

  function nextU32(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  for (let i = 0; i < 20; i += 1) nextU32();

  function nextFloat(): number {
    return nextU32() / TWO_32;
  }

  function nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error('nextInt needs a positive integer');
    return Math.floor(nextFloat() * n);
  }

  function nextNormal(): number {
    // Marsaglia polar method: needs only ln and sqrt, both exact here.
    for (;;) {
      const u = 2 * nextFloat() - 1;
      const v = 2 * nextFloat() - 1;
      const s = u * u + v * v;
      if (s > 0 && s < 1) return u * Math.sqrt((-2 * exactLn(s)) / s);
    }
  }

  function pick<T>(items: readonly T[]): T {
    const item = items[nextInt(items.length)];
    if (item === undefined) throw new Error('pick needs a non-empty list');
    return item;
  }

  return { nextU32, nextFloat, nextInt, nextNormal, pick };
}

/**
 * The market number as a player sees it after the game: ten characters in
 * three groups, from an alphabet with no look-alikes (no 0/O, no 1/I).
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 10;

export function seedToMarketCode(seed: number): string {
  if (!isValidSeed(seed)) throw new Error('seed must be an integer in [0, 2^48)');
  let rest = seed;
  let chars = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    chars = CODE_ALPHABET.charAt(rest % 32) + chars;
    rest = Math.floor(rest / 32);
  }
  return `${chars.slice(0, 3)}-${chars.slice(3, 6)}-${chars.slice(6)}`;
}

export function marketCodeToSeed(code: string): number | null {
  const chars = code.toUpperCase().replace(/-/g, '');
  if (chars.length !== CODE_LENGTH) return null;
  let seed = 0;
  for (const char of chars) {
    const digit = CODE_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    seed = seed * 32 + digit;
  }
  return isValidSeed(seed) ? seed : null;
}
