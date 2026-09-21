import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '@strike-desk/shared/protocol';
import type { Frame } from '@strike-desk/shared/protocol';
import { createFakeTransport, fakeFrameText } from '../src/modules/connection/fake';
import type { FakeTransport, FakeTransportOptions } from '../src/modules/connection/fake';
import { createConnection, lineStateOf, resendNever, resendWhileFresh } from '../src/modules/connection/index';
import type {
  CommandOutcome,
  Connection,
  ConnectionOptions,
  PendingCommand,
  SessionStore,
} from '../src/modules/connection/index';

/**
 * The connection's own cases, over a transport driven entirely by hand: the
 * test opens and closes every socket, runs every wait and moves the clock, so
 * nothing here waits for real time. Expected texts, waits and times are typed
 * in, with the sum beside them, never worked out by the code under test.
 */

interface Rig {
  transport: FakeTransport;
  connection: Connection;
}

function rig(
  options: FakeTransportOptions = {},
  resendOnResume: ConnectionOptions['resendOnResume'] = () => false,
): Rig {
  const transport = createFakeTransport(options);
  const connection = createConnection({ seam: transport.seam, sessionKey: 'test.session', resendOnResume });
  return { transport, connection };
}

describe('where the connection stands', () => {
  it('is connecting before connect, while the socket opens and until the first frame', () => {
    const { transport, connection } = rig();
    expect(connection.state.get()).toEqual({
      phase: 'connecting',
      attempt: 0,
      retryAt: null,
      lastMessageAt: null,
      gameGone: false,
      serverFull: false,
    });

    connection.connect();
    expect(connection.state.get().phase).toBe('connecting');

    // An open socket is not a working line: only a frame says the server is there.
    transport.last().fireOpen();
    expect(connection.state.get().phase).toBe('connecting');
  });

  it('is live from the first frame, and says when that frame arrived', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.clock.advance(40);
    transport.last().fireMessage(fakeFrameText());

    expect(connection.state.get()).toEqual({
      phase: 'live',
      attempt: 0,
      retryAt: null,
      lastMessageAt: 40,
      gameGone: false,
      serverFull: false,
    });
  });

  it('is reconnecting after a drop, and says which attempt is due and when', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.clock.advance(250);
    transport.last().fireClose();

    // The first wait is 1,000 ms, unscaled by a draw of 0.5: 250 + 1,000 = 1,250.
    expect(transport.waits()).toEqual([1000]);
    expect(connection.state.get()).toEqual({
      phase: 'reconnecting',
      attempt: 1,
      retryAt: 1250,
      lastMessageAt: 0,
      gameGone: false,
      serverFull: false,
    });
  });

  it('stays reconnecting while the next socket opens, with no attempt waiting', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();
    transport.runNextWait();

    expect(transport.sockets).toHaveLength(2);
    expect(connection.state.get().phase).toBe('reconnecting');
    expect(connection.state.get().attempt).toBe(1);
    expect(connection.state.get().retryAt).toBeNull();

    transport.last().fireOpen();
    expect(connection.state.get().phase).toBe('reconnecting');
  });

  it('counts the attempts while no frame arrives, and says when the second is due', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();
    transport.clock.advance(1000);
    transport.runNextWait();
    transport.last().fireOpen();
    transport.last().fireClose();

    // The second wait is 2,000 ms: 1,000 + 2,000 = 3,000.
    expect(connection.state.get().attempt).toBe(2);
    expect(connection.state.get().retryAt).toBe(3000);
  });

  it('scales a wait by the draw it is handed: 0.8 of it at a draw of 0', () => {
    const { transport, connection } = rig({ random: 0 });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireClose();

    // 1,000 x 0.8 = 800.
    expect(transport.waits()).toEqual([800]);
    expect(connection.state.get().retryAt).toBe(800);
  });

  it('is closed once the page closes it, and connecting again after another connect', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    connection.close();

    expect(connection.state.get().phase).toBe('closed');
    expect(connection.state.get().retryAt).toBeNull();

    connection.connect();
    expect(connection.state.get().phase).toBe('connecting');
    expect(transport.sockets).toHaveLength(2);
  });

  it('hands out the same snapshot until a member changes, and tells a listener once per change', () => {
    const { transport, connection } = rig();
    let told = 0;
    connection.state.subscribe(() => {
      told += 1;
    });
    const before = connection.state.get();

    // Connecting already: opening a socket changes no member.
    connection.connect();
    transport.last().fireOpen();
    expect(connection.state.get()).toBe(before);
    expect(told).toBe(0);

    transport.last().fireMessage(fakeFrameText());
    const live = connection.state.get();
    expect(live).not.toBe(before);
    expect(told).toBe(1);

    // Rubbish off the wire changes nothing.
    transport.last().fireMessage('not json');
    expect(connection.state.get()).toBe(live);
    expect(told).toBe(1);
  });

  it('tells an unsubscribed state listener nothing more', () => {
    const { transport, connection } = rig();
    let told = 0;
    const stop = connection.state.subscribe(() => {
      told += 1;
    });
    stop();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());

    expect(told).toBe(0);
  });

  it('has moved on before any feed listener hears of it', () => {
    const { transport, connection } = rig();
    const seen: string[] = [];
    connection.subscribe((event) => {
      if (event.type === 'message') seen.push(connection.state.get().phase);
    });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());

    expect(seen).toEqual(['live']);
  });

  it('reports a server that refused a new game, until a frame says otherwise', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage('{"t":"error","code":"serverFull"}');

    expect(connection.state.get().serverFull).toBe(true);
    // An error is not data: nothing on screen got newer.
    expect(connection.state.get().phase).toBe('connecting');
    expect(connection.state.get().lastMessageAt).toBeNull();

    transport.last().fireMessage(fakeFrameText());
    expect(connection.state.get().serverFull).toBe(false);
  });
});

