/**
 * What the service will hold, and how fast it will take on more.
 *
 * These are public-host guard numbers, not game balance: they exist because
 * the address is public and anyone at all can reach it. Each is named and
 * lives only here, so the answer to "how many?" is one file, and a test can
 * set a small one without the number appearing twice.
 */
export interface Limits {
  /**
   * Connections held at once, of any kind, greeted or not. The other limits
   * allow at most 300 sessions of 3 sockets, 900, and the rest is room for
   * sockets that are still saying hello. A connection costs tens of
   * kilobytes, so the ceiling here is a few tens of megabytes of the 512.
   */
  maxConnections: number;
  /**
   * Sessions held at once. Measured at 142 KB each: 300 is about 42 MB, some
   * 8% of the free instance's 512 MB.
   */
  maxSessions: number;
  /**
   * Sockets one session may have. A player may have a tab, a reload in
   * flight and a reconnect at the same moment; the fourth is refused and
   * nobody already connected is pushed off.
   */
  maxSocketsPerSession: number;
  /** How long a session is kept after its last socket left. A 15-minute game, plus slack. */
  sessionTtlMs: number;
  /** How often the housekeeping runs. Housekeeping, not a game timer. */
  sweepIntervalMs: number;
  /**
   * How long a connection may hold no session. The page says hello the moment
   * its socket opens, so ten seconds is generous even on a slow link.
   */
  helloDeadlineMs: number;
  /** How often the one shared check for that runs. Housekeeping cadence, not a guard number. */
  helloCheckIntervalMs: number;
  /**
   * New games the whole service will take on at once. Building a market
   * costs 2.8 ms of processor time (measured), so 70 arriving inside one
   * 200 ms sampling pass would starve the stream. Counted for the service,
   * not per address: a classroom behind one school address must not be shut
   * out, and behind a proxy the address is the proxy's anyway.
   */
  newSessionBurst: number;
  /** New games the budget recovers each second. */
  newSessionRefillPerSecond: number;
  /** Messages one socket may send inside the window. The page sends two in a whole game. */
  messagesPerWindow: number;
  messageWindowMs: number;
  /**
   * Sessions at a stress board size held at once. One of them prices
   * thousands of tickets on every sampling pass, so a handful is what a free
   * instance's share of a processor can carry. The next one is refused; an
   * ordinary player is never refused because of one.
   */
  maxStressSessions: number;
  /**
   * With the stress setting on, how often the whole picture is sent instead of
   * the tickets that changed. It is the way back into step for a client whose
   * last send was skipped, so it is a cadence and not a guard: the brief asks
   * for "a full frame every second or two", and this is the middle of that.
   * Five times a second is what the batches in between carry.
   */
  stressFullFrameMs: number;
}

export const LIMITS: Limits = {
  maxConnections: 1000,
  maxSessions: 300,
  maxSocketsPerSession: 3,
  sessionTtlMs: 1_800_000,
  sweepIntervalMs: 60_000,
  helloDeadlineMs: 10_000,
  helloCheckIntervalMs: 1_000,
  newSessionBurst: 30,
  newSessionRefillPerSecond: 3,
  messagesPerWindow: 20,
  messageWindowMs: 10_000,
  maxStressSessions: 3,
  stressFullFrameMs: 1_500,
};

/** A budget that holds a burst and recovers steadily. The time is given to it; it reads no clock. */
export interface TokenBucket {
  /** True when there was budget left, which this call then spends. */
  take(nowMs: number): boolean;
}

export function createTokenBucket(capacity: number, refillPerSecond: number): TokenBucket {
  let tokens = capacity;
  /** Null until the first call, so a bucket is full whenever it is first used. */
  let lastMs: number | null = null;

  return {
    take(nowMs) {
      const sinceMs = lastMs === null ? 0 : Math.max(0, nowMs - lastMs);
      lastMs = nowMs;
      tokens = Math.min(capacity, tokens + (sinceMs * refillPerSecond) / 1000);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/** A count that starts over once the window has passed. The time is given to it; it reads no clock. */
export interface WindowCounter {
  /** True when this hit is inside the limit, which it then counts against. */
  hit(nowMs: number): boolean;
}

export function createWindowCounter(limit: number, windowMs: number): WindowCounter {
  let windowStartMs: number | null = null;
  let count = 0;

  return {
    hit(nowMs) {
      if (windowStartMs === null || nowMs - windowStartMs >= windowMs) {
        windowStartMs = nowMs;
        count = 0;
      }
      if (count >= limit) return false;
      count += 1;
      return true;
    },
  };
}
