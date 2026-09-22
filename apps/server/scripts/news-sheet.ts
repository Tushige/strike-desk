import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarket, CAST, CONTENT_VERSION, createHeadlineWriter, ENGINE_VERSION, SITUATIONS, SOURCES } from '@strike-desk/shared/engine';
import type { CompanyKind, EventType, HeadlineText, NewsPool, Rng } from '@strike-desk/shared/engine';

/**
 * Writes the news sheet: every string of the headline pool, and the fifteen
 * headlines of three sample games, for the lab's news page to show. The page
 * runs no game code; it reads this file.
 *
 * Run it from anywhere in the repository:
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/news-sheet.ts
 *
 * It writes apps/web/src/lab/modules/news-engine.sheet.json. Run it again
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

const OUTPUT = fileURLToPath(new URL('../../web/src/lab/modules/news-engine.sheet.json', import.meta.url));

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
  mode: 'sample';
  digest: string;
  groups: {
    company: string;
    kind: CompanyKind;
    rows: (Pick<SheetHeadline, 'direction' | 'trust' | 'source' | 'title' | 'body'> & { event: string; variant: number })[];
  }[];
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
export function buildReview(value: unknown, options: { mode: 'sample' }): Review {
  const pool = parsePool(value);
  const write = createHeadlineWriter(pool);
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
    return { company: company.name, kind: company.kind, rows };
  });
  return { status: 'UNAPPROVED', mode: options.mode, digest: createHash('sha256').update(JSON.stringify(pool)).digest('hex'), groups };
}

export function renderReview(review: Review): string {
  const lines = ['# News sample review', '', `Status: ${review.status}`, `SHA256: ${review.digest}`, '',
    'Sample voice review only. Full-pool approval remains pending.', ''];
  for (const group of review.groups) {
    lines.push(`## ${group.company} (${group.kind})`, '');
    for (const row of group.rows) {
      lines.push(`### ${row.event} / ${row.direction} / wording ${row.variant} / trust ${row.trust}`, '',
        row.source, '', `**${row.title}**`, '', row.body, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

// Written only when this file is the one being run, never when a test imports it.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      writeFileSync(OUTPUT, renderSheet(buildSheet()));
      process.stdout.write(`wrote the news sheet: ${SAMPLE_GAMES.length} games\n`);
    } else {
      const candidateIndex = args.indexOf('--candidate');
      const candidatePath = args[candidateIndex + 1];
      if (args.length !== 4 || candidateIndex < 0 || candidatePath === undefined || candidatePath.startsWith('--') ||
        !args.includes('--review') || !args.includes('--sample')) throw new Error('expected --candidate <path> --review --sample');
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      const input: unknown = JSON.parse(readFileSync(path.resolve(root, candidatePath), 'utf8'));
      process.stdout.write(renderReview(buildReview(input, { mode: 'sample' })));
    }
  } catch (error) {
    process.stderr.write(`news review: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
