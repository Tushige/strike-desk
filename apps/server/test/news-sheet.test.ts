import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, SITUATIONS, SOURCES } from '@strike-desk/shared/engine';
import { buildReview, buildSheet, renderReview, renderSheet } from '../scripts/news-sheet';

/**
 * The news sheet is a committed file that the lab's news page shows: the
 * headline pool, and the headlines of three sample games. A committed file is
 * published for good, so two things are held here. It is what the script
 * writes today, so the page never shows words the game no longer uses. And it
 * holds only what a player may read from the start of a day: no key in it
 * names an outcome, the moment the news lands, a price, or the number a
 * market is made from.
 */

/** What to do about a failure here, said where a red run will show it. */
const REWRITE = 'The news sheet is older than the pool or the writer. Rewrite it: pnpm --filter @strike-desk/server exec tsx scripts/news-sheet.ts';

const SHEET = new URL('../../web/src/lab/modules/news-engine.sheet.json', import.meta.url);

/** Every key the sheet may hold, at any depth. Typed in: a new key is a decision, made here. */
const KNOWN_KEYS = [
  // the top, and the head
  'recordedWith',
  'content',
  'pool',
  'games',
  // the pool: phrases by trust level, and the situations as written
  'sources',
  '1',
  '2',
  '3',
  'situations',
  'direction',
  'title',
  'body',
  // a game and its headlines
  'label',
  'headlines',
  'day',
  'company',
  'trust',
  'source',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every key of every object anywhere in a value. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysIn(inner)]);
}

const committedText = readFileSync(SHEET, 'utf8');
const committed = JSON.parse(committedText) as unknown;

