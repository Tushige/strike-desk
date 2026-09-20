import type { Session } from '@strike-desk/shared/engine';
import { CONTENT_VERSION, ENGINE_VERSION, createSession } from '@strike-desk/shared/engine';
import type { FrameSocket } from './sampler';

/**
 * Every live game, in memory. A session is made only when a hello asks for
 * one: no HTTP request and no bare socket connection costs a market build.
 */

export interface SessionEntry {
  /** Replaced, never mutated, after a command or a sample. */
  session: Session;
  sockets: Set<FrameSocket>;
  /** When the last socket left, on the clock the caller passes in. Null while one is attached or none ever was. */
  lastSocketClosedMs: number | null;
}

export interface SessionRegistry {
  /** A new session on a freshly drawn seed and id. */
  create(): SessionEntry;
  get(id: string): SessionEntry | undefined;
  /** False when there is no such session. */
  attach(id: string, socket: FrameSocket): boolean;
  detach(id: string, socket: FrameSocket, nowMs: number): void;
  replace(id: string, session: Session): void;
  entries(): IterableIterator<SessionEntry>;
  readonly size: number;
}

export interface RegistryOptions {
  drawSeed: () => number;
  drawId: () => string;
}

export function createRegistry(options: RegistryOptions): SessionRegistry {
  const sessions = new Map<string, SessionEntry>();

  return {
    create() {
      const id = options.drawId();
      if (sessions.has(id)) throw new Error('a drawn session id is already in use');
      const identity = { seed: options.drawSeed(), engine: ENGINE_VERSION, content: CONTENT_VERSION };
      const entry: SessionEntry = { session: createSession(id, identity), sockets: new Set(), lastSocketClosedMs: null };
      sessions.set(id, entry);
      return entry;
    },
    get: (id) => sessions.get(id),
    attach(id, socket) {
      const entry = sessions.get(id);
      if (entry === undefined) return false;
      entry.sockets.add(socket);
      entry.lastSocketClosedMs = null;
      return true;
    },
    detach(id, socket, nowMs) {
      const entry = sessions.get(id);
      if (entry === undefined || !entry.sockets.delete(socket)) return;
      if (entry.sockets.size === 0) entry.lastSocketClosedMs = nowMs;
    },
    replace(id, session) {
      const entry = sessions.get(id);
      if (entry !== undefined) entry.session = session;
    },
    entries: () => sessions.values(),
    get size() {
      return sessions.size;
    },
  };
}
