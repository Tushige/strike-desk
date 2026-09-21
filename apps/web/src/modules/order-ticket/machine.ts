import type { BuyCommand, CashOutCommand, RejectReason } from '@strike-desk/shared/protocol';
import type { LineState, OpenTicket, SubmitOutcome, TicketAccount, TicketContract, TicketFormState, TicketQuote, WhatIfStop } from './ports';

/**
 * The order ticket's rules, with no React and no page in them: the form's
 * state machine, the rule that says when a buy may be pressed, the two
 * command builders, and the whole of a press. The component draws what these
 * say and sends what these build; it decides nothing.
 *
 * Nothing here adds, multiplies or rounds a money value. Numbers are looked
 * up, compared and passed on.
 */

/** The two commands the form can send. */
export type CommandKind = 'buy' | 'cashOut';

/**
 * What the form has to tell the player about the last command. It outlives
 * the state it was born in: a reason is still on screen after the form is
 * back in `draft`, until the next press or the next change.
 */
export type TicketNotice =
  | { kind: 'accepted'; of: CommandKind }
  /** `reason` is null when the server gave none. */
  | { kind: 'rejected'; of: CommandKind; reason: RejectReason | null }
  /** No answer will ever come for that command. */
  | { kind: 'lost' };

export interface TicketState {
  form: TicketFormState;
  /** The command in flight, or the one just answered. Null in `draft`. `day` is the day it was pressed on. */
  command: { id: string; kind: CommandKind; day: number } | null;
  notice: TicketNotice | null;
  /** The chosen fields. Only the desk's selection and the player's own press change them; a price update never does. */
  contractId: number | null;
  spendCents: number | null;
  /** The last day the form was told about. */
  day: number;
  /** Whether today's ticket is held, as last told. */
  held: boolean;
}

/** The current values of everything the rules read. Taken at the moment of asking, never kept. */
export interface TicketSnapshot {
  day: number;
  contract: TicketContract | null;
  quote: TicketQuote | null;
  account: TicketAccount;
  position: OpenTicket | null;
  line: LineState;
}

export type TicketEvent =
  /** The desk selected another contract, or none. */
  | { type: 'contract'; contractId: number | null }
  /** The player chose a spend. */
  | { type: 'spend'; spendCents: number | null }
  /** A press that was allowed: the command with this id is on its way. */
  | { type: 'pressed'; commandId: string; kind: CommandKind }
  | { type: 'outcome'; commandId: string; outcome: SubmitOutcome }
  /** The line to the server changed. */
  | { type: 'line'; line: LineState }
  /** The server's quote changed, or went away. */
  | { type: 'quote'; quote: TicketQuote | null }
  /** The open ticket arrived, was updated or went away. */
  | { type: 'position'; held: boolean }
  | { type: 'day'; day: number };

/** Why the buy button is off, most telling reason first; null when it is on. */
export type BuyBlocker =
  | 'notDraft'
  | 'stale'
  | 'offline'
  | 'noContract'
  | 'notOffered'
  | 'cannotBuy'
  | 'noSpend'
  | 'waitingForQuote'
  | 'tooCheap'
  | 'spendTooSmall'
  | 'overCap'
  | 'notEnoughCash';

/** An allowed press: the command to submit, and the event that moves the form to `pending`. */
export interface Press {
  command: BuyCommand | CashOutCommand;
  event: TicketEvent;
}

export function initialTicketState(seed: { day: number; contractId: number | null; spendCents: number | null; held: boolean }): TicketState {
  return { form: 'draft', command: null, notice: null, ...seed };
}

function backToDraft(state: TicketState, notice: TicketNotice | null): TicketState {
  return { ...state, form: 'draft', command: null, notice };
}

/**
 * The answer is in. `accepted` and `rejected` are states the form stays in
 * until the server's data moves it on (see the reducer). When that data is
 * already here, because the open ticket arrived before the answer did or the
 * day changed while the command was in flight, the form is back in `draft`
 * at once with the answer still on screen.
 */
