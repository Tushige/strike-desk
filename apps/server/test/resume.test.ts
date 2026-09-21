import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, frameSchema } from '@strike-desk/shared/engine';
import type { Frame } from '@strike-desk/shared/engine';
import type { Connection, DoorOptions } from '../src/door';
import { handleClosed, handleInbound } from '../src/door';
import { LIMITS, createTokenBucket, createWindowCounter } from '../src/limits';
import type { FrameSocket } from '../src/sampler';
import { sampleSessions } from '../src/sampler';
import type { SessionRegistry } from '../src/sessions';
import { createRegistry } from '../src/sessions';
import { FIXED_SEEDS } from './harness';

/**
 * Coming back to a game that is already running, through the real door: a
 * page whose line dropped says hello again, naming its session, on a new
 * socket. No network here and no timer: every socket only records what it is
 * sent, and the clock is a number the test moves by hand.
 *
 * What a second tab on a game is, and what the idle sweep does to a game
 * nobody is on, are covered beside the sessions themselves; these are the
 * cases of a line that dropped and came back.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
/** Real milliseconds at pace 1 from `start` to the opening bell of day 1. */
const PRE_BELL_MS = 60_000;
const SAMPLE_MS = 200;
/** The clock reading every case starts at. */
const T0 = 1_000;

interface Seat {
  connection: Connection;
  sent: string[];
  /** The socket goes away, as it does when a line drops. */
  drop(): void;
}

interface Rig {
  door: DoorOptions;
  registry: SessionRegistry;
  clock: { now: number };
  connect(): Seat;
  /** One sampling pass at the clock's reading, as the service's timer would make. */
  sample(): void;
}

function rig(): Rig {
  const ids = ['session-a', 'session-b'];
  let drawn = 0;
  const registry = createRegistry({
    drawSeed: () => FIXED_SEEDS[0] ?? 0,
    drawId: () => {
      const id = ids[drawn] ?? `session-${String(drawn)}`;
      drawn += 1;
      return id;
    },
    limits: LIMITS,
  });
  const clock = { now: T0 };
  const door: DoorOptions = {
    registry,
    now: () => clock.now,
    newSessions: createTokenBucket(LIMITS.newSessionBurst, LIMITS.newSessionRefillPerSecond),
  };

  function connect(): Seat {
    const sent: string[] = [];
    const socket: FrameSocket = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (text) => void sent.push(text) };
    const connection: Connection = {
      socket,
      sessionId: null,
      playerId: null,
      messages: createWindowCounter(LIMITS.messagesPerWindow, LIMITS.messageWindowMs),
    };
    return {
      connection,
      sent,
      drop() {
        socket.readyState = 3;
        handleClosed(door, connection);
      },
    };
  }

  return {
    door,
    registry,
    clock,
    connect,
    sample() {
      sampleSessions(registry, clock.now, { sent: 0, skipped: 0 });
    },
  };
}

function say(made: Rig, seat: Seat, message: Record<string, unknown>): void {
  handleInbound(made.door, seat.connection, JSON.stringify(message));
}

/** The last text a seat was sent, as a frame. Fails when it is anything else. */
function lastFrame(seat: Seat): Frame {
  return frameSchema.parse(JSON.parse(seat.sent.at(-1) ?? 'null'));
}

/** A game that has started and whose day 1 is open, with one socket on it. */
function runningGame(): { made: Rig; first: Seat } {
  const made = rig();
  const first = made.connect();
  say(made, first, HELLO);
  say(made, first, { t: 'start', commandId: 'start-0001', pace: 1 });
  made.clock.now = T0 + PRE_BELL_MS + SAMPLE_MS;
  made.sample();
  return { made, first };
}

