import { describe, expect, it } from 'vitest';
import { MIN_SOCKETS_PER_SESSION } from '../../src/modules/connection/index';
import type { SessionSeats } from '../../src/modules/connection/index';

/**
 * What anything that holds a session's sockets must do. Every case builds a
 * fresh holder with one session in it.
 *
 * This file is not a test file by itself: a test file names the holder to
 * try and calls `describeSessionSeatsContract`.
 */

export interface SeatsRig<Socket> {
  seats: SessionSeats<Socket>;
  /** A session that exists. */
  sessionId: string;
  /** A player of that session. */
  playerId: string;
  /** How many sockets the session may hold. */
  limit: number;
  /** A socket nobody has seen before. */
  newSocket: () => Socket;
}

export function describeSessionSeatsContract<Socket>(name: string, make: () => SeatsRig<Socket>): void {
  /** A rig whose session is full: as many sockets seated as it may hold. */
  function full(): SeatsRig<Socket> & { sockets: Socket[] } {
    const rig = make();
    const sockets: Socket[] = [];
    for (let index = 0; index < rig.limit; index += 1) {
      const socket = rig.newSocket();
      expect(rig.seats.attach(rig.sessionId, rig.playerId, socket)).toBe('attached');
      sockets.push(socket);
    }
    return { ...rig, sockets };
  }

  describe(`the session seats contract: ${name}`, () => {
    it('holds at least two sockets per session', () => {
      expect(MIN_SOCKETS_PER_SESSION).toBe(2);
      expect(make().limit).toBeGreaterThanOrEqual(2);
    });

    it('seats a second socket beside the first', () => {
      const { seats, sessionId, playerId, newSocket } = make();

      expect(seats.attach(sessionId, playerId, newSocket())).toBe('attached');
      expect(seats.attach(sessionId, playerId, newSocket())).toBe('attached');
    });

    it('gives a socket attached twice one seat, not two', () => {
      const { seats, sessionId, playerId, limit, newSocket } = make();
      const socket = newSocket();

      expect(seats.attach(sessionId, playerId, socket)).toBe('attached');
      expect(seats.attach(sessionId, playerId, socket)).toBe('attached');

      for (let further = 0; further < limit - 1; further += 1) {
        expect(seats.attach(sessionId, playerId, newSocket())).toBe('attached');
      }
      expect(seats.attach(sessionId, playerId, newSocket())).toBe('tooManySockets');
    });

    it('refuses the newcomer past the limit and disturbs nobody seated', () => {
      const { seats, sessionId, playerId, sockets, newSocket } = full();

      expect(seats.attach(sessionId, playerId, newSocket())).toBe('tooManySockets');

      // Everybody seated still holds a seat: attaching again is not a newcomer.
      for (const socket of sockets) {
        expect(seats.attach(sessionId, playerId, socket)).toBe('attached');
      }
      // And each can leave and come back: exactly one seat was theirs.
      for (const socket of sockets) {
        seats.detach(sessionId, socket, 0);
        expect(seats.attach(sessionId, playerId, socket)).toBe('attached');
      }
      expect(seats.attach(sessionId, playerId, newSocket())).toBe('tooManySockets');
    });

    it('says so when the session does not exist', () => {
      const { seats, playerId, newSocket } = make();

      expect(seats.attach('no-such-session', playerId, newSocket())).toBe('noSession');
    });

    it('frees a seat when a socket leaves', () => {
      const { seats, sessionId, playerId, sockets, newSocket } = full();
      const leaving = sockets[0];
      if (leaving === undefined) throw new Error('the rig seated nobody');

      seats.detach(sessionId, leaving, 0);

      expect(seats.attach(sessionId, playerId, newSocket())).toBe('attached');
    });

    it('takes no harm from a socket leaving that was never seated', () => {
      const { seats, sessionId, playerId, newSocket } = full();

      seats.detach(sessionId, newSocket(), 0);
      seats.detach('no-such-session', newSocket(), 0);

      expect(seats.attach(sessionId, playerId, newSocket())).toBe('tooManySockets');
    });
  });
}
