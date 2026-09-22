import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, ENGINE_VERSION, PROTOCOL_VERSION, frameSchema } from '@strike-desk/shared/engine';

/**
 * The recorded game is a frozen file: the frames one real game sent, taken
 * once and committed, so that a demo can be shown without a server. Nothing
 * in it moves when the rules move. Without this case, a bump to the engine or
 * to the content would leave the recording describing a game this code no
 * longer plays — the old prices, the old cast, the old wording — and every
 * check would stay green.
 *
 * The comparison is made here rather than beside the recording's other cases
 * in `apps/web` because the two version labels live behind the shared
 * package's engine entry, which the web package may not import: the engine
 * computes future prices and must never reach the browser. This package may.
 */

/** What to do about a failure here, said where a red run will show it. */
const RETAKE = 'The recorded game is older than the rules. Retake it: pnpm --filter @strike-desk/server exec tsx scripts/record-frames.ts';

const RECORDING = new URL('../../web/src/fixtures/recorded-game.json', import.meta.url);

describe('the recorded game', () => {
  it('was recorded from the rules as they stand today', () => {
    const { recordedWith, frames } = JSON.parse(readFileSync(RECORDING, 'utf8')) as {
      recordedWith: { protocol: number; engine: string; content: string };
      frames: { label: string; frame: unknown }[];
    };

    expect(recordedWith, RETAKE).toEqual({ protocol: PROTOCOL_VERSION, engine: ENGINE_VERSION, content: CONTENT_VERSION });
    const finals = frames.map(({ label, frame }) => ({ label, final: frameSchema.parse(frame).final }))
      .filter(({ final }) => final !== undefined);
    expect(finals.length, RETAKE).toBeGreaterThan(0);
    for (const { label, final } of finals) {
      expect([final?.engine, final?.content], `${label}: ${RETAKE}`).toEqual([ENGINE_VERSION, CONTENT_VERSION]);
    }
  });
});
