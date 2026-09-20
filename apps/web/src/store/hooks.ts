import { useSyncExternalStore } from 'react';
import type { CompanyView } from '@strike-desk/shared/protocol';
import { store } from '../boot';
import type { ContractRow } from './contractRows';

/**
 * The only file under `store/` that imports React, and the only importer of
 * `boot.ts` — which is what makes the one store and the one feed load once
 * per page load, however many times a component mounts.
 *
 * React compares snapshots with `Object.is` and resubscribes whenever the
 * subscribe function changes identity, so both are made once per company
 * and kept here rather than rebuilt on every render.
 *
 * The moving ticket prices deliberately have no hook: they reach the table
 * through `registerRowSink`, which is not React's to redraw.
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

const subscribeCompanies = (listener: () => void): (() => void) => store.companies.subscribe(listener);
const snapshotCompanies = (): readonly CompanyView[] => store.companies.get();

/** The companies' names and tickers, by company id; empty before the first frame. */
export function useCompanies(): readonly CompanyView[] {
  return useSyncExternalStore(subscribeCompanies, snapshotCompanies);
}

const subscribeBoardRows = (listener: () => void): (() => void) => store.boardRows.subscribe(listener);
const snapshotBoardRows = (): readonly ContractRow[] => store.boardRows.get();

/**
 * Today's whole row set, which changes once a day. It carries the prices the
 * board was built with, not the ones moving now: those arrive at the sink.
 */
export function useBoardRows(): readonly ContractRow[] {
  return useSyncExternalStore(subscribeBoardRows, snapshotBoardRows);
}

/**
 * Take the changed rows of every frame. Returns the call that stops it; one
 * listener at a time, and calling the stop twice is harmless.
 */
export function registerRowSink(sink: (rows: readonly ContractRow[]) => void): () => void {
  store.setRowSink(sink);
  let listening = true;
  return () => {
    if (!listening) return;
    listening = false;
    store.setRowSink(null);
  };
}

/** The latest row for every contract, in the default order. */
export function currentRows(): readonly ContractRow[] {
  return store.currentRows();
}