describe('candidate review command', () => {
  it('assembles compatible candidate words on stdout without changing the committed sheet', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'news-review-'));
    try {
      const candidate = path.join(directory, 'candidate.json');
      writeFileSync(candidate, JSON.stringify({
        sources: { 3: ['Official voice'], 2: ['Worker voice'], 1: ['Online voice'] },
        events: [
          { id: 'toy-order', direction: 'up', kinds: ['toys'], wordings: { toys: [{ title: '{name} order', body: 'More {product} ordered.' }] } },
          { id: 'drink-delay', direction: 'down', kinds: ['drinks'], wordings: { drinks: [{ title: '{name} delay', body: 'Fewer {product} delivered.' }] } },
        ],
      }));
      // Even from the server package, candidate paths are relative to the repository root.
      const relativeCandidate = path.relative(fileURLToPath(new URL('../../../', import.meta.url)), candidate);
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/news-sheet.ts', '--candidate', relativeCandidate, '--review', '--sample'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('RoboPup order');
      expect(result.stdout).toContain('More robot pets ordered.');
      expect(result.stdout).toContain('Fizzly delay');
      expect(result.stdout).not.toContain('Fizzly order');
      expect(result.stdout).toContain('Official voice');
      expect(result.stdout).toContain('UNAPPROVED');
      expect(result.stdout).toMatch(/SHA256: [a-f0-9]{64}/);
      expect(readFileSync(SHEET, 'utf8')).toBe(committedText);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed input with a field error and no sheet write', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'news-review-'));
    try {
      const candidate = path.join(directory, 'candidate.json');
      writeFileSync(candidate, JSON.stringify({ sources: {}, events: [] }));
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/news-sheet.ts', '--candidate', candidate, '--review', '--sample'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('sources.3');
      expect(result.stdout).toBe('');
      expect(readFileSync(SHEET, 'utf8')).toBe(committedText);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

const REVIEW_POOL = {
  sources: { 3: ['Official A', 'Official B'], 2: ['Worker'], 1: ['Online'] },
  events: [{ id: 'order', direction: 'up', kinds: ['toys'], wordings: { toys: [
    { title: '{name} order', body: 'First {product} batch.' },
    { title: '{name} order', body: 'Second {product} batch.' },
  ] } }],
};

describe('assembled review', () => {
  it('lists every source and variant pairing through the writer in stable order', () => {
    const review = buildReview(REVIEW_POOL, { mode: 'sample' });
    expect(review.groups.map((group) => group.company)).toEqual(['RoboPup', 'Fizzly', 'JetKicks', 'MoonMunch', 'PixelPals', 'ZapCharge']);
    expect(review.groups[0]?.rows.map(({ source, title, body }) => [source, title, body])).toEqual([
      ['Official A', 'RoboPup order', 'First robot pets batch.'],
      ['Official B', 'RoboPup order', 'First robot pets batch.'],
      ['Worker', 'RoboPup order', 'First robot pets batch.'],
      ['Online', 'RoboPup order', 'First robot pets batch.'],
      ['Official A', 'RoboPup order', 'Second robot pets batch.'],
      ['Official B', 'RoboPup order', 'Second robot pets batch.'],
      ['Worker', 'RoboPup order', 'Second robot pets batch.'],
      ['Online', 'RoboPup order', 'Second robot pets batch.'],
    ]);
    expect(review.groups.slice(1).flatMap((group) => group.rows)).toEqual([]);
    expect(renderReview(review)).toBe(renderReview(buildReview(REVIEW_POOL, { mode: 'sample' })));
    expect(Object.keys(review).sort()).toEqual(['digest', 'groups', 'mode', 'status']);
    expect(Object.keys(review.groups[0]?.rows[0] ?? {}).sort()).toEqual(['body', 'direction', 'event', 'source', 'title', 'trust', 'variant']);
  });

  it('digests semantic data in canonical field order while preserving array order', () => {
    const first = buildReview(REVIEW_POOL, { mode: 'sample' }).digest;
    expect(buildReview({ events: REVIEW_POOL.events, sources: REVIEW_POOL.sources }, { mode: 'sample' }).digest).toBe(first);
    const changed = structuredClone(REVIEW_POOL);
    changed.sources[3].reverse();
    expect(buildReview(changed, { mode: 'sample' }).digest).not.toBe(first);
  });

  it('rejects unknown fields, invalid kinds, empty variants, trust collisions and unresolved markers', () => {
    expect(() => buildReview({ ...REVIEW_POOL, hidden: true }, { mode: 'sample' })).toThrow('unknown field');
    const event = REVIEW_POOL.events[0];
    expect(() => buildReview({ ...REVIEW_POOL, events: [{ ...event, kinds: ['unknown'] }] }, { mode: 'sample' })).toThrow('unknown company kind');
    expect(() => buildReview({ ...REVIEW_POOL, events: [{ ...event, wordings: { toys: [] } }] }, { mode: 'sample' })).toThrow('nonempty list');
    expect(() => buildReview({ ...REVIEW_POOL, sources: { ...REVIEW_POOL.sources, 1: ['Worker'] } }, { mode: 'sample' })).toThrow('duplicate source');
    expect(() => buildReview({ ...REVIEW_POOL, events: [{ ...event, wordings: { toys: [{ title: '{name} title', body: '{missing}' }] } }] }, { mode: 'sample' })).toThrow('plain text');
  });
});

describe('the news sheet', () => {
  it('is what the script writes today, to the byte', () => {
    expect(committed, REWRITE).toEqual(buildSheet());
    expect(committedText, REWRITE).toBe(renderSheet(buildSheet()));
  });

  it('says which content it was written from, and nothing else about where it came from', () => {
    const sheet = buildSheet();

    expect(Object.keys(sheet).sort()).toEqual(['games', 'pool', 'recordedWith']);
    expect(Object.keys(sheet.recordedWith)).toEqual(['content']);
    expect(sheet.recordedWith.content).toBe(CONTENT_VERSION);
  });

  it('holds three games of fifteen headlines, five days of three, each with exactly its seven public fields', () => {
    const sheet = buildSheet();

    expect(sheet.games.map((game) => game.label)).toEqual(['Game A', 'Game B', 'Game C']);
    for (const game of sheet.games) {
      expect(Object.keys(game).sort()).toEqual(['headlines', 'label']);
      expect(game.headlines).toHaveLength(15);
      expect(game.headlines.map((headline) => headline.day)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5]);
      for (const headline of game.headlines) {
        expect(Object.keys(headline).sort()).toEqual(['body', 'company', 'day', 'direction', 'source', 'title', 'trust']);
      }
    }
  });

  it('lists the whole committed pool as written, the marked places not filled in', () => {
    const { pool } = buildSheet();

    expect(Object.keys(pool).sort()).toEqual(['situations', 'sources']);
    expect(Object.keys(pool.sources).sort()).toEqual(['1', '2', '3']);
    expect(pool.sources).toEqual(SOURCES);
    expect(pool.situations).toEqual(SITUATIONS);
    for (const situation of pool.situations) {
      expect(Object.keys(situation).sort()).toEqual(['body', 'direction', 'title']);
      expect(situation.title).toContain('{name}');
    }
  });

  it('holds no key but the ones named here, at any depth: nothing for an outcome, a reveal moment, a price or a market number', () => {
    const found = [...new Set(keysIn(committed))].sort();

    expect(found).toEqual([...KNOWN_KEYS].sort());
  });

  it('reads differently from game to game', () => {
    const [a, b, c] = buildSheet().games.map((game) => game.headlines.map((headline) => headline.title).join('|'));

    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});
