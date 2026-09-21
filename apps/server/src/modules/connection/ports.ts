/**
 * The server's half of the connection: who may sit on a session. This file
 * is the whole public interface; there is no behaviour in it.
 *
 * The rule. One session may hold several sockets at once. A reconnect
 * usually arrives before the server has noticed that the old socket is dead,
 * and a second tab is allowed, so a newcomer is seated beside whoever is
 * there. Never "the newest wins and the old one is closed": two tabs would
 * throw each other out for ever. Past the limit the newcomer is refused and
 * nobody seated is disturbed. Every socket of a session is sent the same
 * frames.
 *
 * The same command arriving on two sockets is applied once. That half of the
 * rule belongs to the command path (a repeated command id returns the first
 * receipt) and is tested there.
 */

/** What became of a socket that asked for a seat. Both refusals leave what is already there alone. */
export type SeatResult = 'attached' | 'noSession' | 'tooManySockets';

/**
 * Whatever holds a session's sockets. Generic over the socket type because
 * that is free; nothing else is.
 */
export interface SessionSeats<Socket> {
  /**
   * Seat a socket on a session as one of its players. A socket already
   * seated stays where it is and takes no second seat.
   */
  attach(sessionId: string, playerId: string, socket: Socket): SeatResult;
  /** Free a socket's seat. Does nothing for a socket that has none. */
  detach(sessionId: string, socket: Socket, nowMs: number): void;
}

/** The fewest sockets a session must be able to hold: the old one and its reconnect. */
export const MIN_SOCKETS_PER_SESSION = 2;
