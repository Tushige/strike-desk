import { useSyncExternalStore } from 'react';
import type { CompanyView } from '@strike-desk/shared/protocol';
import { store } from '../boot';
import type { RowSource } from '../modules/live-grid/index';
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
 * through `boardRowSource`, whose sink is not React's to redraw.
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
const latestBoardRows = (): readonly ContractRow[] => store.currentRows();

/** The sink the table last registered, so that an older table's stop cannot silence a newer one. */
let boardSink: ((changed: readonly ContractRow[]) => void) | null = null;

/**
 * The store, as the contract table reads it. `rows` is today's whole row set,
 * which changes once a day and carries the prices the board was built with;
 * the ones moving now arrive at the sink, and `latest` has the newest row for
 * every ticket. Made once, because the table compares what it is given by
 * identity.
 */
export const boardRowSource: RowSource<ContractRow> = {
  rows: snapshotBoardRows,
  subscribe: subscribeBoardRows,
  latest: latestBoardRows,
  onChanged(sink) {
    boardSink = sink;
    store.setRowSink(sink);
    return () => {
      if (boardSink !== sink) return;
      boardSink = null;
      store.setRowSink(null);
    };
  },
};
