import { describe, expect, it } from 'vitest';
import type { StreamName } from '../src/rng';
import { SEED_LIMIT, createStream, isValidSeed, marketCodeToSeed, seedToMarketCode } from '../src/rng';

const SEED = 123456789012345;

const GOLDEN_PRICES = [2685544077, 2220808477, 1869865814, 2065306839, 1924040720, 3688996603, 4023103199, 4147566914];
const GOLDEN_ZERO = [3810937949, 929998130, 1170603735, 1452450788, 1226400599, 2641250734, 1118696640, 1492528296];

function firstValues(seed: number, name: StreamName, ...indexes: number[]): number[] {
  const rng = createStream(seed, name, ...indexes);
  return Array.from({ length: 8 }, () => rng.nextU32());
}

describe('createStream', () => {
  it('gives the same sequence for the same seed and label', () => {
    expect(firstValues(SEED, 'prices', 2, 4)).toEqual(firstValues(SEED, 'prices', 2, 4));
  });

  it('gives different sequences for different labels, indexes and seeds', () => {
    const base = firstValues(SEED, 'prices', 2, 4);
    expect(firstValues(SEED, 'newsPick', 2, 4)).not.toEqual(base);
    expect(firstValues(SEED, 'prices', 2, 5)).not.toEqual(base);
    expect(firstValues(SEED, 'prices', 3, 4)).not.toEqual(base);
    expect(firstValues(SEED + 1, 'prices', 2, 4)).not.toEqual(base);
    // The high 16 seed bits matter too.
    expect(firstValues(SEED + 4294967296, 'prices', 2, 4)).not.toEqual(base);
  });

  it('is pinned: these values may only change together with the engine version', () => {
    expect(firstValues(SEED, 'prices', 1, 0)).toEqual(GOLDEN_PRICES);
    expect(firstValues(0, 'cosmetics')).toEqual(GOLDEN_ZERO);
  });

  it('draws floats in [0, 1), integers in [0, n) and finite normals', () => {
    const rng = createStream(SEED, 'cosmetics');
    let sum = 0;
    let sumSquares = 0;
    const draws = 20_000;
    for (let i = 0; i < draws; i += 1) {
      const float = rng.nextFloat();
      expect(float).toBeGreaterThanOrEqual(0);
      expect(float).toBeLessThan(1);
      const int = rng.nextInt(6);
      expect(Number.isInteger(int) && int >= 0 && int < 6).toBe(true);
      const normal = rng.nextNormal();
      expect(Number.isFinite(normal)).toBe(true);
      sum += normal;
      sumSquares += normal * normal;
    }
    expect(Math.abs(sum / draws)).toBeLessThan(0.03);
    expect(Math.abs(sumSquares / draws - 1)).toBeLessThan(0.05);
  });

  it('picks from a list and refuses an empty one', () => {
    const rng = createStream(SEED, 'newsWording');
    expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(2.5)).toThrow();
  });

  it('refuses an invalid seed', () => {
    for (const bad of [-1, 1.5, SEED_LIMIT, NaN, Infinity]) {
      expect(isValidSeed(bad)).toBe(false);
      expect(() => createStream(bad, 'prices')).toThrow();
      expect(() => seedToMarketCode(bad)).toThrow();
    }
    expect(isValidSeed(0)).toBe(true);
    expect(isValidSeed(SEED_LIMIT - 1)).toBe(true);
  });
});

describe('market code', () => {
  it('round-trips the smallest, the largest and random seeds', () => {
    const rng = createStream(SEED, 'cosmetics', 99);
    const seeds = [0, 1, SEED_LIMIT - 1, SEED];
    for (let i = 0; i < 200; i += 1) seeds.push(rng.nextU32() * 65536 + rng.nextInt(65536));
    for (const seed of seeds) {
      expect(marketCodeToSeed(seedToMarketCode(seed))).toBe(seed);
    }
  });

  it('is ten characters in three groups with no look-alikes', () => {
    const rng = createStream(SEED, 'cosmetics', 7);
    for (let i = 0; i < 200; i += 1) {
      const code = seedToMarketCode(rng.nextU32() * 65536 + rng.nextInt(65536));
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
    expect(seedToMarketCode(0)).toBe('222-222-2222');
  });

  it('reads codes typed in lower case or without dashes, and refuses anything else', () => {
    const code = seedToMarketCode(SEED);
    expect(marketCodeToSeed(code.toLowerCase())).toBe(SEED);
    expect(marketCodeToSeed(code.replace(/-/g, ''))).toBe(SEED);
    expect(marketCodeToSeed('')).toBeNull();
    expect(marketCodeToSeed('222-222-222')).toBeNull();
    expect(marketCodeToSeed('222-222-2220')).toBeNull();
    expect(marketCodeToSeed('222-222-222O')).toBeNull();
    // Ten valid characters, but more than 48 bits.
    expect(marketCodeToSeed('ZZZ-ZZZ-ZZZZ')).toBeNull();
  });
});