describe('where the session is kept', () => {
  it('reads and writes the session under the key it was handed, and no other', () => {
    const kept = new Map<string, string>([['test.session', 's-7']]);
    const storage: SessionStore = {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => {
        kept.set(key, value);
      },
      removeItem: (key) => {
        kept.delete(key);
      },
    };
    const transport = createFakeTransport();
    const connection = createConnection({
      seam: { ...transport.seam, storage },
      sessionKey: 'test.session',
      resendOnResume: () => false,
    });
    connection.connect();
    transport.last().fireOpen();
    expect(transport.last().sent).toEqual(['{"t":"hello","v":1,"session":"s-7"}']);

    transport.last().fireMessage(fakeFrameText({ session: 's-8' }));
    expect([...kept.entries()]).toEqual([['test.session', 's-8']]);
  });

  it('carries on when the storage throws', () => {
    const storage: SessionStore = {
      getItem: () => {
        throw new Error('storage is off');
      },
      setItem: () => {
        throw new Error('storage is off');
      },
      removeItem: () => {
        throw new Error('storage is off');
      },
    };
    const transport = createFakeTransport();
    const connection = createConnection({
      seam: { ...transport.seam, storage },
      sessionKey: 'test.session',
      resendOnResume: () => false,
    });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();
    transport.runNextWait();
    transport.last().fireOpen();

    // Kept in memory for this page load all the same.
    expect(transport.last().sent).toEqual(['{"t":"hello","v":1,"session":"s-1"}']);
  });
});