describe('resume: a hello that names a running game', () => {
  it('is seated beside the socket already there, which stays where it is', () => {
    const { made, first } = runningGame();
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    expect(made.registry.size).toBe(1);
    expect(returning.connection.sessionId).toBe('session-a');
    expect(first.connection.sessionId).toBe('session-a');
    expect(made.registry.get('session-a')?.sockets.size).toBe(2);
  });

  it('is answered with a frame of that game, no older than the last one the first socket got', () => {
    const { made, first } = runningGame();
    const held = lastFrame(first);
    // The opening bell of day 1 at pace 1, one sample in.
    expect(held).toMatchObject({ session: 'session-a', rev: 1, clock: { phase: 'open', day: 1, priceIndex: 1 } });

    made.clock.now += 3 * SAMPLE_MS;
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    // One text, and it is a frame: no error comes before it.
    expect(returning.sent).toHaveLength(1);
    const taken = lastFrame(returning);
    expect(taken.session).toBe('session-a');
    expect(taken.rev).toBe(1);
    expect(taken.clock).toMatchObject({ phase: 'open', day: 1 });
    // The game did not wait: three samples' worth of clock went by, and the frame is of now.
    expect(taken.step).toBeGreaterThan(held.step);
    expect(taken.clock.priceIndex).toBeGreaterThan(held.clock.priceIndex);
  });

  it('leaves the first socket getting every frame, the same text as the newcomer', () => {
    const { made, first } = runningGame();
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });
    const before = { first: first.sent.length, returning: returning.sent.length };

    made.clock.now += SAMPLE_MS;
    made.sample();

    expect(first.sent).toHaveLength(before.first + 1);
    expect(returning.sent).toHaveLength(before.returning + 1);
    expect(returning.sent.at(-1)).toBe(first.sent.at(-1));
  });

  it('is handed no receipts, and neither is anybody else: today no frame the service sends carries any', () => {
    // What the service does today, written down as a gap and not as the goal.
    // The game holds a receipt by now, the one for `start`, and every frame
    // leaves it out: the answer to a hello, the frame inside a reply and the
    // sampled frame are all the live form, whose receipts are empty. So a page
    // whose reply was lost cannot learn the outcome from a frame; only sending
    // the command again, with the same id, brings the first receipt back. The
    // day a frame carries receipts this goes red, and that is the day to
    // delete it.
    const { made, first } = runningGame();
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    expect(lastFrame(returning).receipts).toEqual([]);
    expect(lastFrame(first).receipts).toEqual([]);

    const reply = JSON.parse(first.sent[1] ?? 'null') as { t: string; receipt: { commandId: string }; frame: unknown };
    expect(reply.t).toBe('reply');
    expect(reply.receipt.commandId).toBe('start-0001');
    expect(frameSchema.parse(reply.frame).receipts).toEqual([]);

    // The same id again: the first receipt comes back, in a reply, and nothing else changes.
    say(made, returning, { t: 'start', commandId: 'start-0001', pace: 1 });
    const again = JSON.parse(returning.sent.at(-1) ?? 'null') as { t: string; receipt: Record<string, unknown>; frame: unknown };
    expect(again.t).toBe('reply');
    expect(again.receipt).toMatchObject({ commandId: 'start-0001', kind: 'start', outcome: 'accepted' });
    expect(frameSchema.parse(again.frame).rev).toBe(1);
  });

  it('takes no new game from the budget, and starts no new market', () => {
    const { made } = runningGame();
    for (let again = 0; again < 3; again += 1) {
      const returning = made.connect();
      say(made, returning, { ...HELLO, session: 'session-a' });
      returning.drop();
    }

    expect(made.registry.size).toBe(1);
  });
});

describe('resume: a game whose line dropped', () => {
  it('is not idle while another socket is still on it', () => {
    const { made, first } = runningGame();
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    made.clock.now += 5_000;
    first.drop();

    expect(made.registry.get('session-a')?.idleSinceMs).toBeNull();
    expect(made.registry.get('session-a')?.sockets.size).toBe(1);
  });

  it('is idle from the reading at which its last socket left', () => {
    const { made, first } = runningGame();
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    // 1,000 + 60,000 + 200 = 61,200, then 5,000 and 2,000 more: 68,200.
    made.clock.now += 5_000;
    first.drop();
    made.clock.now += 2_000;
    returning.drop();

    expect(made.registry.get('session-a')?.idleSinceMs).toBe(68_200);
  });

  it('is still there for a page that comes back before the half hour is up, and is idle no longer', () => {
    const { made, first } = runningGame();
    first.drop();

    // One millisecond short of the 1,800,000 ms the service keeps an empty game.
    made.clock.now += 1_799_999;
    made.registry.sweepOnce(made.clock.now);
    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    expect(returning.sent).toHaveLength(1);
    expect(lastFrame(returning).session).toBe('session-a');
    expect(made.registry.get('session-a')?.idleSinceMs).toBeNull();
  });
});

describe('resume: a hello that names a game that is gone', () => {
  it('is told the game is gone first, and then handed a frame of another game', () => {
    const { made, first } = runningGame();
    first.drop();
    made.clock.now += 1_800_000;
    made.registry.sweepOnce(made.clock.now);
    expect(made.registry.size).toBe(0);

    const returning = made.connect();
    say(made, returning, { ...HELLO, session: 'session-a' });

    expect(returning.sent).toHaveLength(2);
    expect(JSON.parse(returning.sent[0] ?? 'null') as unknown).toEqual({ t: 'error', code: 'noSession' });
    const taken = lastFrame(returning);
    expect(taken.session).toBe('session-b');
    // A new game, not the old one carried on: nothing has happened in it yet.
    expect(taken).toMatchObject({ rev: 0, clock: { phase: 'lobby', day: 0 } });
    expect(returning.connection.sessionId).toBe('session-b');
  });
});
