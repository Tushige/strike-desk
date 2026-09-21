import type { CompanyView, DraftMessage, Frame, FrameOrder, QuotesMessage, ServerMessage } from '@strike-desk/shared/protocol';
import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { FeedStatus } from '@strike-desk/shared/feed';
import { applyQuoteChange, buildRows, changedRows } from './contractRows';
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
type RequestedDraft = Pick<DraftMessage, 'contractId' | 'spendCents'>;

export interface GameStore {
  ingest(message: ServerMessage): void;
  setStatus(status: FeedStatus): void;
  setRequestedDraft(draft: RequestedDraft): void;
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
 *
 * A short line, not the whole board: the session, the day, the size, the
 * company count, and each company's first and last target with its two
 * offered bounds. Stringifying the whole board instead would build a 20 KB
 * string on every frame, five times a second, at 2,508 rows — and would say
 * exactly what these few numbers already say, because the targets between
 * the first and the last are evenly spaced by construction.
 */
function boardSignatureOf(frame: Frame, board: NonNullable<Frame['board']>): string {
  const parts: (string | number)[] = [frame.session, frame.clock.day, board.targetsPerCompany, board.companies.length];
  for (const company of board.companies) {
    parts.push(company.targets[0] ?? 0, company.targets[company.targets.length - 1] ?? 0, company.lowestUpIndex, company.highestDownIndex);
  }
  return parts.join('|');
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
  /**
   * The three things a batch of changed quotes is read against, kept from the
   * frame last accepted. A batch carries none of them, so it has to be applied
   * against exactly the values that frame's rows were built with, and it is
   * only ever applied to that frame's day.
   */
  let heldDay = 0;
  let heldMinTicketCents = 0;
  let heldBuyable = false;
  let requested: RequestedDraft = { contractId: null, spendCents: null };

  function setRequestedDraft(draft: RequestedDraft): void {
    if (draft.contractId === requested.contractId && draft.spendCents === requested.spendCents) return;
    requested = { contractId: draft.contractId, spendCents: draft.spendCents };
    const changed: ContractRow[] = [];
    for (const id of rowOrder) {
      const row = rowsById[id];
      if (row === undefined || row.costCents === null) continue;
      const next = { ...row, costCents: null };
      rowsById[id] = next;
      changed.push(next);
    }
    if (changed.length > 0) rowSink?.(changed);
  }

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

    if (message.t === 'quotes') {
      ingestQuotes(message);
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
    if (held !== null && (held.session !== frame.session || heldDay !== frame.clock.day)) {
      requested = { contractId: null, spendCents: null };
    }
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

  /**
   * A batch of changed quotes: the stress setting's second message shape. It
   * is not the whole picture, so it may only be merged into the board this
   * store already holds — same session, same day, and no older than what is
   * held by the rule frames obey. Anything else is dropped, and the whole
   * frame the server sends every second or so is what puts the rows right.
   *
   * The day rule is the belt to the server's braces: the server sends a whole
   * frame first on every new day, but a batch and a frame can cross on the
   * wire, and a batch of yesterday applied to today's board would be wrong on
   * every row it touched.
   *
   * The revision rule is the same kind of belt. The server sends a whole frame
   * whenever the revision moves, but that one message can be skipped for a
   * socket with a send backlog. A batch carrying a revision this store never
   * saw a picture for would leave the ordering triple ahead of what is on
   * screen, which is the one thing the revision trigger exists to prevent.
   */
  function ingestQuotes(message: QuotesMessage): void {
    if (held === null || held.session !== message.session || message.rev !== held.rev || message.day !== heldDay || !isNewerFrame(held, message)) {
      counters.dropped += 1;
      return;
    }
    held = { session: message.session, rev: message.rev, step: message.step };
    counters.accepted += 1;

    for (let companyId = 0; companyId < companyCount; companyId += 1) {
      prices[companyId]?.set(message.prices[companyId] ?? null);
    }

    const changed: ContractRow[] = [];
    for (const change of message.changes) {
      const id = change[0];
      const row = rowsById[id];
      // A ticket this store holds no row for: the board it belongs to is not
      // the board on screen, so there is nothing to change.
      if (row === undefined) continue;
      const next = applyQuoteChange(row, change, { buyable: heldBuyable, minTicketCents: heldMinTicketCents });
      if (next === null) continue;
      rowsById[id] = next;
      changed.push(next);
    }
    if (changed.length === 0 || rowSink === null) return;
    rowSink(changed);
  }

  function ingestBoard(frame: Frame): void {
    heldDay = frame.clock.day;
    heldMinTicketCents = frame.minTicketCents;
    // Too cheap to trade is a statement about buying, so it applies only
    // while there is something to buy. From the closing bell on, a row
    // shows what it settled at, $0 included.
    heldBuyable = frame.clock.phase === 'preBell' || frame.clock.phase === 'open';
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
      // Both parts of every price travel with it: the page shows them and
      // works neither of them out.
      quoteReals: frame.quoteReals,
      quoteHopes: frame.quoteHopes,
      quoteBreakEvens: frame.quoteBreakEvens,
      ...(requested.spendCents !== null && frame.draft?.contractId === requested.contractId &&
        frame.draft.spendCents === requested.spendCents && frame.draft.costs !== undefined
        ? { costs: frame.draft.costs } : {}),
      minTicketCents: heldMinTicketCents,
      buyable: heldBuyable,
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
    setRequestedDraft,
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
