import type { FeedEvent, FeedStatus } from '@strike-desk/shared/feed';
import type { Command, Frame, Receipt, ServerMessage } from '@strike-desk/shared/protocol';
import { STALE_AFTER_MS } from './ports';
import type {
  CommandOutcome,
  ConnectionPhase,
  ConnectionState,
  CreateConnection,
  PendingCommand,
  ReadSlice,
} from './ports';
import { createSocketFeed, frameOf, throwAll } from './socketFeed';

/**
 * The connection: the block's feed, plus an honest account of where the line
 * stands and of every command that has no answer yet. It listens to its own
 * feed before anyone else can, so by the time any other listener hears of an
 * event, `state` and `pending` have already moved on.
 */

/** A value with listeners. `set` only stores; `flush` tells, once, if anything was stored. */
interface Slice<T> extends ReadSlice<T> {
  set(next: T): void;
  /** Store without anyone being told: for a change nobody was there to watch. */
  replace(next: T): void;
  /** Tell every listener if the value changed since the last flush; failures go into `errors`. */
  flush(errors: unknown[]): void;
}

interface Watching {
  /** The first listener arrived. */
  onFirst(): void;
  /** The last listener left. */
  onLast(): void;
}

function createSlice<T>(initial: T, watching?: Watching): Slice<T> {
  const listeners = new Set<() => void>();
  let value = initial;
  let changed = false;

  return {
    get: () => value,
    set(next: T) {
      if (next === value) return;
      value = next;
      changed = true;
    },
    replace(next: T) {
      value = next;
    },
    flush(errors: unknown[]) {
      if (!changed) return;
      changed = false;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          errors.push(error);
        }
      }
    },
    subscribe(listener: () => void) {
      const wasEmpty = listeners.size === 0;
      listeners.add(listener);
      if (wasEmpty) watching?.onFirst();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) watching?.onLast();
      };
    },
  };
}

/** One command without an answer: what callers see of it, and what only the connection needs. */
interface Entry {
  /** A new object whenever a member changes. */
  view: PendingCommand;
  /** Built once, at the press. Every send hands over this text and no other. */
  text: string;
  /** The session the page was in at the press, or null before any frame. */
  session: string | null;
  promise: Promise<CommandOutcome>;
  settle: (outcome: CommandOutcome) => void;
}

const NOTHING_PENDING: readonly PendingCommand[] = [];

function outcomeOf(receipt: Receipt): CommandOutcome {
  return receipt.outcome === 'accepted' ? { outcome: 'accepted', receipt } : { outcome: 'rejected', receipt };
}

/** Whether the phase is one in which data is thought to be arriving. */
function expectsData(phase: ConnectionPhase): boolean {
  return phase === 'live' || phase === 'resumed';
}

