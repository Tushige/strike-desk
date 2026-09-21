/**
 * The wanted contract count, read from the page's own address.
 *
 * This file holds no list of sizes and no maximum: which sizes are granted is
 * the service's policy, so the page asks for whatever the address says and
 * lets the answer come back. One allow-list in the system means a page and a
 * server can never disagree about it; the cost is one extra round trip when
 * the answer is no.
 *
 * No browser global is named here — the caller passes the text — so this is
 * plain, testable string work.
 */

/** Digits only: `2500.5`, `1e3`, `-5` and ` 2500` are all not a whole number. */
const WHOLE_NUMBER = /^[0-9]+$/;

export function boardFromSearch(search: string): number | null {
  const first = new URLSearchParams(search).get('board');
  if (first === null || !WHOLE_NUMBER.test(first)) return null;
  const size = Number(first);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}
