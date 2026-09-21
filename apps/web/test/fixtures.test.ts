import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, frameSchema } from '@strike-desk/shared/protocol';
import type { Frame } from '@strike-desk/shared/protocol';
import { RECORDED_LABELS, recordedFrame, recordedGame } from '../src/fixtures/recordedGame';
import type { RecordedLabel } from '../src/fixtures/recordedGame';
import recordedText from '../src/fixtures/recorded-game.json?raw';

/**
 * The recorded game, read the way the web app reads it. These cases say what
 * a consumer may rely on: the labels, the moment each one stands for, and
 * that the file holds nothing a player's browser would not have received at
 * that moment. No price, ticket price or quantity of the recording is written
 * down here: the recording may be retaken after the prices change.
 */

const PHASE_AND_DAY: Record<RecordedLabel, readonly [Frame['clock']['phase'], number]> = {
  lobby: ['lobby', 0],
  'day1-before-bell': ['preBell', 1],
  'day1-draft': ['preBell', 1],
  'day1-bought': ['preBell', 1],
  'day1-open': ['open', 1],
  'day1-after-reveal': ['open', 1],
  'day1-cashed-out': ['open', 1],
  'day1-debrief': ['debrief', 1],
  'day2-before-bell': ['preBell', 2],
  'day2-rejected': ['preBell', 2],
  'day2-bought': ['preBell', 2],
  'day2-held-to-bell': ['debrief', 2],
  final: ['final', 5],
};

