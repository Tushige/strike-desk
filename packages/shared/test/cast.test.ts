import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Company } from '../src/cast';
import { CAST, DAY_WOBBLE, MARKET_WOBBLE } from '../src/cast';
import { CONTENT_VERSION } from '../src/market';

/**
 * The cast is content. Every price of every market is built on these numbers,
 * so a market number only means one market for as long as the cast behind it
 * is the same one. This file writes the cast out field by field and pins a
 * digest of it against the content version, so a cast edit that forgets the
 * version bump fails here rather than quietly renaming every market.
 */

/**
 * Every field of `Company`, named one at a time. A field added to the type
 * and not added here is a typecheck error, so the digest can never go stale
 * by covering less than the whole company.
 */
type CastProjection = Record<keyof Required<Company>, string | number | null>;

function project(company: Company): CastProjection {
  return {
    id: company.id,
    ticker: company.ticker,
    name: company.name,
    product: company.product,
    kind: company.kind,
    rivalId: company.rivalId,
    startPrice: company.startPrice,
    beta: company.beta,
    ownWobble: company.ownWobble,
    art: company.art ?? null,
  };
}

function digestOf(cast: readonly Company[]): string {
  return createHash('sha256').update(JSON.stringify(cast.map(project))).digest('hex');
}

/** The pinned pair. Both move together, in the one commit that changes the cast. */
const PINNED = {
  content: 'c1',
  digest: '2dd8bd6d467bc13fe506d72206de39d7bdac71beaf70beefcd0a619e079ec432',
} as const;

const RE_PIN = 'the cast changed: bump CONTENT_VERSION and re-pin both values in this file, in the same commit';

/** The six companies as the owner reviewed them. */
const REVIEWED: readonly Company[] = [
  { id: 0, ticker: 'RPUP', name: 'RoboPup', product: 'robot pets', kind: 'toys', rivalId: 4, startPrice: 84, beta: 1.0, ownWobble: 0.0316 },
  { id: 1, ticker: 'FIZZ', name: 'Fizzly', product: 'fizzy drinks', kind: 'drinks', rivalId: 3, startPrice: 60, beta: 0.6, ownWobble: 0.0338 },
  { id: 2, ticker: 'JETK', name: 'JetKicks', product: 'jet sneakers', kind: 'wearables', rivalId: 0, startPrice: 120, beta: 1.2, ownWobble: 0.03 },
  { id: 3, ticker: 'MUNC', name: 'MoonMunch', product: 'space snacks', kind: 'food', rivalId: 1, startPrice: 58, beta: 0.8, ownWobble: 0.0329 },
  { id: 4, ticker: 'PIXL', name: 'PixelPals', product: 'video games', kind: 'games', rivalId: 0, startPrice: 65, beta: 1.4, ownWobble: 0.028 },
  { id: 5, ticker: 'ZAPP', name: 'ZapCharge', product: 'super batteries', kind: 'energy', rivalId: 2, startPrice: 150, beta: 1.6, ownWobble: 0.0255 },
];

describe('the cast', () => {
  it('is the six companies the owner reviewed, field by field', () => {
    expect(CAST).toHaveLength(6);
    expect(CAST.map(project)).toEqual(REVIEWED.map(project));
  });

  it('gives each company its place in the cast as its id, and names a rival that is in the cast', () => {
    expect(CAST.map((company) => company.id)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const company of CAST) {
      expect(company.rivalId).toBeGreaterThanOrEqual(0);
      expect(company.rivalId).toBeLessThan(CAST.length);
      expect(company.rivalId).not.toBe(company.id);
    }
  });

  it('carries an art file for none of them', () => {
    for (const company of CAST) expect(company.art).toBeUndefined();
  });

  it('composes a 3.5% day out of the market part and the company\'s own part', () => {
    for (const company of CAST) {
      const marketPart = company.beta * MARKET_WOBBLE;
      const both = Math.sqrt(marketPart * marketPart + company.ownWobble * company.ownWobble);
      expect(Math.abs(both - DAY_WOBBLE), `${company.ticker} wobbles by ${both.toFixed(5)} a day, not ${String(DAY_WOBBLE)}`).toBeLessThan(0.002);
    }
  });
});

describe('the cast as content', () => {
  it('matches the digest pinned against the content version', () => {
    expect(CONTENT_VERSION, RE_PIN).toBe(PINNED.content);
    expect(digestOf(CAST), RE_PIN).toBe(PINNED.digest);
  });

  it('gives another digest when one number of one company changes', () => {
    const lifted = CAST.map((company) => (company.id === 3 ? { ...company, startPrice: company.startPrice + 1 } : company));
    expect(digestOf(lifted)).not.toBe(PINNED.digest);
  });

  it('gives another digest when a company gains an art file', () => {
    const drawn = CAST.map((company) => (company.id === 0 ? { ...company, art: 'robopup.png' } : company));
    expect(digestOf(drawn)).not.toBe(PINNED.digest);
  });
});