describe('listeners that throw', () => {
  it('keeps every listener error, not only the first', () => {
    const { connection } = rig();
    connection.subscribe(() => {
      throw new Error('first listener failed');
    });
    connection.subscribe(() => {
      throw new Error('second listener failed');
    });

    let thrown: unknown;
    try {
      connection.connect();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const messages = thrown instanceof AggregateError ? thrown.errors.map((one: unknown) => String(one)) : [];
    expect(messages).toEqual(['Error: first listener failed', 'Error: second listener failed']);
  });
});

// ---------------------------------------------------------------- commands

const START = { t: 'start', commandId: 'command-1', pace: 3 } as const;
const START_TEXT = '{"t":"start","commandId":"command-1","pace":3}';
const BUY = { t: 'buy', commandId: 'command-2', day: 2, contractId: 17, spendCents: 50000, seenPriceCents: 1200 } as const;
const BUY_TEXT = '{"t":"buy","commandId":"command-2","day":2,"contractId":17,"spendCents":50000,"seenPriceCents":1200}';
const HELLO_AGAIN_TEXT = '{"t":"hello","v":1,"session":"s-1"}';

const START_ACCEPTED = { commandId: 'command-1', kind: 'start', step: 3, outcome: 'accepted' } as const;
const START_REJECTED = {
  commandId: 'command-1',
  kind: 'start',
  step: 3,
  outcome: 'rejected',
  reason: 'alreadyStarted',
} as const;
const BUY_ACCEPTED = { commandId: 'command-2', kind: 'buy', step: 4, outcome: 'accepted', positionId: 'p-1' } as const;

/** The text of a reply: a receipt and a frame. The frame's own receipts stay empty unless given. */
function replyText(receipt: Record<string, unknown>, frameChanges: Record<string, unknown> = {}): string {
  return JSON.stringify({ t: 'reply', receipt, frame: JSON.parse(fakeFrameText(frameChanges)) as unknown });
}

/** Connected, open and one frame in. */
function liveRig(resendOnResume: ConnectionOptions['resendOnResume'] = () => false): Rig {
  const made = rig({}, resendOnResume);
  made.connection.connect();
  made.transport.last().fireOpen();
  made.transport.last().fireMessage(fakeFrameText());
  return made;
}

/** The line drops, the wait runs and the next socket opens: everything up to the first frame. */
function dropAndReopen({ transport }: Rig): void {
  transport.last().fireClose();
  transport.runNextWait();
  transport.last().fireOpen();
}

/** What a promise has resolved to so far, read without waiting for anything but the microtask queue. */
function watch(promise: Promise<CommandOutcome>): { outcome(): Promise<CommandOutcome | 'still pending'> } {
  let seen: CommandOutcome | 'still pending' = 'still pending';
  void promise.then((outcome) => {
    seen = outcome;
  });
  return {
    async outcome() {
      await Promise.resolve();
      await Promise.resolve();
      return seen;
    },
  };
}

describe('a submitted command', () => {
  it('goes out once as one text and is pending as sent', () => {
    const { transport, connection } = liveRig();
    transport.clock.advance(70);
    void connection.submit(START);

    expect(transport.last().sent).toEqual(['{"t":"hello","v":1}', START_TEXT]);
    expect(connection.pending.get()).toEqual([{ command: START, status: 'sent', sentAt: 70, sends: 1 }]);
  });

  it('settles as accepted when a reply names it, and is pending no more', async () => {
    const { transport, connection } = liveRig();
    const result = watch(connection.submit(START));
    expect(await result.outcome()).toBe('still pending');

    transport.last().fireMessage(replyText(START_ACCEPTED));

    expect(await result.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
    expect(connection.pending.get()).toEqual([]);
  });

  it('settles as rejected, with the reason, when the reply says so', async () => {
    const { transport, connection } = liveRig();
    const result = watch(connection.submit(START));
    transport.last().fireMessage(replyText(START_REJECTED));

    expect(await result.outcome()).toEqual({ outcome: 'rejected', receipt: START_REJECTED });
  });

  it('settles when a later frame names it in its receipts', async () => {
    const { transport, connection } = liveRig();
    const result = watch(connection.submit(START));
    transport.last().fireMessage(fakeFrameText({ rev: 1, step: 3, receipts: [START_ACCEPTED] }));

    expect(await result.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
    expect(connection.pending.get()).toEqual([]);
  });

  it('is one command however often its id is submitted while it is pending', async () => {
    const { transport, connection } = liveRig();
    const first = watch(connection.submit(START));
    const second = watch(connection.submit(START));

    expect(transport.last().sent).toEqual(['{"t":"hello","v":1}', START_TEXT]);
    expect(connection.pending.get()).toHaveLength(1);

    transport.last().fireMessage(replyText(START_ACCEPTED));
    expect(await first.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
    expect(await second.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
  });

  it('is checking, and handed to no socket, when submitted before the line is up', () => {
    const { transport, connection } = rig();
    void connection.submit(START);

    expect(transport.sockets).toEqual([]);
    expect(connection.pending.get()).toEqual([{ command: START, status: 'checking', sentAt: 0, sends: 0 }]);

    // An open socket with no frame yet is still not a working line.
    connection.connect();
    transport.last().fireOpen();
    void connection.submit(BUY);
    expect(transport.last().sent).toEqual(['{"t":"hello","v":1}']);
    expect(connection.pending.get().map((one) => [one.status, one.sends])).toEqual([
      ['checking', 0],
      ['checking', 0],
    ]);
  });

  it('is checking, and handed to no socket, when submitted while the line is down', () => {
    const made = liveRig();
    made.transport.last().fireClose();
    made.transport.clock.advance(300);
    void made.connection.submit(START);

    expect(made.transport.last().sent).toEqual(['{"t":"hello","v":1}']);
    expect(made.transport.last().discarded).toEqual([]);
    expect(made.connection.pending.get()).toEqual([{ command: START, status: 'checking', sentAt: 300, sends: 0 }]);
  });

  it('turns from sent to checking when the line drops', () => {
    const { transport, connection } = liveRig();
    void connection.submit(START);
    void connection.submit(BUY);
    transport.last().fireClose();

    expect(connection.pending.get().map((one) => [one.command.commandId, one.status, one.sends])).toEqual([
      ['command-1', 'checking', 1],
      ['command-2', 'checking', 1],
    ]);
  });

  it('hands out the same list until it changes, and tells a listener once per change', () => {
    const { transport, connection } = liveRig();
    let told = 0;
    connection.pending.subscribe(() => {
      told += 1;
    });
    const empty = connection.pending.get();

    transport.last().fireMessage(fakeFrameText({ step: 1 }));
    expect(connection.pending.get()).toBe(empty);
    expect(told).toBe(0);

    void connection.submit(START);
    const one = connection.pending.get();
    expect(one).not.toBe(empty);
    expect(told).toBe(1);

    transport.last().fireMessage(fakeFrameText({ step: 2 }));
    expect(connection.pending.get()).toBe(one);
    expect(told).toBe(1);
  });
});

describe('a command across a dropped line', () => {
  it('the reply was lost', async () => {
    const asked: string[] = [];
    const made = liveRig((pending) => {
      asked.push(pending.command.commandId);
      return true;
    });
    const { transport, connection } = made;
    const result = watch(connection.submit(START));

    transport.last().fireClose();
    expect(connection.pending.get()).toEqual([{ command: START, status: 'checking', sentAt: 0, sends: 1 }]);
    expect(await result.outcome()).toBe('still pending');

    transport.runNextWait();
    transport.last().fireOpen();
    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT]);

    // The server had it all along: the first frame says so.
    transport.last().fireMessage(fakeFrameText({ rev: 1, step: 9, receipts: [START_ACCEPTED] }));

    expect(await result.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
    expect(connection.pending.get()).toEqual([]);
    // Settled, so nobody was asked whether to resend it, and nothing went out again.
    expect(asked).toEqual([]);
    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT]);
    expect(connection.state.get().phase).toBe('resumed');

    transport.last().fireMessage(fakeFrameText({ rev: 1, step: 10 }));
    expect(connection.state.get().phase).toBe('live');
  });

  it('the command never arrived', async () => {
    const made = liveRig(() => true);
    const { transport, connection } = made;
    const result = watch(connection.submit(START));
    dropAndReopen(made);

    // The first frame knows nothing of it, so it goes out again: the same text, once.
    transport.clock.advance(1000);
    transport.last().fireMessage(fakeFrameText({ step: 9 }));

    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT, START_TEXT]);
    expect(connection.pending.get()).toEqual([{ command: START, status: 'sent', sentAt: 0, sends: 2 }]);
    expect(connection.state.get().phase).toBe('resumed');
    expect(await result.outcome()).toBe('still pending');

    transport.last().fireMessage(replyText(START_ACCEPTED, { rev: 1, step: 10 }));
    expect(await result.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
    expect(connection.pending.get()).toEqual([]);
    expect(connection.state.get().phase).toBe('live');
    // Exactly one command text per send: the first socket carried it once, the second once.
    expect(transport.sockets.map((socket) => socket.sent)).toEqual([
      ['{"t":"hello","v":1}', START_TEXT],
      [HELLO_AGAIN_TEXT, START_TEXT],
    ]);
  });

  it('the command never arrived, and nothing resends it until it is asked to', async () => {
    const made = liveRig(() => false);
    const { transport, connection } = made;
    const result = watch(connection.submit(START));
    dropAndReopen(made);
    transport.last().fireMessage(fakeFrameText({ step: 9 }));

    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT]);
    expect(connection.pending.get()).toEqual([{ command: START, status: 'checking', sentAt: 0, sends: 1 }]);

    // Not while the first frame is still being settled: only when live.
    connection.resend('command-1');
    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT]);

    transport.last().fireMessage(fakeFrameText({ step: 10 }));
    expect(connection.state.get().phase).toBe('live');
    expect(connection.pending.get()).toEqual([{ command: START, status: 'checking', sentAt: 0, sends: 1 }]);

    connection.resend('nope');
    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT]);

    connection.resend('command-1');
    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT, START_TEXT]);
    expect(connection.pending.get()).toEqual([{ command: START, status: 'sent', sentAt: 0, sends: 2 }]);

    transport.last().fireMessage(replyText(START_ACCEPTED, { rev: 1, step: 11 }));
    expect(await result.outcome()).toEqual({ outcome: 'accepted', receipt: START_ACCEPTED });
  });

  it('resends the text it first sent, whatever has happened to the command object since', () => {
    const made = liveRig(() => true);
    const { transport, connection } = made;
    const command = { t: 'start' as const, commandId: 'command-1', pace: 3 as 1 | 3 | 7.5 };
    void connection.submit(command);
    command.pace = 7.5;
    command.commandId = 'command-9';

    dropAndReopen(made);
    transport.last().fireMessage(fakeFrameText({ step: 9 }));

    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT, START_TEXT]);
  });

  it('asks about each unanswered command once, on the first frame after a reconnect and on no other', () => {
    const asked: [string, number][] = [];
    const made = rig({}, (pending, frame) => {
      asked.push([pending.command.commandId, frame.step]);
      return false;
    });
    const { transport, connection } = made;

    // Submitted before the very first frame: that frame follows no reconnect, so nobody is asked.
    void connection.submit(START);
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText({ step: 1 }));
    transport.last().fireMessage(fakeFrameText({ step: 2 }));
    expect(asked).toEqual([]);

    void connection.submit(BUY);
    dropAndReopen(made);
    transport.last().fireMessage(fakeFrameText({ step: 7, receipts: [] }));
    expect(asked).toEqual([
      ['command-1', 7],
      ['command-2', 7],
    ]);

    transport.last().fireMessage(fakeFrameText({ step: 8 }));
    transport.last().fireMessage(replyText({ ...BUY_ACCEPTED, commandId: 'command-7' }, { step: 9 }));
    expect(asked).toHaveLength(2);

    // A second drop is a second reconnect: what is still unanswered is asked about again.
    dropAndReopen(made);
    transport.last().fireMessage(fakeFrameText({ step: 20, rev: 1, receipts: [BUY_ACCEPTED] }));
    expect(asked).toEqual([
      ['command-1', 7],
      ['command-2', 7],
      ['command-1', 20],
    ]);
  });

  it('resends once and then waits: later frames hand nothing more over while it is still unanswered', () => {
    const made = liveRig(() => true);
    const { transport, connection } = made;
    void connection.submit(START);
    dropAndReopen(made);
    transport.last().fireMessage(fakeFrameText({ step: 9 }));
    transport.last().fireMessage(fakeFrameText({ step: 10 }));
    transport.last().fireMessage(fakeFrameText({ step: 11 }));

    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT, START_TEXT]);
    expect(connection.pending.get()).toEqual([{ command: START, status: 'sent', sentAt: 0, sends: 2 }]);
  });

  it('never resends into another game: a frame naming another session loses what was pending', async () => {
    const made = liveRig(() => true);
    const { transport, connection } = made;
    const result = watch(connection.submit(BUY));
    dropAndReopen(made);
    transport.last().fireMessage(fakeFrameText({ session: 's-2', step: 1 }));

    expect(await result.outcome()).toEqual({ outcome: 'lost' });
    expect(transport.last().sent).toEqual([HELLO_AGAIN_TEXT]);
    expect(connection.pending.get()).toEqual([]);
  });
});

