import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAST, CONTENT_VERSION, createHeadlineWriter, createStream, SITUATIONS, SOURCES } from '@strike-desk/shared/engine';
import type { CompanyKind, HeadlineText, NewsPool, WriteHeadlines } from '@strike-desk/shared/engine';
import { buildReview, buildSheet, checkCandidate, renderReview, renderSheet } from '../scripts/news-sheet';

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

const SHEET = new URL('./fixtures/news-engine.sheet.json', import.meta.url);

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

function fullPool() {
  const kinds: CompanyKind[] = ['toys', 'drinks', 'wearables', 'food', 'games', 'energy'];
  return {
    sources: { 3: ['Official A', 'Official B', 'Official C', 'Official D'], 2: ['Worker A', 'Worker B', 'Worker C', 'Worker D'], 1: ['Online A', 'Online B', 'Online C', 'Online D'] },
    events: Array.from({ length: 26 }, (_, index) => {
      const compatible = [0, 1, 2].map((offset) => kinds[(index + offset) % 6]).filter((kind): kind is CompanyKind => kind !== undefined);
      const wordings: Partial<Record<CompanyKind, HeadlineText[]>> = {};
      for (const kind of compatible) wordings[kind] = [
        { title: `{name} event ${index} A`, body: `First ${kind} batch ${index}.` },
        { title: `{name} event ${index} B`, body: `Second ${kind} batch ${index}.` },
      ];
      return { id: `event-${index}`, direction: index < 13 ? 'up' as const : 'down' as const, kinds: compatible, wordings };
    }),
  };
}

