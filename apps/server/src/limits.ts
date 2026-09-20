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
}

export const LIMITS: Limits = {
  maxSessions: 300,
  maxSocketsPerSession: 3,
  sessionTtlMs: 1_800_000,
  sweepIntervalMs: 60_000,
};