describe('a command that will never be answered', () => {
  it('is lost when the server refuses the message itself', async () => {
    const { transport, connection } = liveRig();
    const start = watch(connection.submit(START));
    const buy = watch(connection.submit(BUY));
    transport.last().fireMessage('{"t":"error","code":"tooManyCommands","commandId":"command-2"}');

    expect(await buy.outcome()).toEqual({ outcome: 'lost' });
    expect(await start.outcome()).toBe('still pending');
    expect(connection.pending.get().map((one) => one.command.commandId)).toEqual(['command-1']);
  });

  it('is lost, all of them, when the server says the game is gone, and the page is told until it says it saw', async () => {
    const { transport, connection } = liveRig();
    const start = watch(connection.submit(START));
    const buy = watch(connection.submit(BUY));
    transport.last().fireMessage('{"t":"error","code":"noSession"}');

    expect(await start.outcome()).toEqual({ outcome: 'lost' });
    expect(await buy.outcome()).toEqual({ outcome: 'lost' });
    expect(connection.pending.get()).toEqual([]);
    expect(connection.state.get().gameGone).toBe(true);

    // The new game's frame does not clear it: only the player does.
    transport.last().fireMessage(fakeFrameText({ session: 's-2' }));
    expect(connection.state.get().gameGone).toBe(true);

    connection.dismissGameGone();
    expect(connection.state.get().gameGone).toBe(false);
  });

  it('is lost, all of them, when the page closes the connection', async () => {
    const { connection } = liveRig();
    const start = watch(connection.submit(START));
    connection.close();

    expect(await start.outcome()).toEqual({ outcome: 'lost' });
    expect(connection.pending.get()).toEqual([]);
  });

  it('is lost on close even when the connection was never opened', async () => {
    const { connection } = rig();
    const start = watch(connection.submit(START));
    connection.close();

    expect(await start.outcome()).toEqual({ outcome: 'lost' });
    expect(connection.state.get().phase).toBe('closed');
  });

  it('can be submitted again once it has ended, as a new command', () => {
    const { transport, connection } = liveRig();
    void connection.submit(BUY);
    transport.last().fireMessage(replyText(BUY_ACCEPTED));
    void connection.submit(BUY);

    // The server answers a repeated id with the first receipt, so this is safe.
    expect(transport.last().sent).toEqual(['{"t":"hello","v":1}', BUY_TEXT, BUY_TEXT]);
  });
});

