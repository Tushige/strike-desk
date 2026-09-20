import { useSyncExternalStore } from 'react';
import { store } from '../boot';

/**
 * The only file under `store/` that imports React, and the only importer of
 * `boot.ts` — which is what makes the one store and the one feed load once
 * per page load, however many times a component mounts.
 *
 * React compares snapshots with `Object.is` and resubscribes whenever the
 * subscribe function changes identity, so both are made once per company
 * and kept here rather than rebuilt on every render.
 */

const subscribers = new Map<number, (listener: () => void) => () => void>();
const snapshots = new Map<number, () => number | null>();

function subscriberFor(companyId: number): (listener: () => void) => () => void {
  const already = subscribers.get(companyId);
  if (already !== undefined) return already;
  const made = (listener: () => void): (() => void) => store.price(companyId).subscribe(listener);
  subscribers.set(companyId, made);
  return made;
}

function snapshotFor(companyId: number): () => number | null {
  const already = snapshots.get(companyId);
  if (already !== undefined) return already;
  const made = (): number | null => store.price(companyId).get();
  snapshots.set(companyId, made);
  return made;
}

/** One company's share price in cents, or null before the first frame. */
export function usePrice(companyId: number): number | null {
  return useSyncExternalStore(subscriberFor(companyId), snapshotFor(companyId));
}
