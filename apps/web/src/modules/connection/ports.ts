import type { Feed } from '@strike-desk/shared/feed';
import type { Command, Frame, Receipt } from '@strike-desk/shared/protocol';

/**
 * The connection, as the rest of the page sees it: a feed that also knows
 * how old its data is, what happened to every command it was given, and how
 * to carry on after the line drops. This file is its whole public interface;
 * there is no behaviour in it.
 *
 * Deliberately not here:
 *
 * - No resend policy. Whether an unanswered command goes out again by itself
 *   after a reconnect, or waits for the player to ask, is handed in as
 *   `resendOnResume`, because who triggers a resend is not this block's to
 *   decide. Either answer is one line where the game is assembled.
 * - Nothing about whether game time runs while the line is down. A reconnect
 *   takes the next frame, whatever step it holds.
 * - No rule for what to do after the server refuses a new game.
 *   `ConnectionState.serverFull` reports it and nothing more.
 * - No second transport. There is one, a WebSocket, behind `TransportSeam`.
 */

/** As much of a WebSocket as a connection uses, so a fake can stand in for one. */
export interface SocketLike {
  readyState: number;
  send(text: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void;
}

/** The part of `sessionStorage` a connection uses. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Everything the connection touches outside itself comes in through here,
 * so a test drives all of it by hand and no test waits for real time. All
 * six are required: a connection reads no global. The four functions are
 * plain functions, not methods: each may be passed on by itself.
 */
export interface TransportSeam {
  /** The address every socket is opened to. */
  url: string;
  createSocket: (url: string) => SocketLike;
  /** Null: the session is not remembered across a reload. */
  storage: SessionStore | null;
  /** Run `run` after `ms` milliseconds. Returns the cancel. */
  schedule: (run: () => void, ms: number) => () => void;
  /** A number from 0 up to, not including, 1: the jitter on a wait. */
  random: () => number;
  /**
   * Milliseconds on a clock that never goes back. The same clock the feed
   * stamps `receivedAt` with: staleness is the difference between the two, so
   * a connection that builds its feed must hand this on rather than let it
   * take a clock of its own.
   */
  now: () => number;
}

/** No message for this long means the prices shown are stale. */
export const STALE_AFTER_MS = 1500;

/**
 * Where the connection stands.
 *
 * - `connecting`: the first socket is opening and nothing has arrived.
 * - `live`: a message arrived less than `STALE_AFTER_MS` ago.
 * - `stale`: the socket is thought open but nothing has arrived for
 *   `STALE_AFTER_MS` or longer; the next message makes it live.
 * - `reconnecting`: the line dropped; an attempt is waiting or under way.
 * - `resumed`: the first frame after a reconnect has been taken and commands
 *   still unanswered are being settled; the next message makes it live.
 * - `closed`: the page closed the connection, or the server refused for good.
 *
 * A message, here, is data: a frame, a reply or a batch of quotes. An `error`
 * from the server puts nothing newer on screen, so it moves neither the phase
 * nor `lastMessageAt`.
 *
 * What a form or a status strip makes of each phase is stated once, here, and
 * is the function `lineStateOf`:
 *
 * | phase          | line      |
 * |----------------|-----------|
 * | `connecting`   | `offline` |
 * | `live`         | `live`    |
 * | `stale`        | `stale`   |
 * | `reconnecting` | `offline` |
 * | `resumed`      | `stale`   |
 * | `closed`       | `offline` |
 *
 * `resumed` is `stale` and not `live`: the numbers on screen are current, but
 * commands still unanswered are being settled and perhaps sent again, and a
 * new order must not race them. Buying opens again with the next message.
 */
export type ConnectionPhase = 'connecting' | 'live' | 'stale' | 'reconnecting' | 'resumed' | 'closed';

/**
 * One snapshot of the connection. A new object whenever a member changes,
 * the same object otherwise.
 *
 * Going `stale` is the one change no message causes. While `state` has a
 * listener, a check is booked on the seam after each message and the listener
 * is told when it turns. While it has none, nothing is booked, and `get()`
 * works the phase out from the clock when asked: a reader is never told
 * `live` about data that is 1,500 ms old.
 */
export interface ConnectionState {
  phase: ConnectionPhase;
  /** Reconnect attempts since the line last worked; 0 while it works. */
  attempt: number;
  /** When the next attempt is due on the seam's clock, or null when none is waiting. */
  retryAt: number | null;
  /** When the last message arrived on the seam's clock, or null before the first. */
  lastMessageAt: number | null;
  /**
   * The server said the game this page named no longer exists. Stays true
   * until `dismissGameGone()`.
   */
  gameGone: boolean;
  /** The server refused a new game. What to do then is not decided by this block. */
  serverFull: boolean;
}

/**
 * A value that changes over time, in the shape `useSyncExternalStore` wants:
 * a stable `subscribe`, and a snapshot that is the same object until it
 * changes.
 */
export interface ReadSlice<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/** A command that has gone out, or tried to, and has no answer yet. */
export interface PendingCommand {
  command: Command;
  /**
   * - `sent`: handed to a socket that is still the current one.
   * - `checking`: the line dropped, or never was up, before an answer came,
   *   so nobody knows yet whether the server has it.
   */
  status: 'sent' | 'checking';
  /** When it was first submitted, on the seam's clock. */
  sentAt: number;
  /** How many times the text has gone out. */
  sends: number;
}

/**
 * How a command ended. A rejected receipt carries the reason. `lost` means no
 * receipt will ever come: the game is gone, the page closed the connection,
 * or the server refused the message itself.
 */
export type CommandOutcome =
  | { outcome: 'accepted'; receipt: Receipt }
  | { outcome: 'rejected'; receipt: Receipt }
  | { outcome: 'lost' };

export interface Connection extends Feed {
  state: ReadSlice<ConnectionState>;
  /** Every command without an answer yet, oldest first. */
  pending: ReadSlice<readonly PendingCommand[]>;
  /**
   * Send a command and learn how it ended. What the order ticket relies on:
   *
   * - It never rejects.
   * - It settles when a reply names the command id, or when any later
   *   frame's receipts name it, or as `lost`.
   * - A command id submitted again while the first is pending returns the
   *   same outcome and sends nothing more.
   * - When the line drops every `sent` command becomes `checking`.
   * - On the first frame after a reconnect the receipts settle what they
   *   can, and for each command still pending `resendOnResume` decides
   *   whether it goes out again by itself.
   * - A resend always reuses the command id, which is what makes it safe:
   *   the server answers a repeated id with the first receipt. The text is
   *   built once, at the press, and every send hands over that same text.
   * - It goes out at once only while the phase is `live`. Submitted in any
   *   other phase it waits as `checking`, never sent, until a reconnect's
   *   first frame asks `resendOnResume` about it or the page calls `resend`.
   * - A command pressed in one game is never sent into another: when a frame
   *   names a different session, what was pending under the old one is `lost`.
   */
  submit(command: Command): Promise<CommandOutcome>;
  /**
   * Send a pending command again, with the same id, when live. Does nothing
   * for an unknown id.
   */
  resend(commandId: string): void;
  /** The player has seen that the game is gone: clear `gameGone`. */
  dismissGameGone(): void;
}

export interface ConnectionOptions {
  seam: TransportSeam;
  /**
   * The key the session id is kept under in the seam's storage. The block
   * holds no key of its own: whoever assembles a page hands its key in, so a
   * page that is not the game can never read or overwrite the game's session.
   */
  sessionKey: string;
  /**
   * Asked once per unanswered command on the first frame after a reconnect.
   * Returning false leaves the command `checking` until a frame settles it
   * or `resend` is called.
   */
  resendOnResume(pending: PendingCommand, frame: Frame): boolean;
}

export type CreateConnection = (options: ConnectionOptions) => Connection;
