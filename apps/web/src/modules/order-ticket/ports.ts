import type { BuyCommand, CashOutCommand, Receipt, Side } from '@strike-desk/shared/protocol';

/**
 * The order ticket: the one form that buys today's ticket and cashes it out.
 * This file is its whole public interface; there is no behaviour in it.
 *
 * The block is handed everything as props. The desk, where the game is
 * assembled, owns the selection, the connection and the server's numbers;
 * the block shows them, reports what the player chose, and sends a command
 * only when the player presses.
 *
 * The rules the block obeys:
 *
 * - Only an explicit press submits. Nothing is ever sent by a timer, by a
 *   price update or by a reconnect.
 * - A buy command is: `t` `buy`, the id from `newCommandId()`, `day`, the
 *   contract's id, the chosen spend, and `seenPriceCents` equal to the
 *   quote's `priceCents`. It is built only while the quote's `contractId`
 *   and `spendCents` equal the form's own, so the numbers sent are the
 *   numbers on screen.
 * - The buy button is off unless all of these hold: the form is in `draft`
 *   (a press while `pending` or `checking` does nothing, and `newCommandId()`
 *   is called only on the press that leaves `draft`), the line is live,
 *   `canBuy` is true, the contract is offered, the quote echoes the form,
 *   `quantity` is at least 1, the spend is at most `capCents` and at most
 *   `cashCents`, and the price is at least `minTicketCents`. Comparing is
 *   allowed; computing is not.
 * - The cash-out press obeys the same state rule: it submits only from
 *   `draft`, so a second press before the outcome arrives sends nothing and
 *   mints no second id.
 * - No arithmetic on cents exists anywhere in the block. Every number shown
 *   is a member of `quote`, `account` or `position`, or the player's own
 *   chosen spend. What a spend buys, what it costs, the break-even, the price
 *   limit and every what-if number are the server's.
 * - A price update never changes a chosen field: the contract and the spend
 *   stay what the player chose while the numbers around them move.
 * - Reject reasons arrive as codes (`Receipt.reason`). The words for them are
 *   the block's, taken from the game's glossary; this interface fixes none.
 *
 * What the block must not count on:
 *
 * - That a quote arrives for every draft it reports, or soon. `onDraftChange`
 *   reports a choice to the desk; when the desk tells the server, and how
 *   often, is the desk's business (a socket carries a limited number of
 *   messages, so the desk may hold changes back and send only the latest).
 *   The quote is refreshed when the server next sends one, which need not be
 *   with every price update. Until a quote echoes the form, the form shows no
 *   server number for it and the button stays off.
 *
 * Deliberately absent: the contract table and the chart (other blocks), the
 * company selection (the desk's), any resend policy (see `retryOffered`), and
 * any number the server did not send.
 */

