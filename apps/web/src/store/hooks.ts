import { useSyncExternalStore } from 'react';
import type { CompanyView, Frame } from '@strike-desk/shared/protocol';
import { connection, store } from '../boot';
import type { ConnectionState, PendingCommand } from '../modules/connection/index';
import type { RowSource } from '../modules/live-grid/index';
import type { ContractRow } from './contractRows';
import type { PriceSeries } from './gameStore';

/**
 * The only file under `store/` that imports React, and the one place the
 * screens meet `boot.ts` — which is what makes the one store and the one
 * connection load once per page load, however many times a component mounts.
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

const seriesSubscribers = new Map<number, (listener: () => void) => () => void>();
const seriesSnapshots = new Map<number, () => PriceSeries>();

/** One company's chart series: yesterday's tail and today's prices so far, in cents. */
export function useSeries(companyId: number): PriceSeries {
  let subscribe = seriesSubscribers.get(companyId);
  if (subscribe === undefined) {
    subscribe = (listener: () => void): (() => void) => store.series(companyId).subscribe(listener);
    seriesSubscribers.set(companyId, subscribe);
  }
  let snapshot = seriesSnapshots.get(companyId);
  if (snapshot === undefined) {
    snapshot = (): PriceSeries => store.series(companyId).get();
    seriesSnapshots.set(companyId, snapshot);
  }
  return useSyncExternalStore(subscribe, snapshot);
}

const subscribeFrame = (listener: () => void): (() => void) => store.frame.subscribe(listener);
const snapshotFrame = (): Frame | null => store.frame.get();

/**
 * The whole latest picture: the clock, the account, the open ticket, the
 * news, today's results. A component that calls this redraws whenever a
 * new frame lands (five times a second while the market is open), which is
 * exactly what the desk wants; something that needs only one price reads
 * `usePrice` instead.
 */
export function useFrame(): Frame | null {
  return useSyncExternalStore(subscribeFrame, snapshotFrame);
}

const subscribeCompanies = (listener: () => void): (() => void) => store.companies.subscribe(listener);
const snapshotCompanies = (): readonly CompanyView[] => store.companies.get();

/** The companies' names and tickers, by company id; empty before the first frame. */
export function useCompanies(): readonly CompanyView[] {
  return useSyncExternalStore(subscribeCompanies, snapshotCompanies);
}

const subscribeConnection = (listener: () => void): (() => void) => connection.state.subscribe(listener);
const snapshotConnection = (): ConnectionState => connection.state.get();

/** Where the connection stands: live, stale, reconnecting, and so on. */
export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribeConnection, snapshotConnection);
}

const subscribePending = (listener: () => void): (() => void) => connection.pending.subscribe(listener);
const snapshotPending = (): readonly PendingCommand[] => connection.pending.get();

/** Every command without an answer yet, oldest first. */
export function usePendingCommands(): readonly PendingCommand[] {
  return useSyncExternalStore(subscribePending, snapshotPending);
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
