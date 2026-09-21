import { frameSchema } from '@strike-desk/shared/protocol';
import type { Frame } from '@strike-desk/shared/protocol';
import recordedText from './recorded-game.json?raw';

/**
 * One real game, recorded as thirteen labelled frames: what a player's
 * browser received at thirteen moments of a game played on a fixed market,
 * written down from the same rules the server runs. Stand-in sources for the
 * display pieces read it, so that a piece can be built and shown away from
 * the running game and still stand on real data.
 *
 * Retake it with
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/record-frames.ts
 *
 * It may be older than today's prices. That is fine for a stand-in: every
 * frame is checked against today's frame schema when the recording is first
 * read, and consumers depend on the labels, not on a number.
 *
 * The recording's market number is in its last frame, where any finished
 * game shows it. It is the market of the fixed seed 4242424242, which no live
 * game uses: live games draw theirs from the operating system's random
 * source.
 */

export const RECORDED_LABELS = [
  'lobby',
  'day1-before-bell',
  'day1-draft',
  'day1-bought',
  'day1-open',
  'day1-after-reveal',
  'day1-cashed-out',
  'day1-debrief',
  'day2-before-bell',
  'day2-rejected',
  'day2-bought',
  'day2-held-to-bell',
  'final',
] as const;

export type RecordedLabel = (typeof RECORDED_LABELS)[number];

export interface RecordedGame {
  recordedWith: { protocol: number; engine: string; content: string };
  frames: readonly { label: RecordedLabel; frame: Frame }[];
}

const WRONG_SHAPE = 'the recorded game is not in the expected shape';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is RecordedLabel {
  return RECORDED_LABELS.some((label) => label === value);
}

/** The outer shape is checked by hand; every frame goes through the frame schema. */
function read(text: string): RecordedGame {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || !isRecord(raw.recordedWith) || !Array.isArray(raw.frames)) throw new Error(WRONG_SHAPE);
  const { protocol, engine, content } = raw.recordedWith;
  if (typeof protocol !== 'number' || typeof engine !== 'string' || typeof content !== 'string') throw new Error(WRONG_SHAPE);

  const frames = raw.frames.map((entry: unknown) => {
    if (!isRecord(entry) || !isLabel(entry.label)) throw new Error(WRONG_SHAPE);
    return { label: entry.label, frame: frameSchema.parse(entry.frame) };
  });
  return { recordedWith: { protocol, engine, content }, frames };
}

let parsed: RecordedGame | null = null;

/** The whole recording, parsed and checked once, on first use. */
export function recordedGame(): RecordedGame {
  parsed ??= read(recordedText);
  return parsed;
}

/** The frame recorded under a label. */
export function recordedFrame(label: RecordedLabel): Frame {
  const entry = recordedGame().frames.find((candidate) => candidate.label === label);
  if (entry === undefined) throw new Error(`no recorded frame is labelled ${label}`);
  return entry.frame;
}
