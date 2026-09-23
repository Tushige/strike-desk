import type { Frame, PositionView } from '@strike-desk/shared/protocol';
import { store } from '../../boot';
import type { OpenTicket, TicketAccount, TicketQuote } from '../../modules/order-ticket/index';
import { deriveSlice, sameFields } from '../../store/derive';
import type { Slice } from '../../store/gameStore';

/**
 * What the order ticket reads, cut from the latest frame: the server's quote
 * for the draft, the account, and today's open ticket. Each is its own slice
 * so the form redraws only when its own numbers move.
 */

const NO_ACCOUNT: TicketAccount = { cashCents: 0, capCents: 0, canBuy: false, minTicketCents: 0 };

function quoteOf(frame: Frame | null): TicketQuote | null {
  const draft = frame?.draft;
  const ticket = draft?.ticket;
  if (draft === undefined || ticket === undefined || draft.contractId === null) return null;
  return {
    contractId: draft.contractId,
    spendCents: draft.spendCents,
    priceCents: ticket.priceCents,
    quantity: ticket.quantity,
    costCents: ticket.costCents,
    limitPriceCents: ticket.limitPriceCents,
    breakEvenCents: ticket.breakEvenCents,
    whatIf: ticket.whatIf,
  };
}

/** Two quotes with the same numbers and the same what-if stops. */
function sameQuote(a: TicketQuote | null, b: TicketQuote | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const { whatIf: stopsA, ...restA } = a;
  const { whatIf: stopsB, ...restB } = b;
  if (!sameFields(restA, restB) || stopsA.length !== stopsB.length) return false;
  return stopsA.every((stop, i) => stop.atCents === stopsB[i]?.atCents && stop.profitCents === stopsB[i]?.profitCents);
}

function accountOf(frame: Frame | null): TicketAccount {
  if (frame === null) return NO_ACCOUNT;
  return {
    cashCents: frame.account.cashCents,
    capCents: frame.account.capCents,
    canBuy: frame.account.canBuy,
    minTicketCents: frame.minTicketCents,
  };
}

/** Today's ticket while it is still open, in the shape the form wants. */
export function openTicketOf(frame: Frame | null, positionId?: string | null): OpenTicket | null {
  const position = positionId === undefined ? todaysTicket(frame) : frame?.positions.find(item => item.id === positionId && item.day === frame.clock.day) ?? null;
  if (position === null || position.status !== 'open') return null;
  const company = frame?.companies[position.companyId];
  return {
    positionId: position.id,
    companyName: company?.name ?? '',
    ticker: company?.ticker ?? '',
    side: position.side,
    targetCents: position.targetCents,
    quantity: position.quantity,
    costCents: position.costCents,
    valueCents: position.valueCents,
    profitCents: position.profitCents,
    realCents: position.realCents,
    hopeCents: position.hopeCents,
    breakEvenCents: position.breakEvenCents,
  };
}

/** Today's ticket, open or closed, or null when none was bought today. */
export function todaysTicket(frame: Frame | null): PositionView | null {
  if (frame === null) return null;
  return frame.positions.find((position) => position.day === frame.clock.day) ?? null;
}

const quoteSlice: Slice<TicketQuote | null> = deriveSlice(store.frame, quoteOf, sameQuote);
const accountSlice: Slice<TicketAccount> = deriveSlice(store.frame, accountOf, sameFields);
const positionSlice: Slice<OpenTicket | null> = deriveSlice(store.frame, openTicketOf, sameFields);

/** The three slices in the shape the order ticket's ports ask for: plain functions, made once. */
export const ticketSlices = {
  quote: { get: (): TicketQuote | null => quoteSlice.get(), subscribe: (listener: () => void): (() => void) => quoteSlice.subscribe(listener) },
  account: { get: (): TicketAccount => accountSlice.get(), subscribe: (listener: () => void): (() => void) => accountSlice.subscribe(listener) },
  position: { get: (): OpenTicket | null => positionSlice.get(), subscribe: (listener: () => void): (() => void) => positionSlice.subscribe(listener) },
} as const;
