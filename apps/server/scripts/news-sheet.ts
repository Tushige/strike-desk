import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarket, CAST, CONTENT_VERSION, createHeadlineWriter, createStream, ENGINE_VERSION, EVENTS, SITUATIONS, SOURCES } from '@strike-desk/shared/engine';
import type { CompanyKind, EventType, HeadlineSlot, HeadlineText, NewsPool, Rng, WriteHeadlines } from '@strike-desk/shared/engine';

/**
 * Writes the news sheet: every string of the headline pool, and the fifteen
 * headlines of three sample games, for the lab's news page to show. The page
 * runs no game code; it reads this file.
 *
 * Run it from anywhere in the repository:
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/news-sheet.ts
 *
 * It writes apps/server/test/fixtures/news-engine.sheet.json. Run it again
 * after the pool or the writer changes: a test compares the committed file
 * with what `buildSheet` gives today, and fails when they differ.
 *
 * Only what a player may read from the start of a day goes in: the day, the
 * company, the trust level, what the headline claims, and its words. Whether
 * a claim holds, the moment its news lands, the number a market is made from
 * and every price stay out, and so do the time and the machine, so two runs
 * give the same bytes. The three sample markets are fixed ones that no live
 * game uses: live games draw theirs from the operating system's random
 * source.
 */

const SAMPLE_GAMES = [
  { label: 'Game A', market: 1101 },
  { label: 'Game B', market: 2203 },
  { label: 'Game C', market: 3303 },
] as const;

const OUTPUT = fileURLToPath(new URL('../test/fixtures/news-engine.sheet.json', import.meta.url));

export interface SheetHeadline {
  day: number;
  /** The company's name. */
  company: string;
  trust: 1 | 2 | 3;
  direction: 'up' | 'down';
  source: string;
  title: string;
  body: string;
}

export interface Sheet {
  recordedWith: { content: string };
  pool: {
    /** The source phrases, by trust level. */
    sources: { 3: string[]; 2: string[]; 1: string[] };
    /** Every situation, as written in the pool: the marked places are not filled in. */
    situations: { direction: 'up' | 'down'; title: string; body: string }[];
  };
  games: { label: string; headlines: SheetHeadline[] }[];
}

export function buildSheet(): Sheet {
  return {
    recordedWith: { content: CONTENT_VERSION },
    pool: {
      sources: { 3: [...SOURCES[3]], 2: [...SOURCES[2]], 1: [...SOURCES[1]] },
      situations: SITUATIONS.map(({ direction, title, body }) => ({ direction, title, body })),
    },
    games: SAMPLE_GAMES.map(({ label, market: number }) => {
      const market = buildMarket({ seed: number, engine: ENGINE_VERSION, content: CONTENT_VERSION });
      const headlines = market.days.flatMap((day) =>
        day.news.map(({ headline }): SheetHeadline => {
          const company = market.cast[headline.companyId];
          if (company === undefined) throw new Error(`headline ${headline.id} names a company that is not in the cast`);
          return {
            day: headline.day,
            company: company.name,
            trust: headline.trust,
            direction: headline.direction,
            source: headline.source,
            title: headline.title,
            body: headline.body,
          };
        }),
      );
      return { label, headlines };
    }),
  };
}

/** The sheet as the file holds it: indented, so a changed string is a one-line diff. */
export function renderSheet(sheet: Sheet): string {
  return `${JSON.stringify(sheet, null, 2)}\n`;
}

