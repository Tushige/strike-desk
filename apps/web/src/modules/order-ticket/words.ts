import type { RejectReason, Side } from '@strike-desk/shared/protocol';
import type { BuyBlocker, CashOutBlocker } from './machine';
import type { SimpleChoice } from './ports';

/**
 * Every word of the order ticket that a player could read, in one place, so
 * that they can be read in one sitting and changed without touching the form.
 *
 * The game's word comes first and the grown-up word second, where the game
 * has both. No sentence here states a number: numbers are the server's, and
 * the form puts them beside these words.
 */

export const PANEL_TITLE = 'Your ticket';
export const OPEN_TICKET_TITLE = "Today's ticket";
export const NOTHING_PICKED = 'Pick a company, then pick a ticket.';
export const tradeContextWords = {
  draft: (company: string, ticketCompany: string): string => `Viewing ${company}. Your draft is for ${ticketCompany}.`,
  back: (ticketCompany: string): string => `Back to ${ticketCompany}`,
};

/** The game's word for each side, and the grown-up word for the same thing. */
export const SIDE_WORDS: Record<Side, { game: string; real: string }> = {
  up: { game: 'UP ticket', real: 'call option' },
  down: { game: 'DOWN ticket', real: 'put option' },
};

/** Said beside a side's three choices. */
export const SIDE_HINTS: Record<Side, string> = {
  up: 'Pays if the price ends above the target',
  down: 'Pays if the price ends below the target',
};

/** The side as one word, beside its three choices. */
export const SIDE_SHORT: Record<Side, string> = { up: 'UP', down: 'DOWN' };

export const TARGET_WORDS = { game: 'Target', real: 'strike price' };

export const CHOICES_LABEL = 'Pick a ticket';
export const CHOICE_WORDS: Record<SimpleChoice['choice'], string> = {
  close: 'Close',
  far: 'Far',
  moonshot: 'Moonshot',
};

export const SPEND_LABEL = 'How much to spend';

export const PRICE_LABEL = 'Ticket price';
export const QUANTITY_LABEL = 'Tickets';
export const COST_LABEL = 'Cost & most you can lose';
/** Followed by the break-even, which is the server's number. */
export const PROFIT_IF_WORDS: Record<Side, string> = {
  up: 'Profit at the bell if price is above',
  down: 'Profit at the bell if price is below',
};
/** Followed by the highest price at which the buy still goes through. The rule behind that number is the server's and is not said here. */
export const LIMIT_LABEL = 'Still buys if the price moves up to';
export const CASH_LABEL = 'Cash';
export const CAP_LABEL = 'Most you can spend today';

/** The what-if slider. Followed by the price the slider stands on, then by the profit or loss the server sent for it. */
export const WHAT_IF_LABEL = 'What if, at the closing bell, the price reaches';
export const WHAT_IF_RESULT_LABEL = 'Profit or loss';

/** Today's ticket, once bought. */
export const WORTH_NOW_LABEL = 'Worth right now';
export const PROFIT_SO_FAR_LABEL = 'Profit or loss so far';
export const REAL_VALUE_WORDS = { game: 'Real value', real: 'intrinsic value' };
export const HOPE_VALUE_WORDS = { game: 'Hope value', real: 'time value' };
export const PER_TICKET_LABEL = 'a ticket';
export const BREAK_EVEN_LABEL = 'Break-even';

export const BUY_LABEL = 'Buy ticket';
export const CASH_OUT_LABEL = 'Cash out';

