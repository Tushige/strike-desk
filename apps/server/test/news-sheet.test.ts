import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSheet, renderSheet } from '../scripts/news-sheet';

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

describe('the news sheet', () => {
  it('is what the script writes today, to the byte', () => {
    expect(committed, REWRITE).toEqual(buildSheet());
    expect(committedText, REWRITE).toBe(renderSheet(buildSheet()));
  });

  it('says which content it was written from, and nothing else about where it came from', () => {
    const sheet = buildSheet();

    expect(Object.keys(sheet).sort()).toEqual(['games', 'pool', 'recordedWith']);
    expect(Object.keys(sheet.recordedWith)).toEqual(['content']);
    expect(sheet.recordedWith.content).toBe('c2');
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

  it('lists the whole pool as written: 9 source phrases and 12 situations, the marked places not filled in', () => {
    const { pool } = buildSheet();

    expect(Object.keys(pool).sort()).toEqual(['situations', 'sources']);
    expect(Object.keys(pool.sources).sort()).toEqual(['1', '2', '3']);
    expect([pool.sources[3].length, pool.sources[2].length, pool.sources[1].length]).toEqual([3, 3, 3]);
    expect(pool.situations).toHaveLength(12);
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
