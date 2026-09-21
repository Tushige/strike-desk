import type { Session } from '@strike-desk/shared/engine';
import { CONTENT_VERSION, DEFAULT_TARGETS_PER_COMPANY, ENGINE_VERSION, createSession, playerOf } from '@strike-desk/shared/engine';
import type { Limits } from './limits';
import type { FrameSocket } from './sampler';

/**
 * Every live game, in memory. A session is made only when a hello asks for
 * one: no HTTP request and no bare socket connection costs a market build.
 * The service holds only so many, each holds only so many sockets, and one
 * that nobody has been connected to for the whole time-to-live is freed.
 *
 * A session holds players, and a socket watches the session as one of them.
 * A session made here has exactly one player, and nothing adds another.
 */

/**
 * What a switched-on session last sent, so the next sampling pass can send the
 * difference. Held per session rather than per player because the ticket
 * prices are the session's: they come from the market, the day and the point
 * of the day's path, and not from whose game it is.
 *
 * `day`, `phase` and `rev` are here because a batch carries none of them, and
 * each is a thing the brief never lets a client miss: a frame is sent whole
 * whenever one of them moves.
 */
export interface StressStream {
  quotes: readonly number[];
  quoteReals: readonly number[];
  quoteHopes: readonly number[];
  quoteBreakEvens: readonly number[];
  day: number;
  phase: string;
  rev: number;
  /** The clock reading of the last whole frame, which is what the cadence is measured from. */
  lastWholeFrameMs: number;
}

export interface SessionEntry {
  /** Replaced, never mutated, after a command or a sample. */
  session: Session;
  /** Every socket on this session, with the id of the player it watches as. */
  sockets: Map<FrameSocket, string>;
  /**
   * The clock reading this session has had no socket since: when it was made,
   * or when its last socket left. Null exactly while a socket is attached.
   */
  idleSinceMs: number | null;
  /**
   * What this session last sent, with the stress setting on. Null for an
   * ordinary session, which always sends the whole picture, and null for a
   * switched-on one until its first sampling pass.
   */
  stressStream: StressStream | null;
}

/** Why a socket was not attached. Both refusals leave what is already there alone. */
export type AttachResult = 'attached' | 'noSession' | 'tooManySockets';

export interface SessionRegistry {
  /**
   * A new session on a freshly drawn seed and id, or null when the service
   * already holds as many as it may. `targetsPerCompany` is the stress board
   * size the door granted; left out, the game is built at the default size.
   */
  create(nowMs: number, targetsPerCompany?: number): SessionEntry | null;
  get(id: string): SessionEntry | undefined;
  /** Attach a socket as one of the session's players. Throws when the session has no such player. */
  attach(id: string, playerId: string, socket: FrameSocket): AttachResult;
  detach(id: string, socket: FrameSocket, nowMs: number): void;
  replace(id: string, session: Session): void;
  entries(): IterableIterator<SessionEntry>;
  /** Frees every session that has had no socket for the whole time-to-live. A session with a socket is never freed. */
  sweepOnce(nowMs: number): void;
  readonly size: number;
  /** Sessions held at a stress board size. Counted from the entries themselves, so it can never drift. */
  readonly stressCount: number;
}

export interface RegistryOptions {
  drawSeed: () => number;
  drawId: () => string;
  limits: Limits;
}

export function createRegistry(options: RegistryOptions): SessionRegistry {
  const sessions = new Map<string, SessionEntry>();
  const { maxSessions, maxSocketsPerSession, maxStressSessions, sessionTtlMs } = options.limits;

  /** Counted from the entries themselves: a counter kept alongside them could drift from them. */
  function countStress(): number {
    let count = 0;
    for (const entry of sessions.values()) {
      if (entry.session.game.stress) count += 1;
    }
    return count;
  }

  return {
    create(nowMs, targetsPerCompany) {
      if (sessions.size >= maxSessions) return null;
      // A stress session costs a multiple of an ordinary one on every
      // sampling pass, so it has a cap of its own. Refused here, which the
      // door already answers `serverFull`; nobody already playing is touched.
      const stress = targetsPerCompany !== undefined && targetsPerCompany !== DEFAULT_TARGETS_PER_COMPANY;
      if (stress && countStress() >= maxStressSessions) return null;
      const id = options.drawId();
      if (sessions.has(id)) throw new Error('a drawn session id is already in use');
      const identity = { seed: options.drawSeed(), engine: ENGINE_VERSION, content: CONTENT_VERSION };
      // A session nobody ever connects to is idle from the moment it is made,
      // so an abandoned one is swept on the same rule as any other.
      // The stream starts empty for every session: the sampler fills it, and
      // until it has, there is nothing to send a difference against, so the
      // first sampled message is the whole picture.
      const entry: SessionEntry = { session: createSession(id, identity, { targetsPerCompany }), sockets: new Map(), idleSinceMs: nowMs, stressStream: null };
      sessions.set(id, entry);
      return entry;
    },
    get: (id) => sessions.get(id),
    attach(id, playerId, socket) {
      const entry = sessions.get(id);
      if (entry === undefined) return 'noSession';
      if (!entry.sockets.has(socket) && entry.sockets.size >= maxSocketsPerSession) return 'tooManySockets';
      entry.sockets.set(socket, playerOf(entry.session.game, playerId).id);
      entry.idleSinceMs = null;
      // A socket that has just joined holds the frame the door answered its
      // hello with, projected at its own moment, and not what the sampler last
      // sent. Forgetting what was last sent makes the next pass send the whole
      // picture, which is the only message every socket on this session can
      // safely be given: they share one text, so the difference cannot be
      // right for the one that just arrived and for the ones already here.
      // One extra whole picture per hello, on a service holding at most a
      // handful of these games.
      entry.stressStream = null;
      return 'attached';
    },
    detach(id, socket, nowMs) {
      const entry = sessions.get(id);
      if (entry === undefined || !entry.sockets.delete(socket)) return;
      if (entry.sockets.size === 0) entry.idleSinceMs = nowMs;
    },
    replace(id, session) {
      const entry = sessions.get(id);
      if (entry !== undefined) entry.session = session;
    },
    entries: () => sessions.values(),
    sweepOnce(nowMs) {
      for (const [id, entry] of sessions) {
        if (entry.sockets.size > 0 || entry.idleSinceMs === null) continue;
        if (nowMs - entry.idleSinceMs >= sessionTtlMs) sessions.delete(id);
      }
    },
    get size() {
      return sessions.size;
    },
    get stressCount() {
      return countStress();
    },
  };
}
