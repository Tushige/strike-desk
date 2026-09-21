/**
 * Which board sizes this service will build, and how large a one a public
 * instance will build.
 *
 * This is service policy, in the spirit of `limits.ts`: nothing here crosses
 * the wire and nothing in `packages/shared` knows about it. The wire already
 * carries a wanted contract count on `hello`; what a service does with one is
 * its own business, so the answer to "which sizes?" is this one file.
 */

/**
 * A wanted contract count, as a person would type it, to targets a company.
 *
 * The sizes assume the six-company cast, so a count is six companies times
 * targets times two sides: 21 gives 252, 209 gives 2508 and 2084 gives 25008.
 * The key is therefore what a person types on the address, not the exact
 * count the board ends up with.
 */
export const BOARD_TARGETS_BY_SIZE: ReadonlyMap<number, number> = new Map([
  [252, 21],
  [2500, 209],
  [25000, 2084],
]);

/**
 * The largest size a public instance will build. The larger listed size
 * exists for a measurement run on a machine that is not the public host, and
 * is reached by starting an instance for it; the public host never sets it.
 */
export const PUBLIC_MAX_BOARD_SIZE = 2500;

export function isAllowedBoardSize(size: number): boolean {
  return BOARD_TARGETS_BY_SIZE.has(size);
}

export function targetsForBoardSize(size: number): number | null {
  return BOARD_TARGETS_BY_SIZE.get(size) ?? null;
}
