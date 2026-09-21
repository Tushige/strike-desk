import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoopbackTransport } from '../src/modules/connection/fake';
import type { LoopbackTransport } from '../src/modules/connection/fake';
import { createConnection, resendNever, resendWhileFresh } from '../src/modules/connection/index';
import type { CommandOutcome, Connection, ConnectionOptions } from '../src/modules/connection/index';

/**
 * The connection against the stand-in server the lab page uses, end to end:
 * a buy, a cut line, a reconnect, and the count of tickets the server holds
 * at the end. Every timer here is a fake one, moved by hand, so nothing waits
 * for real time. The times are the stand-in's own, typed in: a socket opens
 * after 120 ms, the server answers after 40 ms, a frame comes every 200 ms,
 * and the first reconnect waits 1,000 ms at a draw of 0.5.
 */

const BUY = { t: 'buy', commandId: 'lab-buy-1', day: 1, contractId: 7, spendCents: 50000, seenPriceCents: 1200 } as const;
const BUY_TEXT = '{"t":"buy","commandId":"lab-buy-1","day":1,"contractId":7,"spendCents":50000,"seenPriceCents":1200}';

interface Rig {
  server: LoopbackTransport;
  connection: Connection;
}

function timer(run: () => void, ms: number): () => void {
  const booked = setTimeout(run, ms);
  return () => {
    clearTimeout(booked);
  };
}

function rig(resendOnResume: ConnectionOptions['resendOnResume']): Rig {
  const server = createLoopbackTransport({ schedule: timer, now: () => Date.now(), random: () => 0.5 });
  const connection = createConnection({ seam: server.seam, sessionKey: 'lab.connection.session', resendOnResume });
  return { server, connection };
}

/** Connect and let the socket open (120) and the hello be answered (40): 160 ms to live. */
function goLive({ connection }: Rig): void {
  connection.connect();
  vi.advanceTimersByTime(160);
  expect(connection.state.get().phase).toBe('live');
}

/** The wait (1,000), the socket opening (120) and the hello's answer (40): 1,160 ms to the first frame. */
const RECONNECT_TO_FIRST_FRAME_MS = 1160;

