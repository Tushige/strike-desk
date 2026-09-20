import type { Session } from '@strike-desk/shared/engine';
import { CONTENT_VERSION, ENGINE_VERSION, createSession } from '@strike-desk/shared/engine';
import type { Limits } from './limits';
import type { FrameSocket } from './sampler';

/**
 * Every live game, in memory. A session is made only when a hello asks for
 * one: no HTTP request and no bare socket connection costs a market build.
 * The service holds only so many, each holds only so many sockets, and one
 * that nobody has been connected to for the whole time-to-live is freed.
 */

export interface SessionEntry {
  /** Replaced, never mutated, after a command or a sample. */
  session: Session;
  sockets: Set<FrameSocket>;
  /**
   * The clock reading this session has had no socket since: when it was made,
   * or when its last socket left. Null exactly while a socket is attached.
   */
  idleSinceMs: number | null;
}

/** Why a socket was not attached. Both refusals leave what is already there alone. */
export type AttachResult = 'attached' | 'noSession' | 'tooManySockets';

export interface SessionRegistry {
  /** A new session on a freshly drawn seed and id, or null when the service already holds as many as it may. */
  create(nowMs: number): SessionEntry | null;
  get(id: string): SessionEntry | undefined;
  attach(id: string, socket: FrameSocket): AttachResult;
  detach(id: string, socket: FrameSocket, nowMs: number): void;
  replace(id: string, session: Session): void;
  entries(): IterableIterator<SessionEntry>;
  /** Frees every session that has had no socket for the whole time-to-live. A session with a socket is never freed. */
  sweepOnce(nowMs: number): void;
  readonly size: number;
}

export interface RegistryOptions {
  drawSeed: () => number;
  drawId: () => string;
  limits: Limits;
}

export function createRegistry(options: RegistryOptions): SessionRegistry {
  const sessions = new Map<string, SessionEntry>();
  const { maxSessions, maxSocketsPerSession, sessionTtlMs } = options.limits;

  return {
    create(nowMs) {
      if (sessions.size >= maxSessions) return null;
      const id = options.drawId();
      if (sessions.has(id)) throw new Error('a drawn session id is already in use');
      const identity = { seed: options.drawSeed(), engine: ENGINE_VERSION, content: CONTENT_VERSION };
      // A session nobody ever connects to is idle from the moment it is made,
      // so an abandoned one is swept on the same rule as any other.
      const entry: SessionEntry = { session: createSession(id, identity), sockets: new Set(), idleSinceMs: nowMs };
      sessions.set(id, entry);
      return entry;
    },
    get: (id) => sessions.get(id),
    attach(id, socket) {
      const entry = sessions.get(id);
      if (entry === undefined) return 'noSession';
      if (!entry.sockets.has(socket) && entry.sockets.size >= maxSocketsPerSession) return 'tooManySockets';
      entry.sockets.add(socket);
      entry.idleSinceMs = null;
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
  };
}