describe('the recorded game', () => {
  it('holds exactly the thirteen labels, in order, each once', () => {
    expect(RECORDED_LABELS).toEqual([
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
    ]);
    expect(recordedGame().frames.map((entry) => entry.label)).toEqual([...RECORDED_LABELS]);
  });

  it('was recorded with the protocol the page speaks today', () => {
    expect(recordedGame().recordedWith.protocol).toBe(PROTOCOL_VERSION);
    expect(recordedGame().recordedWith.engine).not.toBe('');
    expect(recordedGame().recordedWith.content).not.toBe('');
  });

  it('holds only frames the current frame schema accepts, read straight from the file', () => {
    const raw = JSON.parse(recordedText) as { frames: { frame: unknown }[] };

    expect(raw.frames).toHaveLength(13);
    for (const entry of raw.frames) {
      expect(frameSchema.safeParse(entry.frame).success).toBe(true);
    }
  });

  it('gives the same parsed game every time', () => {
    expect(recordedGame()).toBe(recordedGame());
  });

  it.each(RECORDED_LABELS.map((label) => [label, ...PHASE_AND_DAY[label]] as const))('%s is %s, day %i', (label, phase, day) => {
    const { clock } = recordedFrame(label);

    expect(clock.phase).toBe(phase);
    if (phase !== 'final') expect(clock.day).toBe(day);
  });

  it('starts in a lobby with the starting cash, no board and no ticket price', () => {
    const lobby = recordedFrame('lobby');

    expect(lobby.account.cashCents).toBe(100_000_000);
    expect(lobby.board).toBeNull();
    expect(lobby.quotes).toEqual([]);
  });

  it('carries 252 ticket prices with every column, and six rows of history, wherever there is a board', () => {
    for (const label of RECORDED_LABELS) {
      const frame = recordedFrame(label);
      if (frame.board === null) continue;
      expect([label, frame.quotes.length]).toEqual([label, 252]);
      expect([label, frame.quoteReals.length]).toEqual([label, 252]);
      expect([label, frame.quoteHopes.length]).toEqual([label, 252]);
      expect([label, frame.quoteBreakEvens.length]).toEqual([label, 252]);
      expect([label, frame.history?.length]).toEqual([label, 6]);
    }
  });

  it('quotes the ticket being built in day1-draft and nowhere else', () => {
    const draft = recordedFrame('day1-draft').draft;

    expect(draft?.spendCents).toBe(10_000_000);
    expect(draft?.costs).toHaveLength(252);
    expect(draft?.ticket?.quantity).toBeGreaterThanOrEqual(1);
    expect(draft?.ticket?.costCents).toBeLessThanOrEqual(10_000_000);
    for (const label of RECORDED_LABELS) {
      if (label !== 'day1-draft') expect([label, recordedFrame(label).draft]).toEqual([label, undefined]);
    }
  });

  it('shows an accepted buy in day1-bought: one open ticket that cost its price times its quantity', () => {
    const frame = recordedFrame('day1-bought');
    const receipt = frame.receipts.at(-1);
    const [position] = frame.positions;

    expect(receipt?.kind).toBe('buy');
    expect(receipt?.outcome).toBe('accepted');
    expect(receipt?.positionId).toBe('d1');
    expect(frame.positions).toHaveLength(1);
    expect(position?.status).toBe('open');
    expect(position?.costCents).toBe((position?.entryPriceCents ?? 0) * (position?.quantity ?? 0));
    expect(frame.account.canBuy).toBe(false);
  });

  it('has a revealed headline in day1-after-reveal', () => {
    expect(recordedFrame('day1-after-reveal').news.some((item) => item.revealed)).toBe(true);
  });

  it('shows the cash-out in day1-cashed-out, with the profit the server sent', () => {
    const position = recordedFrame('day1-cashed-out').positions.find((held) => held.id === 'd1');

    expect(position?.status).toBe('cashedOut');
    expect(position?.exit).toBeDefined();
    expect(position?.profitCents).toBe((position?.exit?.proceedsCents ?? 0) - (position?.costCents ?? 0));
  });

  it('shows a refusal in day2-rejected that changed nothing', () => {
    const frame = recordedFrame('day2-rejected');
    const receipt = frame.receipts.at(-1);

    expect(receipt?.outcome).toBe('rejected');
    expect(receipt?.reason).toBe('overCap');
    expect(frame.positions.map((position) => position.id)).toEqual(['d1']);
  });

  it('shows a ticket held to the bell in day2-held-to-bell', () => {
    const frame = recordedFrame('day2-held-to-bell');
    const position = frame.positions.find((held) => held.id === 'd2');

    expect(position?.status).toBe('settled');
    expect(position?.exit?.kind).toBe('bell');
    expect(frame.days).toHaveLength(2);
  });

  it('names its market only in the final frame', () => {
    expect(recordedFrame('final').final?.marketCode).not.toBe('');
    expect(recordedFrame('final').final).toBeDefined();
    for (const label of RECORDED_LABELS) {
      if (label !== 'final') expect([label, recordedFrame(label).final]).toEqual([label, undefined]);
    }
  });

  it('keeps hidden what a player could not see at that moment', () => {
    for (const label of RECORDED_LABELS) {
      const frame = recordedFrame(label);
      const beforeTheBell = frame.clock.phase === 'preBell' || frame.clock.phase === 'open';
      for (const item of frame.news) {
        if (beforeTheBell) expect([label, item.id, item.wasTrue]).toEqual([label, item.id, undefined]);
        if (!item.revealed) expect([label, item.id, item.revealIndex]).toEqual([label, item.id, undefined]);
      }
    }
  });

  it('never runs ahead of its own clock: history stops at the price showing, and a reveal lies behind it', () => {
    for (const label of RECORDED_LABELS) {
      const frame = recordedFrame(label);
      for (const row of frame.history ?? []) expect([label, row.length]).toEqual([label, frame.clock.priceIndex + 1]);
      for (const item of frame.news) {
        if (item.revealIndex !== undefined) expect([label, item.id, item.revealIndex <= frame.clock.priceIndex]).toEqual([label, item.id, true]);
      }
    }
  });

  it('holds no field at any depth that the frame schema does not name', () => {
    const raw = JSON.parse(recordedText) as { frames: { label: string; frame: unknown }[] };

    // Parsing drops what the schema does not know, so an equal result means nothing was dropped.
    for (const entry of raw.frames) expect([entry.label, frameSchema.parse(entry.frame)]).toEqual([entry.label, entry.frame]);
  });

  it('carries no seed and nothing but what the frame schema names', () => {
    const raw = JSON.parse(recordedText) as { recordedWith: object; frames: { label: string; frame: Record<string, unknown> }[] };
    const known = new Set(Object.keys(frameSchema.shape));

    expect(Object.keys(raw).sort()).toEqual(['frames', 'recordedWith']);
    expect(Object.keys(raw.recordedWith).sort()).toEqual(['content', 'engine', 'protocol']);
    for (const entry of raw.frames) {
      expect(Object.keys(entry).sort()).toEqual(['frame', 'label']);
      for (const key of Object.keys(entry.frame)) expect([entry.label, key, known.has(key)]).toEqual([entry.label, key, true]);
    }
    expect(recordedText).not.toMatch(/seed/i);
  });

  it('is small enough to load with a lab demo', () => {
    expect(recordedText.length).toBeLessThan(400_000);
  });

  it('refuses a label that is not in the recording', () => {
    expect(() => recordedFrame('nope' as RecordedLabel)).toThrow('no recorded frame is labelled nope');
  });
});
