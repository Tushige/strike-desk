import type { CompanyView, Frame, FrameOrder, ServerMessage } from '@strike-desk/shared/protocol';
import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { FeedStatus } from '@strike-desk/shared/feed';
import { buildRows, changedRows } from './contractRows';
import type { ContractRow, RowInput } from './contractRows';

/**
 * Where the live data lives: outside React, one slice per thing the page
 * shows. This file imports no React.
 *
 * Two steps, and the difference between them matters. `isNewerFrame`
 * answers "may I accept this frame?" — it says yes to a frame equal to the
 * one held, because any frame is the whole picture. Whether anyone is told
 * is a separate question, answered slice by slice: a slice notifies only
 * when its own value changed. Without that, a stopped clock at five frames
 * a second would redraw the page five times a second for nothing.
 *
 * The 252 ticket prices follow the same rule but do not go through a slice:
 * redrawing the whole table five times a second is exactly what must not
 * happen. Each frame is compared with the rows held, and only the rows that
 * really changed go to the row sink the table registers. The full row set
 * changes once a day, and that one does go through a slice.
 *
 * Only the ordering triple is kept, never the frame itself.
 */

export interface Slice<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

interface WritableSlice<T> extends Slice<T> {
  set(next: T): void;
}

export type RowSink = (rows: readonly ContractRow[]) => void;

export interface GameStore {
  ingest(message: ServerMessage): void;
  setStatus(status: FeedStatus): void;
  price(companyId: number): Slice<number | null>;
  phase: Slice<string>;
  day: Slice<number>;
  status: Slice<FeedStatus>;
  sessionGone: Slice<boolean>;
  /** The companies' names and tickers, by company id, as the frame sends them. */
  companies: Slice<readonly CompanyView[]>;
  /** The whole row set of today's board: it changes once a day, not once a frame. */
  boardRows: Slice<readonly ContractRow[]>;
  /** Where the changed rows of every other frame go. Null means nobody is listening. */
  setRowSink(sink: RowSink | null): void;
  /** The latest row for every contract, in the default order. */
  currentRows(): readonly ContractRow[];
  counters: { accepted: number; dropped: number };
}

function createSlice<T>(initial: T): WritableSlice<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A reply carries the frame that answers a command. */
function frameOf(message: ServerMessage): Frame | null {
  if (message.t === 'frame') return message;
  if (message.t === 'reply') return message.frame;
  return null;
}

/** Names and tickers are the same list, or they are not: nothing in between. */
function sameCompanies(held: readonly CompanyView[], incoming: readonly CompanyView[]): boolean {
  if (held.length !== incoming.length) return false;
  for (let id = 0; id < held.length; id += 1) {
    const one = held[id];
    const two = incoming[id];
    if (one === undefined || two === undefined) return false;
    if (one.name !== two.name || one.ticker !== two.ticker) return false;
  }
  return true;
}

/**
 * What makes a frame's board a different board: another session, another
 * day, or targets that moved. The same text means the same rows, so the
 * table keeps the row set it has and only the prices move.
 */
function boardSignatureOf(frame: Frame, board: NonNullable<Frame['board']>): string {
  return `${frame.session}|${String(frame.clock.day)}|${JSON.stringify(board)}`;
}

/** One shared empty array, so repeated boardless frames tell nobody anything. */
const NO_ROWS: readonly ContractRow[] = [];
const NO_COMPANIES: readonly CompanyView[] = [];

export function createGameStore(companyCount = 6): GameStore {
  const prices = Array.from({ length: companyCount }, () => createSlice<number | null>(null));
  const phase = createSlice('');
  const day = createSlice(0);
  const status = createSlice<FeedStatus>('closed');
  const sessionGone = createSlice(false);
  const companies = createSlice<readonly CompanyView[]>(NO_COMPANIES);
  const boardRows = createSlice<readonly ContractRow[]>(NO_ROWS);
  const counters = { accepted: 0, dropped: 0 };
  let held: FrameOrder | null = null;
  let rowSink: RowSink | null = null;
  let rowsById: (ContractRow | undefined)[] = [];
  let rowOrder: number[] = [];
  let boardSignature = '';

  function price(companyId: number): Slice<number | null> {
    const slice = prices[companyId];
    if (slice === undefined) throw new Error(`no company ${String(companyId)}`);
    return slice;
  }

  function ingest(message: ServerMessage): void {
    if (message.t === 'error') {
      if (message.code === 'noSession') sessionGone.set(true);
      return;
    }

    const frame = frameOf(message);
    if (frame === null) return;

    if (!isNewerFrame(held, frame)) {
      counters.dropped += 1;
      return;
    }
    // A session we have not seen before is a game of its own: whatever was
    // said about the last one no longer applies.
    if (held !== null && held.session !== frame.session) sessionGone.set(false);
    held = { session: frame.session, rev: frame.rev, step: frame.step };
    counters.accepted += 1;

    phase.set(frame.clock.phase);
    day.set(frame.clock.day);
    for (let companyId = 0; companyId < companyCount; companyId += 1) {
      prices[companyId]?.set(frame.prices[companyId] ?? null);
    }
    if (!sameCompanies(companies.get(), frame.companies)) companies.set(frame.companies);
    ingestBoard(frame);
  }

  function ingestBoard(frame: Frame): void {
    const board = frame.board;
    if (board === null) {
      boardSignature = '';
      rowsById = [];
      rowOrder = [];
      boardRows.set(NO_ROWS);
      return;
    }

    const input: RowInput = {
      board,
      companies: frame.companies,
      quotes: frame.quotes,
      minTicketCents: frame.minTicketCents,
      // Too cheap to trade is a statement about buying, so it applies only
      // while there is something to buy. From the closing bell on, a row
      // shows what it settled at, $0 included.
      buyable: frame.clock.phase === 'preBell' || frame.clock.phase === 'open',
    };

    const signature = boardSignatureOf(frame, board);
    if (signature !== boardSignature) {
      boardSignature = signature;
      const rows = buildRows(input);
      rowsById = [];
      rowOrder = rows.map((row) => row.contractId);
      for (const row of rows) rowsById[row.contractId] = row;
      boardRows.set(rows);
      return;
    }

    const changed = changedRows(rowsById, input);
    if (changed.length === 0) return;
    for (const row of changed) rowsById[row.contractId] = row;
    if (rowSink !== null) rowSink(changed);
  }

  function setRowSink(sink: RowSink | null): void {
    rowSink = sink;
  }

  function currentRows(): readonly ContractRow[] {
    const rows: ContractRow[] = [];
    for (const id of rowOrder) {
      const row = rowsById[id];
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }

  function setStatus(next: FeedStatus): void {
    status.set(next);
  }

  return {
    ingest,
    setStatus,
    price,
    phase,
    day,
    status,
    sessionGone,
    companies,
    boardRows,
    setRowSink,
    currentRows,
    counters,
  };
}