describe('how old the data is', () => {
  it('is stale once nothing has arrived for 1,500 ms, and live again with the next message', () => {
    const { transport, connection } = rig();
    let told = 0;
    connection.state.subscribe(() => {
      told += 1;
    });
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    expect(transport.waits()).toEqual([1500]);
    expect(told).toBe(1);

    // A check that runs early changes nothing and books the rest: 1,500 - 1,499 = 1.
    transport.clock.advance(1499);
    transport.runNextWait();
    expect(connection.state.get().phase).toBe('live');
    expect(transport.waits()).toEqual([1500, 1]);
    expect(told).toBe(1);

    transport.clock.advance(1);
    expect(transport.clock.now()).toBe(1500);
    transport.runNextWait();
    expect(connection.state.get().phase).toBe('stale');
    expect(connection.state.get().lastMessageAt).toBe(0);
    expect(told).toBe(2);

    transport.clock.advance(400);
    transport.last().fireMessage(fakeFrameText({ step: 1 }));
    expect(connection.state.get().phase).toBe('live');
    expect(connection.state.get().lastMessageAt).toBe(1900);
  });

  it('books one check per message and calls off the one before', () => {
    const { transport, connection } = rig();
    connection.state.subscribe(() => {});
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.clock.advance(200);
    transport.last().fireMessage(fakeFrameText({ step: 1 }));

    expect(transport.waits()).toEqual([1500, 1500]);
    expect(transport.pendingWaits()).toBe(1);
  });

  it('checks nothing once the line is down or the page has closed it', () => {
    const { transport, connection } = rig();
    connection.state.subscribe(() => {});
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.last().fireClose();

    // One wait left: the reconnect. The stale check was called off.
    expect(transport.waits()).toEqual([1500, 1000]);
    expect(transport.pendingWaits()).toBe(1);

    connection.close();
    expect(transport.pendingWaits()).toBe(0);
  });

  it('asks the seam for no wait while nobody watches the state, and still answers honestly', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    expect(transport.waits()).toEqual([]);

    transport.clock.advance(1499);
    expect(connection.state.get().phase).toBe('live');
    transport.clock.advance(1);
    expect(connection.state.get().phase).toBe('stale');
  });

  it('starts checking when the first watcher arrives and stops when the last one leaves', () => {
    const { transport, connection } = rig();
    connection.connect();
    transport.last().fireOpen();
    transport.last().fireMessage(fakeFrameText());
    transport.clock.advance(500);

    // 1,500 - 500 = 1,000 left.
    const stop = connection.state.subscribe(() => {});
    expect(transport.waits()).toEqual([1000]);
    expect(transport.pendingWaits()).toBe(1);

    stop();
    expect(transport.pendingWaits()).toBe(0);
  });

  it('keeps a sent command sent while the data is merely stale', () => {
    const { transport, connection } = liveRig();
    void connection.submit(START);
    transport.clock.advance(1500);

    expect(connection.state.get().phase).toBe('stale');
    expect(connection.pending.get()).toEqual([{ command: START, status: 'sent', sentAt: 0, sends: 1 }]);
  });
});