export const createConnection: CreateConnection = (options) => {
  const { seam } = options;
  // The feed takes the seam's clock, so `receivedAt` and the age of the data
  // are readings of one clock.
  const feed = createSocketFeed(seam, options.sessionKey, options.board);

  /** How many listeners `state` has. The stale check only runs while there are any. */
  let watchers = 0;
  let cancelStaleCheck: (() => void) | null = null;

  const state = createSlice<ConnectionState>(
    {
      phase: 'connecting',
      attempt: 0,
      retryAt: null,
      lastMessageAt: null,
      gameGone: false,
      serverFull: false,
    },
    {
      onFirst() {
        watchers = 1;
        // Whatever went stale while nobody watched is simply so by now.
        settleStaleness();
        bookStaleCheck();
      },
      onLast() {
        watchers = 0;
        callOffStaleCheck();
      },
    },
  );
  const pending = createSlice<readonly PendingCommand[]>(NOTHING_PENDING);

  /** Oldest first: a Map keeps the order things were put in. */
  const entries = new Map<string, Entry>();
  /** True from a drop until the first frame on a later socket. */
  let droppedSinceFrame = false;
  /** The session the last frame named; null before any, and once that game is known to be over or gone. */
  let session: string | null = null;
  /** What went wrong inside a handler, thrown once everyone has been told. */
  let raised: unknown[] = [];

  function next(changes: Partial<ConnectionState>): ConnectionState | null {
    const held = state.get();
    const made = { ...held, ...changes };
    const same =
      made.phase === held.phase &&
      made.attempt === held.attempt &&
      made.retryAt === held.retryAt &&
      made.lastMessageAt === held.lastMessageAt &&
      made.gameGone === held.gameGone &&
      made.serverFull === held.serverFull;
    return same ? null : made;
  }

  /** Lay `changes` over the snapshot, keeping the same object when no member differs. */
  function change(changes: Partial<ConnectionState>): void {
    const made = next(changes);
    if (made !== null) state.set(made);
  }

  function flush(): void {
    const errors = raised;
    raised = [];
    state.flush(errors);
    pending.flush(errors);
    throwAll(errors);
  }

  // ---------------------------------------------------------------- staleness

  /**
   * While somebody watches `state`, one check is booked after each message
   * and the one before it is called off. While nobody does, no wait is asked
   * of the seam at all, and `state.get()` works the answer out on the spot:
   * a reader who only ever asks still gets an honest phase.
   */
  function callOffStaleCheck(): void {
    cancelStaleCheck?.();
    cancelStaleCheck = null;
  }

  function staleBy(): number | null {
    const { phase, lastMessageAt } = state.get();
    if (!expectsData(phase) || lastMessageAt === null) return null;
    return STALE_AFTER_MS - (seam.now() - lastMessageAt);
  }

  /** For a reader nobody told: stale by now is stale, and there is no one to tell. */
  function settleStaleness(): void {
    const left = staleBy();
    if (left === null || left > 0) return;
    const made = next({ phase: 'stale' });
    if (made !== null) state.replace(made);
  }

  function bookStaleCheck(): void {
    callOffStaleCheck();
    if (watchers === 0) return;
    const left = staleBy();
    if (left === null) return;
    if (left <= 0) {
      change({ phase: 'stale' });
      return;
    }
    cancelStaleCheck = seam.schedule(() => {
      cancelStaleCheck = null;
      // Run early, it changes nothing and books the rest of the wait.
      bookStaleCheck();
      flush();
    }, left);
  }

  function phaseNow(): ConnectionPhase {
    if (watchers === 0) settleStaleness();
    return state.get().phase;
  }

  // ---------------------------------------------------------------- commands

  /** A new list only when it differs: a view is a new object whenever it changes, so identity is enough. */
  function publishPending(): void {
    const held = pending.get();
    const made = [...entries.values()].map((entry) => entry.view);
    if (made.length === held.length && made.every((view, index) => view === held[index])) return;
    pending.set(made.length === 0 ? NOTHING_PENDING : made);
  }

  /** Hand the command's one text to the socket. True when an open socket took it. */
  function handOver(entry: Entry): boolean {
    if (!feed.sendText(entry.text)) return false;
    entry.view = { ...entry.view, status: 'sent', sends: entry.view.sends + 1 };
    return true;
  }

  function end(commandId: string, outcome: CommandOutcome): void {
    const entry = entries.get(commandId);
    if (entry === undefined) return;
    entries.delete(commandId);
    entry.settle(outcome);
  }

  /**
   * Every `sent` command becomes `checking`: nobody knows any longer whether
   * the server has it. Nothing is sent by this, and a reply or a receipt
   * settles a `checking` command exactly as it settles a `sent` one.
   */
  function doubtWhatWasSent(): void {
    for (const entry of entries.values()) {
      if (entry.view.status === 'sent') entry.view = { ...entry.view, status: 'checking' };
    }
  }

  function loseAll(): void {
    for (const commandId of [...entries.keys()]) end(commandId, { outcome: 'lost' });
  }

  function submit(command: Command): Promise<CommandOutcome> {
    const already = entries.get(command.commandId);
    if (already !== undefined) return already.promise;

    let settle: (outcome: CommandOutcome) => void = () => {};
    const promise = new Promise<CommandOutcome>((resolve) => {
      settle = resolve;
    });
    const entry: Entry = {
      // The caller's object is theirs to change; what was pressed is kept apart from it.
      view: { command: Object.freeze({ ...command }), status: 'checking', sentAt: seam.now(), sends: 0 },
      text: JSON.stringify(command),
      session,
      promise,
      settle,
    };
    entries.set(command.commandId, entry);
    // Anywhere but live it waits as `checking`: nobody knows whether a line
    // that is down, silent or still settling would carry it.
    if (phaseNow() === 'live') handOver(entry);
    publishPending();
    try {
      flush();
    } catch {
      // `submit` never throws: a listener that failed has been told already,
      // and must not cost the caller the outcome of its command.
    }
    return promise;
  }

  function resend(commandId: string): void {
    const entry = entries.get(commandId);
    if (entry === undefined || phaseNow() !== 'live') return;
    if (handOver(entry)) publishPending();
    flush();
  }

  // ---------------------------------------------------------------- the feed's events

  function onStatus(status: FeedStatus): void {
    const retry = feed.retry();
    if (status === 'reconnecting') {
      droppedSinceFrame = true;
      callOffStaleCheck();
      // Nobody knows now whether the server has what was sent.
      doubtWhatWasSent();
      publishPending();
      change({ phase: 'reconnecting', attempt: retry.attempt, retryAt: retry.retryAt });
      return;
    }
    if (status === 'closed') {
      markClosed();
      return;
    }
    if (status === 'connecting') {
      // The first socket, or the first after the page closed the last one, is
      // `connecting`; one opened after a drop is an attempt under way.
      change({ phase: droppedSinceFrame ? 'reconnecting' : 'connecting', retryAt: null });
      return;
    }
    // An open socket is not a working line yet: only a frame says the server
    // is there, so `live` from the feed changes nothing here.
  }

  function markClosed(): void {
    droppedSinceFrame = false;
    session = null;
    callOffStaleCheck();
    loseAll();
    publishPending();
    change({ phase: 'closed', attempt: 0, retryAt: null });
  }

  function onFrame(frame: Frame, receivedAt: number): void {
    const resuming = droppedSinceFrame;
    droppedSinceFrame = false;

    for (const receipt of frame.receipts) end(receipt.commandId, outcomeOf(receipt));

    // A command pressed in one game is never sent into another.
    for (const [commandId, entry] of [...entries]) {
      if (entry.session !== null && entry.session !== frame.session) end(commandId, { outcome: 'lost' });
    }
    // The feed forgets a game that is over; so does this.
    session = frame.clock.phase === 'final' ? null : frame.session;

    if (resuming) {
      // The first frame after a reconnect, and only that one: each command
      // still unanswered is asked about once.
      for (const entry of [...entries.values()]) {
        let again = false;
        try {
          // Called on the options it came with: whoever wrote the policy may have written it as a method.
          again = options.resendOnResume(entry.view, frame);
        } catch (error) {
          raised.push(error);
        }
        if (again) handOver(entry);
      }
    }

    publishPending();
    change({
      phase: resuming ? 'resumed' : 'live',
      attempt: 0,
      retryAt: null,
      lastMessageAt: receivedAt,
      serverFull: false,
    });
  }

  function onMessage(message: ServerMessage, receivedAt: number): void {
    if (message.t === 'error') {
      // An error is not data: nothing on screen got newer.
      if (message.code === 'serverFull') change({ serverFull: true });
      if (message.code === 'noSession') {
        session = null;
        loseAll();
        change({ gameGone: true });
      } else if (message.commandId !== undefined) {
        // The server refused the message itself: no receipt will ever come.
        end(message.commandId, { outcome: 'lost' });
      } else if (message.code === 'tooManyCommands') {
        // Refused for being one too many, before the server read it, so it
        // cannot say which message that was. Any `sent` command may be the
        // one: left as `sent` it would wait for good for an answer that is
        // not coming, with no resend on offer. `checking` sends nothing by
        // itself and says honestly that nobody knows.
        doubtWhatWasSent();
      }
      publishPending();
      return;
    }

    if (message.t === 'reply') end(message.receipt.commandId, outcomeOf(message.receipt));

    const frame = frameOf(message);
    if (frame !== null) {
      onFrame(frame, receivedAt);
    } else {
      // A batch of quotes: newer data, and no news about where the line stands
      // until a frame has said the server is there.
      const { phase } = state.get();
      change({ lastMessageAt: receivedAt, phase: phase === 'connecting' || phase === 'reconnecting' ? phase : 'live' });
    }
    bookStaleCheck();
  }

  function onEvent(event: FeedEvent): void {
    if (event.type === 'status') onStatus(event.status);
    else onMessage(event.message, event.receivedAt);
    flush();
  }

  // First in, so first told: never removed.
  feed.subscribe(onEvent);

  return {
    connect: () => {
      feed.connect();
    },
    close: () => {
      // Done here and not only on the feed's word: a connection that was
      // never opened has no status to change, and its commands are lost too.
      markClosed();
      const errors: unknown[] = [];
      try {
        flush();
      } catch (error) {
        errors.push(error);
      }
      try {
        feed.close();
      } catch (error) {
        errors.push(error);
      }
      throwAll(errors);
    },
    send: (message) => feed.send(message),
    simulateDrop: () => {
      feed.simulateDrop();
    },
    subscribe: (listener) => feed.subscribe(listener),
    state: {
      get: () => {
        if (watchers === 0) settleStaleness();
        return state.get();
      },
      subscribe: (listener) => state.subscribe(listener),
    },
    pending: {
      get: () => pending.get(),
      subscribe: (listener) => pending.subscribe(listener),
    },
    submit,
    resend,
    dismissGameGone: () => {
      change({ gameGone: false });
      flush();
    },
  };
};