function afterOutcome(state: TicketState, command: NonNullable<TicketState['command']>, outcome: SubmitOutcome): TicketState {
  if (outcome.outcome === 'lost') return backToDraft(state, { kind: 'lost' });
  if (outcome.outcome === 'rejected') {
    return { ...state, form: 'rejected', notice: { kind: 'rejected', of: command.kind, reason: outcome.receipt.reason ?? null } };
  }
  const notice: TicketNotice = { kind: 'accepted', of: command.kind };
  const alreadySettled = command.kind === 'buy' ? state.held : state.day !== command.day;
  return alreadySettled ? backToDraft(state, notice) : { ...state, form: 'accepted', notice };
}

/**
 * The way back to `draft` follows the server's data. There is no timer in
 * this machine and no press that only acknowledges: `rejected` ends when a
 * quote echoing the form arrives or the player changes the draft, `accepted`
 * ends when the open ticket arrives (a buy) or the day changes (a cash-out),
 * and a new day ends both. `pending` and `checking` end only with the answer.
 */
export function ticketReducer(state: TicketState, event: TicketEvent): TicketState {
  switch (event.type) {
    case 'contract':
      if (event.contractId === state.contractId) return state;
      return { ...(state.form === 'rejected' ? backToDraft(state, null) : state), contractId: event.contractId, notice: null };
    case 'spend':
      if (event.spendCents === state.spendCents) return state;
      return { ...(state.form === 'rejected' ? backToDraft(state, null) : state), spendCents: event.spendCents, notice: null };
    case 'pressed':
      // Only the press that leaves `draft` counts. Any other is not an event at all.
      if (state.form !== 'draft') return state;
      return { ...state, form: 'pending', command: { id: event.commandId, kind: event.kind, day: state.day }, notice: null };
    case 'outcome':
      if (state.command === null || state.command.id !== event.commandId) return state;
      if (state.form !== 'pending' && state.form !== 'checking') return state;
      return afterOutcome(state, state.command, event.outcome);
    case 'line':
      // Checking is latched: the line coming back does not end it, only the answer does.
      if (state.form !== 'pending' || event.line === 'live') return state;
      return { ...state, form: 'checking' };
    case 'quote':
      if (state.form !== 'rejected' || state.command?.kind !== 'buy' || !quoteEchoes(state, event.quote)) return state;
      return backToDraft(state, state.notice);
    case 'position': {
      if (state.form === 'accepted' && state.command?.kind === 'buy' && event.held) return { ...backToDraft(state, state.notice), held: true };
      // The open ticket's next update is to a cash-out what an echoing quote is to a buy.
      if (state.form === 'rejected' && state.command?.kind === 'cashOut') return { ...backToDraft(state, state.notice), held: event.held };
      return event.held === state.held ? state : { ...state, held: event.held };
    }
    case 'day': {
      if (event.day === state.day) return state;
      if (state.form === 'accepted' || state.form === 'rejected') return { ...backToDraft(state, null), day: event.day };
      // A command in flight is left alone; a notice in `draft` belongs to the day it was said on.
      return { ...state, day: event.day, notice: state.form === 'draft' ? null : state.notice };
    }
  }
}

/** True while the quote answers exactly what the form holds, so that a number from it may be shown and sent. */
export function quoteEchoes(state: TicketState, quote: TicketQuote | null): quote is TicketQuote {
  return quote !== null && quote.contractId === state.contractId && quote.spendCents === state.spendCents;
}

/**
 * Why the buy may not be pressed right now, or null when it may. Every check
 * compares two numbers the form was given; nothing is worked out.
 */