describe('complete candidate', () => {
  it('reports distinct situations separately from all variants and source pairings', () => {
    const pool = fullPool();
    const review = buildReview(pool, { mode: 'full' });
    // 26 events x three kinds x two variants x twelve source phrases.
    expect(review.counts).toEqual({ events: 26, situations: 78, variants: 156, sources: 12, pairings: 1872 });
    expect(review.groups).toHaveLength(6);
    const expected = CAST.map((company) => pool.events.filter((event) => event.kinds.includes(company.kind)).flatMap((event) =>
      (event.wordings[company.kind] ?? []).flatMap((variant, i) => ([3, 2, 1] as const).flatMap((trust) => pool.sources[trust].map((source) => ({
        event: event.id, direction: event.direction, variant: i + 1, trust, source,
        title: variant.title.replaceAll('{name}', company.name), body: variant.body,
      }))))));
    expect(review.groups.map((group) => group.rows)).toEqual(expected);
    expect(new Set(review.groups.map((group) => group.digest)).size).toBe(6);
    expect(renderReview(review)).toBe(renderReview(buildReview(pool, { mode: 'full' })));
    expect(renderReview(review)).toContain('78 event/company situations');
    expect(renderReview(review).match(/Approval: PENDING/g)).toHaveLength(6);
  });

  it('invalidates each affected group when exact words or shared sources change', () => {
    const pool = fullPool();
    const original = buildReview(pool, { mode: 'full' });
    const changed = structuredClone(pool);
    const words = changed.events[0]?.wordings.toys?.[0];
    if (words === undefined) throw new Error('missing fixture');
    changed.events[0]!.wordings.toys![0] = { ...words, body: 'A different toy batch.' };
    const revised = buildReview(changed, { mode: 'full' });
    expect(revised.digest).not.toBe(original.digest);
    expect(revised.groups.map((group, i) => group.digest === original.groups[i]?.digest)).toEqual([false, true, true, true, true, true]);
    changed.sources[3][0] = 'Official update';
    const sourcesChanged = buildReview(changed, { mode: 'full' });
    expect(sourcesChanged.groups.every((group, i) => group.digest !== revised.groups[i]?.digest)).toBe(true);
  });

  it.each([
    ['too few events', (pool: ReturnType<typeof fullPool>) => { pool.events = pool.events.slice(0, 24); }, '25 to 30'],
    ['too many events', (pool: ReturnType<typeof fullPool>) => { pool.events = [...pool.events, ...pool.events.slice(0, 5).map((event) => ({ ...event, id: `${event.id}-extra` }))]; }, '25 to 30'],
    ['too few situations', (pool: ReturnType<typeof fullPool>) => { for (const event of pool.events) { event.kinds = event.kinds.slice(0, 2); event.wordings = Object.fromEntries(event.kinds.map((kind) => [kind, event.wordings[kind]])); } }, '60 to 100'],
    ['too many situations', (pool: ReturnType<typeof fullPool>) => { for (const event of pool.events) { event.kinds = CAST.map((company) => company.kind); event.wordings = Object.fromEntries(event.kinds.map((kind) => [kind, [{ title: `{name} ${event.id}`, body: 'Batch A.' }, { title: `{name} ${event.id}`, body: 'Batch B.' }]])); } }, '60 to 100'],
    ['few sources', (pool: ReturnType<typeof fullPool>) => { pool.sources[1].pop(); }, '4 to 5'],
    ['many sources', (pool: ReturnType<typeof fullPool>) => { pool.sources[1].push('Online E', 'Online F'); }, '4 to 5'],
    ['few variants', (pool: ReturnType<typeof fullPool>) => { pool.events[0]?.wordings.toys?.pop(); }, '2 to 3'],
    ['many variants', (pool: ReturnType<typeof fullPool>) => { pool.events[0]?.wordings.toys?.push({ title: '{name} C', body: 'C.' }, { title: '{name} D', body: 'D.' }); }, '2 to 3'],
    ['deficient capacity', (pool: ReturnType<typeof fullPool>) => { for (const event of pool.events.slice(0, 6)) { event.kinds = event.kinds.filter((kind) => kind !== 'toys'); delete event.wordings.toys; } }, 'five events'],
    ['duplicate ID', (pool: ReturnType<typeof fullPool>) => { pool.events[1]!.id = 'event-0'; }, 'duplicate event'],
    ['missing kind copy', (pool: ReturnType<typeof fullPool>) => { delete pool.events[0]!.wordings.toys; }, 'nonempty list'],
    ['cross-trust source', (pool: ReturnType<typeof fullPool>) => { pool.sources[1][0] = 'Official A'; }, 'duplicate source'],
  ] as const)('rejects %s', (_, change, error) => {
    const pool = fullPool();
    change(pool);
    expect(() => buildReview(pool, { mode: 'full' })).toThrow(error);
  });

  it('rejects ambiguous cross-event rendered titles', () => {
    const pool = fullPool();
    pool.events[6]!.wordings.toys = [{ title: '{name} event 0 A', body: 'Different.' }, { title: '{name} other', body: 'Other.' }];
    expect(() => buildReview(pool, { mode: 'full' })).toThrow('title shared by events');
  });

  it('checks 10000 legal games and 150000 compatible headlines without a market', () => {
    const proof = checkCandidate(fullPool(), { games: 10000 });
    expect(proof.games).toBe(10000);
    expect(proof.headlines).toBe(150000);
    expect(proof.digest).toBe(buildReview(fullPool(), { mode: 'full' }).digest);
  });

  it.each(['repeat variant', 'wrong kind', 'wrong direction', 'wrong source', 'look ahead', 'late exhaustion', 'empty last word'])(
    'rejects a writer with %s', (mutation) => {
      const pool: NewsPool = fullPool();
      const real = createHeadlineWriter(pool);
      const mutant: WriteHeadlines = (slots, cast, rng) => {
        if (mutation === 'look ahead') return real(slots, cast, createStream(slots.filter((slot) => slot.direction === 'up').length, 'newsWording'));
        if (mutation === 'late exhaustion') {
          real(slots.slice(0, 14), cast, rng);
          throw new Error('no unused event at slot 14');
        }
        const words = real(slots, cast, rng);
        if (mutation === 'empty last word') words[14]!.body = '';
        if (mutation === 'wrong source') words[0]!.source = pool.sources[1][0]!;
        if (mutation === 'repeat variant') {
          for (const [index, slot] of slots.entries()) {
            const previousIndex = slots.findIndex((other, i) => i < index && other.companyId === slot.companyId && other.direction === slot.direction);
            if (previousIndex < 0) continue;
            const company = cast.find((company) => company.id === slot.companyId)!;
            const previous = words[previousIndex]!;
            const event = pool.events.find((event) => event.wordings[company.kind]?.some((variant) => variant.title.replaceAll('{name}', company.name) === previous.title))!;
            const variant = event.wordings[company.kind]!.find((variant) => variant.title.replaceAll('{name}', company.name) !== previous.title)!;
            words[index] = { source: words[index]!.source, title: variant.title.replaceAll('{name}', company.name), body: variant.body };
            break;
          }
        }
        if (mutation === 'wrong kind' || mutation === 'wrong direction') {
          const slot = slots[0]!;
          const company = cast.find((company) => company.id === slot.companyId)!;
          const event = pool.events.find((event) => mutation === 'wrong kind' ? !event.kinds.includes(company.kind) : event.direction !== slot.direction && event.kinds.includes(company.kind))!;
          const variant = event.wordings[mutation === 'wrong kind' ? event.kinds[0]! : company.kind]![0]!;
          words[0] = { ...words[0]!, title: variant.title.replaceAll('{name}', company.name), body: variant.body };
        }
        return words;
      };
      const error = { 'repeat variant': 'repeated situation', 'wrong kind': 'compatible event', 'wrong direction': 'event direction', 'wrong source': 'source trust', 'look ahead': 'later-day look-ahead', 'late exhaustion': 'slot 14', 'empty last word': 'compatible event' }[mutation];
      expect(() => checkCandidate(pool, { games: 10, write: mutant })).toThrow(error);
    },
  );

  it('runs full proof and review from the CLI with no sheet mutation', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'news-full-'));
    try {
      const candidate = path.join(directory, 'candidate.json');
      const pool = fullPool();
      writeFileSync(candidate, JSON.stringify(pool));
      const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/news-sheet.ts', '--candidate', candidate, ...args], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
      const proof = run('--check-candidate', '--full', '--games', '10000');
      expect(proof.status, proof.stderr).toBe(0);
      expect(JSON.parse(proof.stdout)).toEqual({ games: 10000, headlines: 150000, digest: buildReview(pool, { mode: 'full' }).digest });
      const review = run('--review', '--full');
      expect(review.status, review.stderr).toBe(0);
      expect(review.stdout).toBe(renderReview(buildReview(pool, { mode: 'full' })));
      expect(run('--check-candidate', '--full', '--games', '0').status).toBe(1);
      expect(readFileSync(SHEET, 'utf8')).toBe(committedText);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('assembled review', () => {
  it('rejects a partial pool in full review mode', () => {
    expect(() => buildReview(REVIEW_POOL, { mode: 'full' })).toThrow('25 to 30 events');
  });
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
