import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ContentRevision {
  market: string;
  pool: string;
  castTest: string;
  poolTest: string;
  prices: string;
  recording: string;
  sheet: string;
  transcript: string;
}

/** Return forbidden differences without writing or regenerating any artifact. */
export function compareContentRevision(
  base: ContentRevision,
  current: ContentRevision,
  requireChange = false,
): string[] {
  try {
    const before = inspect(base, 'base');
    const after = inspect(current, 'current');
    const result = [
      ...differences(before.market, after.market, 'market'),
      ...differences(before.cast, after.cast, 'castTest'),
      ...differences(before.prices, after.prices, 'prices'),
      ...differences(before.recording, after.recording, 'recording'),
      ...differences(base.transcript, current.transcript, 'transcript'),
    ];
    if (before.content === after.content && (requireChange || base.pool !== current.pool ||
      base.recording !== current.recording || base.sheet !== current.sheet)) {
      result.push('CONTENT_VERSION: changed content requires a new label');
    }
    return result;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

const CONTENT = /^(export const CONTENT_VERSION = )(['"])([^'"\r\n]+)\2(;)/gm;
const ENGINE = /^export const ENGINE_VERSION = ['"]([^'"\r\n]+)['"];/gm;
const PIN = /(\bconst PINNED = \{\s*content: )(['"])([^'"\r\n]+)\2/;
const LABELS = ['lobby', 'day1-before-bell', 'day1-draft', 'day1-bought', 'day1-open',
  'day1-after-reveal', 'day1-cashed-out', 'day1-debrief', 'day2-before-bell',
  'day2-rejected', 'day2-bought', 'day2-held-to-bell', 'final'];

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${path}: expected an object`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value as unknown[];
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: expected nonempty text`);
  return value;
}

function equalLabel(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) throw new Error(`${path}: expected ${String(expected)}, found ${String(value)}`);
}

function parse(source: string, path: string): Record<string, unknown> {
  try { return object(JSON.parse(source) as unknown, path); }
  catch (error) { throw new Error(`${path}: malformed fixture (${error instanceof Error ? error.message : String(error)})`); }
}

function inspect(revision: ContentRevision, side: string) {
  const contents = [...revision.market.matchAll(CONTENT)];
  const engines = [...revision.market.matchAll(ENGINE)];
  if (contents.length !== 1 || engines.length !== 1) throw new Error(`${side}.market: expected one engine and content declaration`);
  const content = text(contents[0]?.[3], `${side}.market.CONTENT_VERSION`);
  const engine = text(engines[0]?.[1], `${side}.market.ENGINE_VERSION`);
  for (const key of ['castTest', 'poolTest'] as const) {
    equalLabel(revision[key].match(PIN)?.[3], content, `${side}.${key}.PINNED.content`);
  }
  text(revision.pool, `${side}.pool`);
  const prices = parse(revision.prices, `${side}.prices`);
  equalLabel(prices['content'], content, `${side}.prices.content`);
  equalLabel(prices['engine'], engine, `${side}.prices.engine`);
  for (const key of ['note', 'marketCode', 'digest']) text(prices[key], `${side}.prices.${key}`);
  if (!Number.isSafeInteger(prices['seed']) || !/^[a-f0-9]{64}$/.test(String(prices['digest']))) {
    throw new Error(`${side}.prices: malformed seed/digest`);
  }
  const samples = array(prices['samples'], `${side}.prices.samples`);
  if (samples.length === 0) throw new Error(`${side}.prices.samples: empty`);
  for (const [index, value] of samples.entries()) {
    const path = `${side}.prices.samples[${index}]`;
    const sample = object(value, path);
    for (const key of ['day', 'companyId']) if (!Number.isSafeInteger(sample[key])) throw new Error(`${path}.${key}: expected integer`);
    if (sample['revealIndex'] !== null && !Number.isSafeInteger(sample['revealIndex'])) throw new Error(`${path}.revealIndex: expected integer or null`);
    const points = array(sample['points'], `${path}.points`);
    if (points.length === 0) throw new Error(`${path}.points: empty`);
    for (const [pointIndex, value] of points.entries()) {
      const point = object(value, `${path}.points[${pointIndex}]`);
      if (!Number.isSafeInteger(point['index']) || !Number.isSafeInteger(point['cents']) ||
        !/^[a-f0-9]{16}$/.test(String(point['bits']))) throw new Error(`${path}.points[${pointIndex}]: malformed point`);
    }
  }
  delete prices['content'];

  const recording = parse(revision.recording, `${side}.recording`);
  const recordedWith = object(recording['recordedWith'], `${side}.recording.recordedWith`);
  equalLabel(recordedWith['content'], content, `${side}.recording.recordedWith.content`);
  equalLabel(recordedWith['engine'], engine, `${side}.recording.recordedWith.engine`);
  if (!Number.isSafeInteger(recordedWith['protocol'])) throw new Error(`${side}.recording.recordedWith.protocol: expected integer`);
  delete recordedWith['content'];
  const frames = array(recording['frames'], `${side}.recording.frames`);
  const labels = frames.map((entry, index) => text(object(entry, `frames[${index}]`)['label'], `frames[${index}].label`));
  if (new Set(labels).size !== labels.length || LABELS.some((label) => !labels.includes(label))) {
    throw new Error(`${side}.recording.frames: missing expected frame labels or duplicate label`);
  }
  for (const [index, value] of frames.entries()) {
    const path = `${side}.recording.frames[${index}].frame`;
    const frame = object(object(value, path)['frame'], path);
    const news = array(frame['news'], `${path}.news`);
    for (const [newsIndex, value] of news.entries()) {
      const item = object(value, `${path}.news[${newsIndex}]`);
      for (const key of ['source', 'title', 'body']) {
        text(item[key], `${path}.news[${newsIndex}].${key}`);
        delete item[key];
      }
    }
    const clock = object(frame['clock'], `${path}.clock`);
    if ('final' in frame) {
      const final = object(frame['final'], `${path}.final`);
      equalLabel(final['content'], content, `${path}.final.content`);
      equalLabel(final['engine'], engine, `${path}.final.engine`);
      delete final['content'];
    } else if (clock['phase'] === 'final' || labels[index] === 'final') {
      throw new Error(`${path}.final: missing final identity`);
    }
  }
  const sheet = parse(revision.sheet, `${side}.sheet`);
  equalLabel(object(sheet['recordedWith'], `${side}.sheet.recordedWith`)['content'], content, `${side}.sheet.recordedWith.content`);
  object(sheet['pool'], `${side}.sheet.pool`);
  array(sheet['games'], `${side}.sheet.games`);
  parse(revision.transcript, `${side}.transcript`);
  return {
    content, prices, recording,
    market: revision.market.replace(CONTENT, '$1$2<content>$2$4'),
    cast: revision.castTest.replace(PIN, '$1$2<content>$2'),
  };
}

function differences(before: unknown, after: unknown, path: string): string[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    return [...(before.length === after.length ? [] : [`${path}.length`]),
      ...Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
        differences(before[index], after[index], `${path}[${index}]`)).flat()];
  }
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      differences(before[key], after[key], `${path}.${key}`));
  }
  return [path];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const FILES: Record<keyof ContentRevision, string> = {
  market: 'packages/shared/src/market.ts', pool: 'packages/shared/src/newsPool.ts',
  castTest: 'packages/shared/test/cast.test.ts', poolTest: 'packages/shared/test/news-pool.test.ts',
  prices: 'packages/shared/test/fixtures/price-paths.json', recording: 'apps/web/src/fixtures/recorded-game.json',
  sheet: 'apps/web/src/lab/modules/news-engine.sheet.json', transcript: 'apps/web/src/lab/modules/command-path.transcript.json',
};

function main(args: string[]): void {
  let base: string | undefined;
  let requireChange = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--base' && base === undefined) base = args[++index];
    else if (arg === '--require-change' && !requireChange) requireChange = true;
    else throw new Error(`Unknown or duplicate argument: ${String(arg)}`);
  }
  if (base === undefined || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base)) {
    throw new Error('--base requires an explicit full immutable commit hash');
  }
  const git = (...argv: string[]): string => execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  equalLabel(git('rev-parse', '--verify', `${base}^{commit}`).trim(), base, '--base');
  const root = git('rev-parse', '--show-toplevel').trim();
  git('-C', root, 'ls-files', '--error-unmatch', '--', ...Object.values(FILES));
  const read = (baseline: boolean): ContentRevision => Object.fromEntries(Object.entries(FILES).map(([key, path]) =>
    [key, baseline ? git('show', `${base}:${path}`) : readFileSync(resolve(root, path), 'utf8')])) as unknown as ContentRevision;
  const errors = compareContentRevision(read(true), read(false), requireChange);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  process.stdout.write(`Content revision OK against ${base}${requireChange ? ' (changed content identity)' : ''}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
