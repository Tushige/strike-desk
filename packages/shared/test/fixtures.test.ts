import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OPEN_STEPS } from '../src/clock';
import type { Market } from '../src/market';
import { CONTENT_VERSION, ENGINE_VERSION, buildMarket } from '../src/market';
import { sharePriceCents } from '../src/money';
import { seedToMarketCode } from '../src/rng';
import { TEST_SEED } from './helpers';
import { TEST_CAST } from './testCast';

/**
 * Pinned prices. One market, built on the stand-in cast, is compared bit for
 * bit with a data file: a price is stored as the 16 hex characters of its
 * 64-bit pattern, so nothing here is ever compared with a tolerance. The
 * sample points are there to be read in a diff; the digest covers every price
 * of the whole market, so a change anywhere is caught.
 */

const FIXTURE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'price-paths.json');
const REGENERATE = 'WRITE_FIXTURES=1 pnpm vitest run packages/shared/test/fixtures.test.ts';
const WRITING = process.env['WRITE_FIXTURES'] === '1';

const NOTE = [
  `Pinned prices of one market on the stand-in cast. Regenerate with: ${REGENERATE}`,
  'If the fixtures test fails and the price model was not meant to change, do not regenerate: find what changed.',
  'If the model was meant to change, bump the engine version in the same commit as the regenerated file.',
  "Adding the lead-in price series before day 1 will change every path, and this file will be regenerated once more then; that is expected.",
].join(' ');

const SAMPLED_DAYS = [1, 5];
const EDGE_POINTS = 8;

const pointSchema = z.strictObject({ index: z.number().int(), bits: z.string().regex(/^[0-9a-f]{16}$/), cents: z.number().int() });
const sampleSchema = z.strictObject({
  day: z.number().int(),
  companyId: z.number().int(),
  revealIndex: z.number().int().nullable(),
  points: z.array(pointSchema),
});
const fixtureSchema = z.strictObject({
  note: z.string(),
  marketCode: z.string(),
  seed: z.number().int(),
  engine: z.string(),
  content: z.string(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  samples: z.array(sampleSchema),
});
type Fixture = z.infer<typeof fixtureSchema>;

const view = new DataView(new ArrayBuffer(8));

/** The exact 64-bit pattern of a number, as 16 lower-case hex characters. */
function bitsOf(value: number): string {
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

/** SHA-256 over the bit pattern of every price: day by day, company by company, from the open to the bell. */
function digestOf(market: Market): string {
  const hash = createHash('sha256');
  for (const day of market.days) {
    for (const dayPath of day.paths) {
      for (const price of dayPath) hash.update(bitsOf(price));
    }
  }
  return hash.digest('hex');
}

/** The first eight and last eight points of a day, and the two points either side of the moment the news lands. */
function sampledIndexes(revealIndex: number | null): number[] {
  const indexes = new Set<number>();
  for (let i = 0; i < EDGE_POINTS; i += 1) {
    indexes.add(i);
    indexes.add(OPEN_STEPS - i);
  }
  if (revealIndex !== null) {
    for (const index of [revealIndex - 2, revealIndex - 1, revealIndex, revealIndex + 1]) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function snapshot(market: Market): Fixture {
  const samples: Fixture['samples'] = [];
  for (const dayNumber of SAMPLED_DAYS) {
    const day = market.days[dayNumber - 1];
    if (day === undefined) throw new Error(`no day ${dayNumber}`);
    day.paths.forEach((dayPath, companyId) => {
      const revealIndex = day.news.find((item) => item.headline.companyId === companyId)?.hidden.revealIndex ?? null;
      const points = sampledIndexes(revealIndex).map((index) => {
        const price = dayPath[index];
        if (price === undefined) throw new Error(`no price at index ${index}`);
        return { index, bits: bitsOf(price), cents: sharePriceCents(price) };
      });
      samples.push({ day: dayNumber, companyId, revealIndex, points });
    });
  }
  return {
    note: NOTE,
    marketCode: seedToMarketCode(market.identity.seed),
    seed: market.identity.seed,
    engine: market.identity.engine,
    content: market.identity.content,
    digest: digestOf(market),
    samples,
  };
}

/** Indented JSON with each sample point on one line, so a changed price is a one-line diff. */
function render(fixture: Fixture): string {
  const json = JSON.stringify(fixture, null, 2);
  return `${json.replace(/\{\s+"index": (\d+),\s+"bits": "([0-9a-f]{16})",\s+"cents": (\d+)\s+\}/g, '{ "index": $1, "bits": "$2", "cents": $3 }')}\n`;
}

function readFixture(): Fixture {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`no fixture file yet. Write it with: ${REGENERATE}`);
  return fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')));
}

const market = buildMarket({ seed: TEST_SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION }, { cast: TEST_CAST });
const current = snapshot(market);

// Asked to write: the data file is written, and nothing is compared. Otherwise nothing is ever written.
const suite = WRITING ? 'writing the price fixtures' : 'pinned prices';

describe(suite, () => {
  if (WRITING) {
    it('writes the data file instead of comparing', () => {
      mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true });
      writeFileSync(FIXTURE_FILE, render(current));
      expect(readFixture()).toEqual(current);
    });
    return;
  }

  it('were recorded under the current engine and content versions', () => {
    const recorded = readFixture();
    const advice = `the fixtures were recorded under another version. If the model or the content was meant to change, regenerate them in the same commit: ${REGENERATE}`;
    expect(recorded.engine, advice).toBe(ENGINE_VERSION);
    expect(recorded.content, advice).toBe(CONTENT_VERSION);
    expect(recorded.seed).toBe(TEST_SEED);
    expect(recorded.marketCode).toBe(seedToMarketCode(TEST_SEED));
  });

  it('match every sample point bit for bit', () => {
    const recorded = readFixture();
    const pattern = (fixture: Fixture): string[] =>
      fixture.samples.flatMap((sample) => sample.points.map((point) => `day ${sample.day} company ${sample.companyId} index ${point.index}: ${point.bits}`));
    expect(recorded.samples.length).toBe(SAMPLED_DAYS.length * TEST_CAST.length);
    expect(pattern(current), `a price changed. ${NOTE}`).toEqual(pattern(recorded));
    expect(current.samples.map((sample) => sample.revealIndex)).toEqual(recorded.samples.map((sample) => sample.revealIndex));
  });

  it('match every sample point in whole cents, from the one rounding function', () => {
    const recorded = readFixture();
    for (const sample of recorded.samples) {
      const dayPath = market.days[sample.day - 1]?.paths[sample.companyId];
      for (const point of sample.points) {
        const price = dayPath?.[point.index];
        if (price === undefined) throw new Error(`no price for day ${sample.day} company ${sample.companyId} index ${point.index}`);
        expect(Number.isInteger(point.cents)).toBe(true);
        expect(sharePriceCents(price)).toBe(point.cents);
      }
    }
  });

  it('match the digest of every price in the market', () => {
    expect(digestOf(market), `a price changed somewhere in the market. ${NOTE}`).toBe(readFixture().digest);
  });

  it('give another digest for another seed', () => {
    const other = buildMarket({ seed: TEST_SEED + 1, engine: ENGINE_VERSION, content: CONTENT_VERSION }, { cast: TEST_CAST });
    expect(digestOf(other)).not.toBe(readFixture().digest);
  });

  it('keep the note that says when to regenerate and when not to', () => {
    expect(readFixture().note).toBe(NOTE);
  });
});
