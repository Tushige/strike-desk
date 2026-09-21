import type { Command, DraftRequest, Reply, Session } from '@strike-desk/shared/engine';

/**
 * The command path: what becomes of one command from one player. This file
 * is the whole public interface; there is no behaviour in it.
 *
 * It is one function from a session, a player, a command, a clock reading
 * and the connection's draft to the next session and a reply. No socket, no
 * timer and no clock is behind it, so the same inputs always give the same
 * answer and a recorded game can be played again through it.
 *
 * What any implementation obeys:
 *
 * - Pure and synchronous. It reads no clock and changes nothing it was
 *   handed. Nothing is awaited between looking a command id up and storing
 *   its receipt: the two are one step, so the same command arriving on two
 *   sockets cannot be applied twice.
 * - The step decides. The logical step that `nowMs` falls in decides
 *   everything, the bell rule included: a buy at or after the closing-bell
 *   step is refused `marketClosed`; a cash-out at or after it settles at the
 *   bell value. Nothing the message claims about time is read.
 * - The id decides. A command id that was answered before returns the first
 *   receipt and changes nothing, whatever else the message now says.
 * - Every outcome is explicit. Every schema-valid command gets a receipt:
 *   accepted, or rejected with a reason. Never an exception, never silence.
 * - The fill is the server's price. A buy fills at the server's own price
 *   when that is within the tolerance of the price the player saw (2% or $1,
 *   whichever is larger), and is refused `priceMoved` otherwise. The price
 *   claimed only gates acceptance; it is never the price paid.
 * - Every accepted command is in the player's log, with the step it arrived
 *   at, and moves the player's revision. A repeat does neither.
 *
 * What this interface deliberately does not say:
 *
 * - Whether a refused command moves the revision, and whether a refused
 *   command is logged. Both are open product decisions; either answer fits
 *   behind this interface, and its contract asserts neither.
 * - How many receipts or log entries are kept.
 * - Rate limits, payload bounds and parsing. Those belong to the door, which
 *   hands over a command only once the shared schema has accepted it.
 * - The `draft` message. It is not a command: it has no id, gets no receipt
 *   and changes nothing. The door keeps the latest one per connection and
 *   passes it in here, so that the reply's frame can quote it.
 */

/** Everything the path needs to decide one command. */
export interface HandleInput {
  /** The session as it stands. Left exactly as it was. */
  session: Session;
  /** Who sent the command. Set by the server from the connection, never taken from a message. */
  playerId: string;
  /** Already parsed by the shared schema. */
  command: Command;
  /** The server's clock reading on receipt. The function reads no clock itself. */
  nowMs: number;
  /**
   * What the ticket form of the connection that sent the command is showing,
   * or null when it shows nothing. It changes no outcome; it only lets the
   * reply's frame carry that connection's quote.
   */
  draft: DraftRequest | null;
}

/** What came of it. */
export interface Handled {
  /** The session after the command, settled up to `nowMs`. The same game as before when the command was a repeat. */
  session: Session;
  /**
   * The receipt, and a fresh full frame with today's price history, for the
   * player who sent the command, projected after the command. It answers one
   * connection: a frame that quotes a draft belongs to the connection that
   * asked for the quote and is not the player's frame for any other socket.
   */
  reply: Reply;
  /** True when this command id had been answered before: nothing changed. */
  repeat: boolean;
}

/** The command path. */
export type HandleCommand = (input: HandleInput) => Handled;
