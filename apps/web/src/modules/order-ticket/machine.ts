import type { BuyCommand, CashOutCommand, RejectReason } from '@strike-desk/shared/protocol';
import type { LineState, OpenTicket, SubmitOutcome, TicketAccount, TicketContract, TicketFormState, TicketQuote } from './ports';

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
  | { type: 'outcome'; commandId: string; outcome: SubmitOutcome };

/** An allowed press: the command to submit, and the event that moves the form to `pending`. */
export interface Press {
  command: BuyCommand | CashOutCommand;
  event: TicketEvent;
}

export function initialTicketState(seed: { day: number; contractId: number | null; spendCents: number | null; held: boolean }): TicketState {
  return { form: 'draft', command: null, notice: null, ...seed };
}

function afterOutcome(state: TicketState, kind: CommandKind, outcome: SubmitOutcome): TicketState {
  if (outcome.outcome === 'lost') return { ...state, form: 'draft', command: null, notice: { kind: 'lost' } };
  if (outcome.outcome === 'rejected') {
    return { ...state, form: 'rejected', notice: { kind: 'rejected', of: kind, reason: outcome.receipt.reason ?? null } };
  }
  return { ...state, form: 'accepted', notice: { kind: 'accepted', of: kind } };
}

export function ticketReducer(state: TicketState, event: TicketEvent): TicketState {
  switch (event.type) {
    case 'contract':
      if (event.contractId === state.contractId) return state;
      return { ...state, contractId: event.contractId, notice: null };
    case 'spend':
      if (event.spendCents === state.spendCents) return state;
      return { ...state, spendCents: event.spendCents, notice: null };
    case 'pressed':
      // Only the press that leaves `draft` counts. Any other is not an event at all.
      if (state.form !== 'draft') return state;
      return { ...state, form: 'pending', command: { id: event.commandId, kind: event.kind, day: state.day }, notice: null };
    case 'outcome':
      if (state.command === null || state.command.id !== event.commandId) return state;
      if (state.form !== 'pending' && state.form !== 'checking') return state;
      return afterOutcome(state, state.command.kind, event.outcome);
  }
}

/** True while the quote answers exactly what the form holds, so that a number from it may be shown and sent. */
export function quoteEchoes(state: TicketState, quote: TicketQuote | null): quote is TicketQuote {
  return quote !== null && quote.contractId === state.contractId && quote.spendCents === state.spendCents;
}

export function buyAllowed(state: TicketState, snapshot: TicketSnapshot): boolean {
  return state.form === 'draft' && snapshot.line === 'live' && buyCommandOf(state, snapshot, '') !== null;
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
  if (!buyAllowed(state, snapshot)) return null;
  const commandId = newCommandId();
  const command = buyCommandOf(state, snapshot, commandId);
  if (command === null) return null;
  return { command, event: { type: 'pressed', commandId, kind: 'buy' } };
}