/** A value that lives outside React, read with `useSyncExternalStore`. `get` returns the same object until the value changes. Both are plain functions and may be passed on by themselves. */
export interface ReadSlice<T> {
  get: () => T;
  /** Returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

/** The contract the desk has selected. Chosen fields: a price update never changes them. */
export interface TicketContract {
  /** Opaque to the block: it is sent back, never taken apart. */
  contractId: number;
  companyName: string;
  ticker: string;
  side: Side;
  targetCents: number;
  /** False when the board does not offer this side on this target: the form shows the contract and the buy button stays off. */
  offered: boolean;
}

/** One of the six simple ways to pick a contract: UP or DOWN, then Close, Far or Moonshot. */
export interface SimpleChoice {
  side: Side;
  choice: 'close' | 'far' | 'moonshot';
  contractId: number;
  targetCents: number;
}

/** One stop of the what-if: if the share price finishes exactly at `atCents` at the bell, the ticket makes `profitCents` (negative for a loss). */
export interface WhatIfStop {
  atCents: number;
  profitCents: number;
}

/**
 * The server's quote for the ticket being built. The block shows these
 * numbers and derives none.
 */
export interface TicketQuote {
  /** The draft this quote answers. The form shows a number from it only while both equal its own. */
  contractId: number;
  spendCents: number | null;
  /** The ticket price now, and the `seenPriceCents` of a buy built from this quote. */
  priceCents: number;
  /** Whole tickets the spend buys. 0 with no spend, or with a spend too small for one. */
  quantity: number;
  /** What the buy would cost, which is also the most the ticket can lose. */
  costCents: number;
  /** The highest price at which a buy that saw `priceCents` still fills. */
  limitPriceCents: number;
  breakEvenCents: number;
  /** The slider's stops, ascending by `atCents`. Empty while `quantity` is 0. The block looks a stop up; it multiplies nothing, and it does not count on how many there are. */
  whatIf: readonly WhatIfStop[];
}

/** What the form needs of the account. */
export interface TicketAccount {
  cashCents: number;
  /** The most that may be spent on today's ticket. */
  capCents: number;
  /** False when today's ticket is already bought, the market is closed, or the stress setting is on. */
  canBuy: boolean;
  /** The cheapest ticket price that can be bought. */
  minTicketCents: number;
}

/** Today's ticket once bought. The form then offers cash out. */
export interface OpenTicket {
  /** Goes into the cash-out command. */
  positionId: string;
  companyName: string;
  ticker: string;
  side: Side;
  targetCents: number;
  quantity: number;
  costCents: number;
  /** What it would sell for right now. */
  valueCents: number;
  profitCents: number;
  /** Per-ticket split of the current price. */
  realCents: number;
  hopeCents: number;
  breakEvenCents: number;
}

/**
 * What became of a submitted command. `lost` means no receipt will ever come:
 * the game is gone, the page closed the connection, or the server refused the
 * message itself, so it never became a command.
 *
 * After `lost` the form returns to `draft`, and the next press is a new
 * command with a new id. That is safe because the server never buys or pays
 * twice for the same day: a second buy comes back `alreadyBought`, and a
 * second cash-out comes back `alreadyClosed`, or, once the closing bell has
 * already sold the ticket, accepted for that same sale with the money paid
 * once. Only a command that is still unanswered is sent again, and that
 * resend keeps its own id.
 */
export type SubmitOutcome = { outcome: 'accepted'; receipt: Receipt } | { outcome: 'rejected'; receipt: Receipt } | { outcome: 'lost' };

/** The line to the server, as far as the form cares. Buying and cashing out need `live`. */
export type LineState = 'live' | 'stale' | 'offline';

/**
 * The form's one state machine, for buying and cashing out alike.
 *
 * - `draft`: until a press.
 * - `pending`: from the press until the outcome.
 * - `checking`: the line stopped being live before the outcome arrived. The
 *   form says it is checking and sends nothing by itself.
 * - `accepted` or `rejected`: the outcome is in. A rejected buy leaves the
 *   day's ticket still to be bought.
 *
 * A `lost` outcome returns to `draft`.
 *
 * The way back to `draft` follows the server's data. There is no timer and
 * no extra press:
 *
 * - `rejected` lasts until a quote that echoes the form arrives, or the
 *   player changes the contract or the spend, whichever comes first. The
 *   reason stays on screen as a notice until the next press or change, so
 *   one press tries again.
 * - `accepted` after a buy lasts until the open ticket arrives. The form is
 *   then the cash-out form, in `draft`.
 * - `accepted` after a cash-out lasts until the day changes.
 * - `lost` returns at once.
 * - A change of day returns `accepted` and `rejected` to `draft`, and leaves
 *   `pending` and `checking` alone.
 *
 * Two cases the list above leaves open are settled the same way, by the
 * server's data. When the data that would move the form on is already there
 * as the answer arrives, the form is in `draft` at once and the answer stays
 * on screen as a notice: that is the open ticket, for an accepted buy, and a
 * day that changed while the command was unanswered, for a buy or a cash-out,
 * accepted or rejected. A rejected cash-out has no quote to wait for: it
 * returns on the open ticket's next update, or when the day changes.
 */
export type TicketFormState = 'draft' | 'pending' | 'checking' | 'accepted' | 'rejected';

/** What the player has chosen so far, as reported to the desk. */
export interface TicketDraft {
  contractId: number | null;
  spendCents: number | null;
}

/** Everything the order ticket is given. Every callback is a plain function and may be passed on by itself. */
export interface OrderTicketProps {
  /** Today, 1 to 5. Goes into the buy command. */
  day: number;
  /** Null when nothing is selected. */
  contract: TicketContract | null;
  /** The selected company's three UP and three DOWN simple choices. Empty when no company is selected. */
  choices: readonly SimpleChoice[];
  /** The desk owns the selection; the block only reports a pick. */
  onPick: (contractId: number) => void;
  /** What the player may spend, in cents, ascending. Plain data from where the game is assembled. */
  spendChoices: readonly number[];
  quote: ReadSlice<TicketQuote | null>;
  account: ReadSlice<TicketAccount>;
  /** Today's ticket, or null while none is held. */
  position: ReadSlice<OpenTicket | null>;
  line: LineState;
  /**
   * When true, an unanswered command shows a way to send it again, and a
   * press on it calls `onRetry`. Whether the game ever offers that, or sends
   * again by itself, is decided where the game is assembled: the block is
   * the same either way. A retry reuses the command's id.
   */
  retryOffered: boolean;
  onRetry: () => void;
  /** Called whenever the contract or the chosen spend changes, so that the desk can have the server quote it. */
  onDraftChange: (draft: TicketDraft) => void;
  /**
   * Send a command. The promise resolves with the outcome and never rejects.
   * The same command id submitted again is the same command: it resolves to
   * the same outcome and is sent on as one.
   */
  submit: (command: BuyCommand | CashOutCommand) => Promise<SubmitOutcome>;
  /** A fresh command id. Called once, at the press; a retry reuses the id. */
  newCommandId: () => string;
}
