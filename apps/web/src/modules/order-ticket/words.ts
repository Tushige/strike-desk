import type { RejectReason, Side } from '@strike-desk/shared/protocol';
import type { BuyBlocker } from './machine';
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
export const NOTHING_PICKED = 'Pick a company, then pick a ticket.';

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

export const TARGET_WORDS = { game: 'Target', real: 'strike price' };

export const CHOICES_LABEL = 'Pick a ticket';
export const CHOICE_WORDS: Record<SimpleChoice['choice'], string> = {
  close: 'Close',
  far: 'Far',
  moonshot: 'Moonshot',
};

export const SPEND_LABEL = 'How much to spend';

export const PRICE_LABEL = 'Ticket price';
export const QUANTITY_LABEL = 'Tickets you get';
export const COST_LABEL = 'Cost & most you can lose';
export const CASH_LABEL = 'Cash';
export const CAP_LABEL = 'Most you can spend today';

export const BUY_LABEL = 'Buy ticket';

/** What the form says while a command is on its way, and once the answer is in. */
export const PENDING_WORDS = 'Pending...';
export const ACCEPTED_BUY_WORDS = 'Accepted. The ticket is yours.';
export const REJECTED_LEAD = 'Rejected.';
export const REJECTED_NO_REASON = 'The game said no to that one. Check your ticket and press again.';
export const LOST_WORDS = 'No answer came back for that one. Check your cash and your ticket, then press again if you still want it.';

/** A plain reason for every way the server can say no. */
export const REJECT_WORDS: Record<RejectReason, string> = {
  notEnoughCash: 'Not enough cash for that. Pick a smaller amount.',
  overCap: "That is over today's spending cap. Pick a smaller amount.",
  marketClosed: 'Market closed. The closing bell has rung.',
  priceMoved: 'The price moved. Check the new price and press again.',
  alreadyBought: "You already hold today's ticket. It is one ticket a day.",
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