export function buyBlocker(state: TicketState, snapshot: TicketSnapshot): BuyBlocker | null {
  const { contract, quote, account, line } = snapshot;
  if (state.form !== 'draft') return 'notDraft';
  if (line !== 'live') return line;
  if (contract === null || contract.contractId !== state.contractId) return 'noContract';
  if (!contract.offered) return 'notOffered';
  if (!account.canBuy) return 'cannotBuy';
  if (state.spendCents === null) return 'noSpend';
  if (!quoteEchoes(state, quote)) return 'waitingForQuote';
  if (quote.priceCents < account.minTicketCents) return 'tooCheap';
  if (quote.quantity < 1) return 'spendTooSmall';
  if (state.spendCents > account.capCents) return 'overCap';
  if (state.spendCents > account.cashCents) return 'notEnoughCash';
  return null;
}

export function buyAllowed(state: TicketState, snapshot: TicketSnapshot): boolean {
  return buyBlocker(state, snapshot) === null;
}

/** Why the cash-out may not be pressed right now, or null when it may. */
export type CashOutBlocker = 'notDraft' | 'stale' | 'offline' | 'noTicket';

/** The cash-out obeys the same state rule as the buy: only from `draft`, only on a live line. */
export function cashOutBlocker(state: TicketState, snapshot: TicketSnapshot): CashOutBlocker | null {
  if (state.form !== 'draft') return 'notDraft';
  if (snapshot.line !== 'live') return snapshot.line;
  if (snapshot.position === null) return 'noTicket';
  return null;
}

/** The cash-out for the open ticket, or null while none is held. Its position id is all it carries. */
export function cashOutCommandOf(snapshot: TicketSnapshot, commandId: string): CashOutCommand | null {
  if (snapshot.position === null) return null;
  return { t: 'cashOut', commandId, positionId: snapshot.position.positionId };
}

/**
 * The what-if slider moves over the quote's stops by their place in the
 * list. Where it starts: on the stop at the break-even, or on the first stop
 * if the server sent none there.
 */
export function breakEvenStopIndex(quote: TicketQuote): number {
  const found = quote.whatIf.findIndex((stop) => stop.atCents === quote.breakEvenCents);
  return found === -1 ? 0 : found;
}

/** The stop at a place in the list, exactly as the server sent it, or null when there is none there. */
export function stopAt(quote: TicketQuote, index: number): WhatIfStop | null {
  return quote.whatIf[index] ?? null;
}

/** The retry control shows only for an unanswered command on a line that dropped, and only when the desk offers it. */
export function retryAllowed(state: TicketState, retryOffered: boolean): boolean {
  return retryOffered && state.form === 'checking';
}

/**
 * The buy for what the form holds, or null while the quote does not echo it.
 * The price seen is the quote's own; no number comes from anywhere else.
 */
export function buyCommandOf(state: TicketState, snapshot: TicketSnapshot, commandId: string): BuyCommand | null {
  const { contract, quote } = snapshot;
  if (contract === null || state.contractId !== contract.contractId || state.spendCents === null) return null;
  if (!quoteEchoes(state, quote)) return null;
  return { t: 'buy', commandId, day: snapshot.day, contractId: state.contractId, spendCents: state.spendCents, seenPriceCents: quote.priceCents };
}

/**
 * The whole of a press. When the press is allowed it takes one new id, builds
 * the command and returns it with the event that moves the form on; when it
 * is not, it returns null and asks for no id.
 */
export function pressOf(state: TicketState, snapshot: TicketSnapshot, newCommandId: () => string): Press | null {
  // While today's ticket is held the form is the cash-out form: it never builds a buy.
  const kind: CommandKind = snapshot.position === null ? 'buy' : 'cashOut';
  const blocked = kind === 'buy' ? buyBlocker(state, snapshot) : cashOutBlocker(state, snapshot);
  if (blocked !== null) return null;
  const commandId = newCommandId();
  const command = kind === 'buy' ? buyCommandOf(state, snapshot, commandId) : cashOutCommandOf(snapshot, commandId);
  // Not reachable: a press that is not blocked always has its command. Said for the compiler.
  if (command === null) return null;
  return { command, event: { type: 'pressed', commandId, kind } };
}