/** What the form says while a command is on its way, and once the answer is in. */
export const PENDING_WORDS = 'Pending...';
export const ACCEPTED_WORDS = {
  buy: 'Accepted. The ticket is yours.',
  cashOut: 'Accepted. You cashed out.',
};
export const REJECTED_LEAD = 'Rejected.';
export const REJECTED_NO_REASON = 'The game said no to that one. Check your ticket and press again.';
export const LOST_WORDS = 'No answer came back for that one. Check your cash and your ticket, then press again if you still want it.';
export const GAME_GONE_WORDS = 'The previous game is no longer available. That buy cannot be checked.';
export const LATE_ACCEPTED_WORDS = (day: number): string => `Your Day ${String(day)} buy was accepted. That ticket has settled at the closing bell.`;
export const LATE_REJECTED_WORDS = (day: number): string => `Your Day ${String(day)} buy was rejected.`;
export const BOUGHT_FOR_LABEL = 'Bought for';
export const BELL_PAID_LABEL = 'Paid at the bell';
export const CASHED_OUT_WORDS = 'You cashed out';
export const CASHED_OUT_PAID_LABEL = 'Money back in your pocket';
export const PAID_COST_LABEL = 'You paid';
export const SETTLED_WORDS = 'Your ticket settled at the closing bell.';
export const HELD_NOW_TITLE = 'If you had held on';
export const HELD_NOW_WORDS = 'This is what your ticket would be worth right now. Keep watching. It can still go either way.';
export const HELD_BELL_TITLE = 'If you had held to the bell';
export const HELD_BELL_WORDS = 'This is what your ticket would have paid at the closing bell.';
export const LATE_CASHED_OUT_WORDS = (day: number): string => `Day ${String(day)}: cashed out.`;
export const LATE_SETTLED_WORDS = (day: number): string => `Day ${String(day)}: settled at the bell.`;
export const LATE_CASH_OUT_REJECTED_WORDS = (day: number): string => `Day ${String(day)}: cash-out rejected.`;
export const CASH_OUT_GAME_GONE_WORDS = 'The previous game is no longer available. That cash-out cannot be checked.';
export const CASH_OUT_LINE_WORDS = {
  stale: 'Cashing out is off until prices are up to date.',
  offline: 'Not connected. Cashing out is off until fresh prices arrive.',
};

export const HELD_LIVE_HEADING = 'If you had held on';
export const HELD_LIVE_EXPLANATION = 'This is what your ticket would be worth right now. Keep watching. It can still go either way.';
export const HELD_BELL_HEADING = 'If you had held to the bell';
export const HELD_BELL_EXPLANATION = 'This is what your ticket would have paid at the closing bell.';

/** A plain reason for every way the server can say no. */
export const REJECT_WORDS: Record<RejectReason, string> = {
  notEnoughCash: 'Not enough cash for that. Pick a smaller amount.',
  overCap: "That is over today's spending cap. Pick a smaller amount.",
  marketClosed: 'Market closed. The closing bell has rung.',
  priceMoved: 'The price moved. Check the new price and press again.',
  alreadyBought: "You already bought today's ticket. It is one ticket a day.",
  tooCheap: 'That ticket is too cheap to trade. Pick another target.',
  spendTooSmall: 'That amount does not buy one whole ticket. Pick a bigger amount.',
  unknownContract: 'That ticket is not on the board. Pick another one.',
  notOffered: 'That ticket is not on offer right now. Pick another one.',
  unknownPosition: 'There is no open ticket to cash out.',
  alreadyClosed: 'That ticket is already cashed out. You were paid once.',
  wrongDay: "That was for another day. Check today's ticket and press again.",
  wrongPhase: 'You cannot do that at this point in the day.',
  notStarted: 'The game has not started yet.',
  alreadyStarted: 'The game has already started.',
  gameOver: 'The game is over.',
  stressMode: 'Buying is switched off while the stress test runs.',
};

/** Said while the answer to a command is unknown because the line dropped. */
export const CHECKING_WORDS = 'Checking...';
export const RETRY_LABEL = 'Retry safely';
export const RETRY_HINT = 'Sends the same order again. It can never buy or pay twice.';
export const BUY_RETRY_HINT = 'Send the same request again. It will not happen twice.';
export const BUY_LINE_WORDS = {
  stale: 'Buying is off until prices are up to date.',
  offline: 'Not connected. Buying is off until fresh prices arrive.',
};

/** Said at the top of the form while the line is not live. */
export const LINE_WORDS = {
  stale: 'Prices are stale',
  offline: 'Not connected',
};

/** Why the buy button is off, said under it. Null where the form already says it another way. */
export const BLOCKER_WORDS: Record<BuyBlocker, string | null> = {
  notDraft: null,
  stale: 'Prices have stopped moving. Buying is off until they move again.',
  offline: 'Not connected. Buying is off until the connection is back.',
  noContract: 'Pick a ticket first.',
  notOffered: REJECT_WORDS.notOffered,
  cannotBuy: 'Buying is off right now.',
  noSpend: 'Pick how much to spend.',
  waitingForQuote: 'Getting the price...',
  tooCheap: REJECT_WORDS.tooCheap,
  spendTooSmall: REJECT_WORDS.spendTooSmall,
  overCap: REJECT_WORDS.overCap,
  notEnoughCash: REJECT_WORDS.notEnoughCash,
};

/** Why the cash-out button is off, said under it. */
export const CASH_OUT_BLOCKER_WORDS: Record<CashOutBlocker, string | null> = {
  notDraft: null,
  stale: 'Prices have stopped moving. Cashing out is off until they move again.',
  offline: 'Not connected. Cashing out is off until the connection is back.',
  noTicket: REJECT_WORDS.unknownPosition,
};