describe('the line as the ticket and the desk see it', () => {
  it('maps each of the six phases to one of the three line states', () => {
    expect(lineStateOf('connecting')).toBe('offline');
    expect(lineStateOf('live')).toBe('live');
    expect(lineStateOf('stale')).toBe('stale');
    expect(lineStateOf('reconnecting')).toBe('offline');
    expect(lineStateOf('resumed')).toBe('stale');
    expect(lineStateOf('closed')).toBe('offline');
  });
});

describe('the two ready-made answers to whether a command resends by itself', () => {
  const frameOfDay = (day: number): Frame => {
    const message = parseServerMessage(
      JSON.parse(fakeFrameText({ clock: { phase: 'open', day, stepsLeft: 100, priceIndex: 10, pace: 3 } })),
    );
    if (message?.t !== 'frame') throw new Error('not a frame');
    return message;
  };
  const sentAt = (at: number): PendingCommand => ({ command: BUY, status: 'checking', sentAt: at, sends: 1 });

  it('never: always false', () => {
    expect(resendNever(sentAt(0), frameOfDay(2))).toBe(false);
  });

  it('while fresh: true for a buy of day 2 sent 4,000 ms ago while it is still day 2', () => {
    const policy = resendWhileFresh({ maxAgeMs: 5000, now: () => 10000 });

    // 10,000 - 6,000 = 4,000.
    expect(policy(sentAt(6000), frameOfDay(2))).toBe(true);
  });

  it('while fresh: false once the press is 6,000 ms old', () => {
    const policy = resendWhileFresh({ maxAgeMs: 5000, now: () => 10000 });

    // 10,000 - 4,000 = 6,000.
    expect(policy(sentAt(4000), frameOfDay(2))).toBe(false);
  });

  it('while fresh: false once the day has moved on, however recent the press', () => {
    const policy = resendWhileFresh({ maxAgeMs: 5000, now: () => 10000 });

    expect(policy(sentAt(6000), frameOfDay(3))).toBe(false);
  });

  it('while fresh: a command that names no day goes by its age alone', () => {
    const policy = resendWhileFresh({ maxAgeMs: 5000, now: () => 10000 });
    const start: PendingCommand = { command: START, status: 'checking', sentAt: 6000, sends: 0 };

    expect(policy(start, frameOfDay(0))).toBe(true);
  });
});