const KINDS: readonly CompanyKind[] = ['toys', 'drinks', 'wearables', 'food', 'games', 'energy'];
const TRUSTS = [3, 2, 1] as const;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field}: expected an object`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${field}.${key}: unknown field`);
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field}: expected a nonempty list`);
  return value as unknown[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new Error(`${field}: expected trimmed nonempty text`);
  return value;
}

function kind(value: unknown, field: string): CompanyKind {
  const found = KINDS.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`${field}: unknown company kind`);
  return found;
}

function parsePool(value: unknown): NewsPool {
  const input = object(value, 'pool');
  keys(input, ['sources', 'events'], 'pool');
  const rawSources = object(input.sources, 'sources');
  keys(rawSources, ['1', '2', '3'], 'sources');
  const phrases = (trust: 1 | 2 | 3) => list(rawSources[trust], `sources.${trust}`).map((phrase, i) => text(phrase, `sources.${trust}[${i}]`));
  const sources = { 3: phrases(3), 2: phrases(2), 1: phrases(1) };
  const events = list(input.events, 'events').map((value, i): EventType => {
    const field = `events[${i}]`;
    const event = object(value, field);
    keys(event, ['id', 'direction', 'kinds', 'wordings'], field);
    const id = text(event.id, `${field}.id`);
    if (event.direction !== 'up' && event.direction !== 'down') throw new Error(`${field}.direction: expected up or down`);
    const kinds = list(event.kinds, `${field}.kinds`).map((value) => kind(value, `${field}.kinds`));
    const rawWords = object(event.wordings, `${field}.wordings`);
    keys(rawWords, kinds, `${field}.wordings`);
    const wordings: Partial<Record<CompanyKind, readonly HeadlineText[]>> = {};
    for (const companyKind of kinds) {
      const prefix = `${field}.wordings.${companyKind}`;
      wordings[companyKind] = list(rawWords[companyKind], prefix).map((value, j) => {
        const words = object(value, `${prefix}[${j}]`);
        keys(words, ['title', 'body'], `${prefix}[${j}]`);
        return { title: text(words.title, `${prefix}[${j}].title`), body: text(words.body, `${prefix}[${j}].body`) };
      });
    }
    return { id, direction: event.direction, kinds, wordings };
  });
  return { sources, events };
}

export interface Review {
  status: 'UNAPPROVED';
  mode: 'sample' | 'full';
  digest: string;
  counts?: { events: number; situations: number; variants: number; sources: number; pairings: number };
  groups: {
    company: string;
    kind: CompanyKind;
    digest?: string;
    rows: (Pick<SheetHeadline, 'direction' | 'trust' | 'source' | 'title' | 'body'> & { event: string; variant: number })[];
  }[];
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fullBounds(pool: NewsPool): void {
  if (pool.events.length < 25 || pool.events.length > 30) throw new Error('full pool needs 25 to 30 events');
  const pairs = pool.events.reduce((count, event) => count + event.kinds.length, 0);
  if (pairs < 60 || pairs > 100) throw new Error('full pool needs 60 to 100 event/company situations');
  for (const trust of TRUSTS) {
    if (pool.sources[trust].length < 4 || pool.sources[trust].length > 5) throw new Error(`trust ${trust} needs 4 to 5 sources`);
  }
  for (const event of pool.events) for (const kind of event.kinds) {
    const count = event.wordings[kind]?.length ?? 0;
    if (count < 2 || count > 3) throw new Error(`${event.id}/${kind} needs 2 to 3 variants`);
  }
  for (const kind of KINDS) for (const direction of ['up', 'down']) {
    if (pool.events.filter((event) => event.direction === direction && event.kinds.includes(kind)).length < 5) {
      throw new Error(`${kind}/${direction} needs at least five events`);
    }
  }
}

/** Controlled draws still pass through the real writer, never a second renderer. */
function reviewDraws(source: number, wording: number): Rng {
  const draws = [source, wording];
  let index = 0;
  const nextFloat = () => {
    const value = draws[index++];
    if (value === undefined) throw new Error('review writer exceeded two draws');
    return value;
  };
  const unused = (): never => { throw new Error('unexpected review draw'); };
  return { nextFloat, nextInt: (n) => Math.floor(nextFloat() * n), nextU32: unused, nextNormal: unused, pick: unused };
}

function checkWords(value: string, limit: number, field: string): void {
  if (value.length > limit || !/^[A-Za-z0-9 .,'!?:;-]+$/.test(value)) throw new Error(`${field}: expected plain text of at most ${limit} characters`);
  if (/\b(true|false|confirmed|debunked|fake|hoax|turns out|proven)\b|seed/i.test(value)) throw new Error(`${field}: contains a giveaway word`);
}

/** A partial sample is reviewed one slot at a time, never used to build a market. */
export function buildReview(value: unknown, options: { mode: 'sample' | 'full' }): Review {
  const pool = parsePool(value);
  const write = createHeadlineWriter(pool);
  if (options.mode === 'full') fullBounds(pool);
  for (const trust of TRUSTS) for (const phrase of pool.sources[trust]) checkWords(phrase, 40, `sources.${trust}`);
  const groups = CAST.map((company) => {
    const titleOwners = new Map<string, string>();
    const rows = pool.events.filter((event) => event.kinds.includes(company.kind)).flatMap((event) => {
      const eligible = pool.events.filter((other) => other.direction === event.direction && other.kinds.includes(company.kind));
      const eventIndex = eligible.indexOf(event);
      const variants = event.wordings[company.kind];
      if (variants === undefined) throw new Error(`missing ${company.kind} wordings`);
      return variants.flatMap((variant, variantIndex) => {
        if (!variant.title.includes('{name}')) throw new Error(`${event.id}/${company.kind}: title must name its company`);
        return TRUSTS.flatMap((trust) => pool.sources[trust].map((_, sourceIndex) => {
          const [words] = write([{ id: 0, day: 1, companyId: company.id, direction: event.direction, trust }], CAST,
            reviewDraws((sourceIndex + 0.5) / pool.sources[trust].length, (eventIndex + (variantIndex + 0.5) / variants.length) / eligible.length));
          if (words === undefined) throw new Error('review writer returned no words');
          checkWords(words.title, 60, `${event.id}/${company.kind}.title`);
          checkWords(words.body, 140, `${event.id}/${company.kind}.body`);
          const owner = titleOwners.get(words.title);
          if (owner !== undefined && owner !== event.id) throw new Error(`${company.name}: title shared by events ${owner} and ${event.id}`);
          titleOwners.set(words.title, event.id);
          return { event: event.id, variant: variantIndex + 1, direction: event.direction, trust, ...words };
        }));
      });
    });
    const group = { company: company.name, kind: company.kind, rows };
    return options.mode === 'full' ? { ...group, digest: hash(group) } : group;
  });
  const review: Review = { status: 'UNAPPROVED', mode: options.mode, digest: hash(pool), groups };
  if (options.mode === 'full') review.counts = {
    events: pool.events.length,
    situations: pool.events.reduce((n, event) => n + event.kinds.length, 0),
    variants: pool.events.reduce((n, event) => n + event.kinds.reduce((sum, kind) => sum + (event.wordings[kind]?.length ?? 0), 0), 0),
    sources: TRUSTS.reduce((n, trust) => n + pool.sources[trust].length, 0),
    pairings: groups.reduce((n, group) => n + group.rows.length, 0),
  };
  return review;
}

export function renderReview(review: Review): string {
  const lines = [review.mode === 'full' ? '# News full review' : '# News sample review', '', `Status: ${review.status}`, `SHA256: ${review.digest}`, '',
    review.mode === 'full' ? 'Every company group is pending approval. Sample approval does not approve these groups.' : 'Sample voice review only. Full-pool approval remains pending.', ''];
  if (review.counts !== undefined) {
    const counts = review.counts;
    lines.push(`${counts.events} events; ${counts.situations} event/company situations; ${counts.variants} variants; ${counts.sources} sources; ${counts.pairings} assembled pairings.`, '',
      'Every row below is one complete source/variant pairing, rendered through the game writer. The group hash covers its company, kind and every ordered row. No lab copy changed.', '',
      '| Company | Up events | Down events | Variants | Pairings |', '| --- | ---: | ---: | ---: | ---: |');
    for (const group of review.groups) lines.push(`| ${group.company} | ${new Set(group.rows.filter((row) => row.direction === 'up').map((row) => row.event)).size} | ${new Set(group.rows.filter((row) => row.direction === 'down').map((row) => row.event)).size} | ${new Set(group.rows.map((row) => `${row.event}/${row.variant}`)).size} | ${group.rows.length} |`);
    lines.push('', '## Event compatibility', '', '| Event | Direction | Companies |', '| --- | --- | --- |');
    const events = new Map<string, { direction: string; companies: string[] }>();
    for (const group of review.groups) for (const row of group.rows) {
      const entry = events.get(row.event) ?? { direction: row.direction, companies: [] };
      if (!entry.companies.includes(group.company)) entry.companies.push(group.company);
      events.set(row.event, entry);
    }
    for (const [event, entry] of events) lines.push(`| ${event} | ${entry.direction} | ${entry.companies.join(', ')} |`);
    lines.push('');
  }
  for (const group of review.groups) {
    lines.push(`## ${group.company} (${group.kind})`, '');
    if (group.digest !== undefined) lines.push(`Group SHA256: ${group.digest}`, '', 'Approval: PENDING', '');
    for (const row of group.rows) {
      lines.push(`### ${row.event} / ${row.direction} / wording ${row.variant} / trust ${row.trust}`, '',
        row.source, '', `**${row.title}**`, '', row.body, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Public legal schedules only; this is not a market-input secrecy test. */
function legalSlots(seed: number): HeadlineSlot[] {
  const rng = createStream(seed, 'newsPick');
  const slots: HeadlineSlot[] = [];
  for (let day = 1; day <= 5; day += 1) {
    const remaining = CAST.map((company) => company.id);
    for (const trust of TRUSTS) {
      const [companyId] = remaining.splice(rng.nextInt(remaining.length), 1);
      assert.ok(companyId !== undefined);
      slots.push({ id: slots.length, day, companyId, trust, direction: rng.nextInt(2) === 0 ? 'up' : 'down' });
    }
  }
  return slots;
}

/** Recognises emitted words independently of the writer's selection state. */
export function checkCandidate(value: unknown, options: { games: number; write?: WriteHeadlines }): { games: number; headlines: number; digest: string } {
  const review = buildReview(value, { mode: 'full' });
  const pool = parsePool(value);
  const write = options.write ?? createHeadlineWriter(pool);
  if (!Number.isSafeInteger(options.games) || options.games < 1 || options.games > 10000) throw new Error('games must be an integer from 1 to 10000');
  const rendered = new Map(CAST.map((company) => [company.id, pool.events.filter((event) => event.kinds.includes(company.kind)).flatMap((event) =>
    (event.wordings[company.kind] ?? []).map((variant) => {
      const fill = (text: string) => text.replaceAll('{name}', company.name).replaceAll('{product}', company.product);
      return { event: event.id, direction: event.direction, title: fill(variant.title), body: fill(variant.body) };
    }))]));
  let headlines = 0;
  for (let seed = 0; seed < options.games; seed += 1) {
    const slots = legalSlots(seed);
    const words = write(slots, CAST, createStream(seed, 'newsWording'));
    const label = `game ${seed}`;
    assert.equal(slots.length, 15, label);
    assert.equal(words.length, 15, `${label}: fifteen headlines`);
    for (let day = 1; day <= 5; day += 1) {
      const today = slots.filter((slot) => slot.day === day);
      assert.equal(today.length, 3, label);
      assert.equal(new Set(today.map((slot) => slot.companyId)).size, 3, label);
      assert.deepEqual(today.map((slot) => slot.trust).sort(), [1, 2, 3], label);
    }
    const used = new Set<string>();
    for (const [index, word] of words.entries()) {
      const slot = slots[index];
      assert.ok(slot);
      assert.deepEqual(TRUSTS.filter((trust) => pool.sources[trust].includes(word.source)), [slot.trust], `${label}: source trust`);
      const matches = (rendered.get(slot.companyId) ?? []).filter((variant) => variant.title === word.title && variant.body === word.body);
      const ids = new Set(matches.map((match) => match.event));
      assert.equal(ids.size, 1, `${label}: exactly one compatible event`);
      assert.equal(matches[0]?.direction, slot.direction, `${label}: event direction`);
      const identity = `${slot.companyId}/${matches[0]?.event}`;
      assert.ok(!used.has(identity), `${label}: repeated situation`);
      used.add(identity);
    }
    assert.equal(used.size, 15, label);
    assert.equal(new Set(words.map((word) => word.title)).size, 15, `${label}: repeated title`);
    assert.deepEqual(write(slots, CAST, createStream(seed, 'newsWording')), words, `${label}: deterministic replay`);
    if (seed < 200) for (let day = 1; day < 5; day += 1) {
      const changed = slots.map((slot) => slot.day <= day ? slot : { ...slot, direction: slot.direction === 'up' ? 'down' as const : 'up' as const });
      assert.deepEqual(write(changed, CAST, createStream(seed, 'newsWording')).slice(0, day * 3), words.slice(0, day * 3), `${label}: later-day look-ahead`);
    }
    headlines += words.length;
  }
  return { games: options.games, headlines, digest: review.digest };
}

// Written only when this file is the one being run, never when a test imports it.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      writeFileSync(OUTPUT, renderSheet(buildSheet()));
      process.stdout.write(`wrote the news sheet: ${SAMPLE_GAMES.length} games\n`);
    } else {
      let candidatePath: string | undefined;
      let mode: 'sample' | 'full' | undefined;
      let action: 'review' | 'check' | undefined;
      let games: number | undefined;
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--candidate' && candidatePath === undefined) {
          candidatePath = args[++i];
          if (candidatePath === undefined || candidatePath.startsWith('--')) throw new Error('--candidate needs a path');
        }
        else if ((arg === '--sample' || arg === '--full') && mode === undefined) mode = arg === '--sample' ? 'sample' : 'full';
        else if ((arg === '--review' || arg === '--check-candidate') && action === undefined) action = arg === '--review' ? 'review' : 'check';
        else if (arg === '--games' && games === undefined) games = Number(args[++i]);
        else throw new Error(`unexpected argument: ${arg}`);
      }
      if (mode === undefined || action === undefined || candidatePath?.startsWith('--') ||
        (action === 'check' && (mode !== 'full' || games === undefined || candidatePath === undefined)) ||
        (action === 'review' && games !== undefined) || (mode === 'sample' && candidatePath === undefined)) {
        throw new Error('expected --candidate <path> --review --sample|--full, --review --full, or --candidate <path> --check-candidate --full --games 10000');
      }
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      const input: unknown = candidatePath === undefined ? { sources: SOURCES, events: EVENTS } : JSON.parse(readFileSync(path.resolve(root, candidatePath), 'utf8'));
      process.stdout.write(action === 'review' ? renderReview(buildReview(input, { mode })) : `${JSON.stringify(checkCandidate(input, { games: games ?? 0 }))}\n`);
    }
  } catch (error) {
    process.stderr.write(`news review: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