function watch(promise: Promise<CommandOutcome>): { outcome(): Promise<CommandOutcome['outcome'] | 'still pending'> } {
  let seen: CommandOutcome['outcome'] | 'still pending' = 'still pending';
  void promise.then((ended) => {
    seen = ended.outcome;
  });
  return {
    async outcome() {
      await Promise.resolve();
      await Promise.resolve();
      return seen;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the connection against the stand-in server', () => {
  it('buys one ticket when nothing goes wrong', async () => {
    const made = rig(resendNever);
    goLive(made);
    const result = watch(made.connection.submit(BUY));
    expect(await result.outcome()).toBe('still pending');

    vi.advanceTimersByTime(40);

    expect(await result.outcome()).toBe('accepted');
    expect(made.server.tickets()).toBe(1);
    expect(made.connection.pending.get()).toEqual([]);
  });

  it('the reply was lost: the first frame after the reconnect settles it, and there is one ticket', async () => {
    const made = rig(resendNever);
    goLive(made);
    made.server.loseNextReply();
    const result = watch(made.connection.submit(BUY));

    // The server has it and bought the ticket; the answer never comes, and the
    // line drops before any later frame can name it.
    expect(made.server.tickets()).toBe(1);
    made.server.cut();
    expect(await result.outcome()).toBe('still pending');
    expect(made.connection.state.get().phase).toBe('reconnecting');
    expect(made.connection.pending.get().map((one) => one.status)).toEqual(['checking']);

    vi.advanceTimersByTime(RECONNECT_TO_FIRST_FRAME_MS);

    expect(await result.outcome()).toBe('accepted');
    expect(made.server.tickets()).toBe(1);
    // Nothing was sent twice: the receipts on the frame were enough.
    expect(made.server.log().filter((one) => one.text === BUY_TEXT)).toHaveLength(1);
  });

  it('the reply was lost on a line that stays up: the next frame names it, within 200 ms, and there is one ticket', async () => {
    const made = rig(resendNever);
    goLive(made);
    made.server.loseNextReply();
    const result = watch(made.connection.submit(BUY));

    // No reply at 40 ms, where one would have come.
    vi.advanceTimersByTime(40);
    expect(await result.outcome()).toBe('still pending');

    // Frames come every 200 ms from the socket opening at 120: the next is at 320, 160 ms after going live.
    vi.advanceTimersByTime(120);
    expect(await result.outcome()).toBe('accepted');
    expect(made.server.tickets()).toBe(1);
  });

  it('the command never arrived: it goes out again with the same text, and there is one ticket', async () => {
    const made = rig(resendWhileFresh({ maxAgeMs: 5000, now: () => Date.now() }));
    goLive(made);
    made.server.dropNextCommand();
    const result = watch(made.connection.submit(BUY));

    vi.advanceTimersByTime(400);
    expect(made.server.tickets()).toBe(0);

    made.server.cut();
    vi.advanceTimersByTime(RECONNECT_TO_FIRST_FRAME_MS);
    // Resent on the first frame; the server answers 40 ms later.
    expect(made.connection.pending.get().map((one) => [one.status, one.sends])).toEqual([['sent', 2]]);
    vi.advanceTimersByTime(40);

    expect(await result.outcome()).toBe('accepted');
    expect(made.server.tickets()).toBe(1);
    expect(made.server.log().filter((one) => one.text === BUY_TEXT)).toEqual([
      { socket: 1, text: BUY_TEXT },
      { socket: 2, text: BUY_TEXT },
    ]);
  });

  it('the command never arrived, and with nothing resending by itself it waits, and a resend by hand buys one ticket', async () => {
    const made = rig(resendNever);
    goLive(made);
    made.server.dropNextCommand();
    const result = watch(made.connection.submit(BUY));
    made.server.cut();
    // To the first frame, and one frame more (200) so the line is live again.
    vi.advanceTimersByTime(RECONNECT_TO_FIRST_FRAME_MS + 200);

    expect(made.connection.state.get().phase).toBe('live');
    expect(made.connection.pending.get().map((one) => [one.status, one.sends])).toEqual([['checking', 1]]);
    expect(made.server.tickets()).toBe(0);

    made.connection.resend('lab-buy-1');
    vi.advanceTimersByTime(40);

    expect(await result.outcome()).toBe('accepted');
    expect(made.server.tickets()).toBe(1);
  });

  it('answers a repeated id with the first receipt and buys nothing more', async () => {
    const made = rig(resendNever);
    goLive(made);
    void made.connection.submit(BUY);
    vi.advanceTimersByTime(40);
    const again = watch(made.connection.submit(BUY));
    vi.advanceTimersByTime(40);

    expect(await again.outcome()).toBe('accepted');
    expect(made.server.tickets()).toBe(1);
  });

  it('goes stale after 1,500 ms of silence and live again when traffic resumes', () => {
    const made = rig(resendNever);
    made.connection.state.subscribe(() => {});
    goLive(made);

    made.server.silent(true);
    vi.advanceTimersByTime(1499);
    expect(made.connection.state.get().phase).toBe('live');
    vi.advanceTimersByTime(1);
    expect(made.connection.state.get().phase).toBe('stale');

    made.server.silent(false);
    vi.advanceTimersByTime(200);
    expect(made.connection.state.get().phase).toBe('live');
  });

  it('comes back by itself after a cut, as the lab page shows it', () => {
    const made = rig(resendNever);
    goLive(made);
    made.server.cut();

    expect(made.connection.state.get().phase).toBe('reconnecting');
    expect(made.connection.state.get().attempt).toBe(1);

    vi.advanceTimersByTime(RECONNECT_TO_FIRST_FRAME_MS);
    expect(made.connection.state.get().phase).toBe('resumed');
    vi.advanceTimersByTime(200);
    expect(made.connection.state.get().phase).toBe('live');
    expect(made.connection.state.get().attempt).toBe(0);
  });
});
