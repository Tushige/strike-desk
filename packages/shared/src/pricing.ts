import { exactLn, normCdf } from './exact';
import type { Cents } from './money';
import { ticketPriceCents } from './money';
import type { Side } from './protocol';

/**
 * Ticket pricing. A ticket covers 100 shares. Its value is real value (how
 * far the price is past the target now) plus hope value (what the remaining
 * uncertainty is worth, Black-Scholes with no interest). The mark-up applies
 * to the hope part only, so the value is continuous and equals real value
 * exactly at the bell.
 */

export const SHARES_PER_TICKET = 100;
/**
 * The cheapest tradable ticket. Below this a contract shows as too cheap to
 * trade and cannot be bought.
 *
 * One dollar per 100-share ticket is a one-cent tick per share. With the
 * smallest mark-up at 1.10, $5 is the lowest whole-dollar floor at which a
 * ticket made entirely of hope value, which is every row at the opening bell,
 * is never priced under its fair value; a ticket with real value can still
 * round down by up to half a dollar, at this floor or any other.
 *
 * Provisional, like `QUIET_MARKUP`: both stand until the balance robots have
 * measured them.
 */
export const MIN_TICKET_PRICE_CENTS: Cents = 500;

export type Trust = 1 | 2 | 3;

export interface TrustRule {
  chanceTrue: number;
  /** Typical news move if true, as a fraction of price. */
  move: number;
  markup: number;
}

export const TRUST_RULES: Record<Trust, TrustRule> = {
  3: { chanceTrue: 0.78, move: 0.05, markup: 1.35 },
  2: { chanceTrue: 0.62, move: 0.08, markup: 1.2 },
  1: { chanceTrue: 0.5, move: 0.15, markup: 1.1 },
};

/**
 * Mark-up for a company with no headline today: the tightest, equal to a
 * rumor's, because a quiet company is where the least is known. Provisional
 * until the balance robots have measured it.
 */
export const QUIET_MARKUP = 1.1;

export interface TicketValue {
  /** Whole-dollar ticket price in cents: real plus hope. */
  priceCents: Cents;
  realCents: Cents;
  hopeCents: Cents;
}

export interface PricingInput {
  price: number;
  target: number;
  side: Side;
  /** Variance of the log price still to come: wobble² x time left, plus news² before the reveal. */
  varianceLeft: number;
  markup: number;
}

function intrinsic(price: number, target: number, side: Side): number {
  return Math.max(0, side === 'up' ? price - target : target - price);
}

function fairValue(price: number, target: number, side: Side, varianceLeft: number): number {
  const real = intrinsic(price, target, side);
  if (!(varianceLeft > 0) || !(price > 0) || !(target > 0)) return real;
  const vol = Math.sqrt(varianceLeft);
  const d1 = (exactLn(price / target) + varianceLeft / 2) / vol;
  const call = price * normCdf(d1) - target * normCdf(d1 - vol);
  const value = side === 'up' ? call : call - price + target;
  return Math.max(real, value);
}

export function priceTicket(input: PricingInput): TicketValue {
  const real = intrinsic(input.price, input.target, input.side);
  const hope = fairValue(input.price, input.target, input.side, input.varianceLeft) - real;
  const priceCents = ticketPriceCents(SHARES_PER_TICKET * (real + input.markup * hope));
  const realCents = Math.min(priceCents, ticketPriceCents(SHARES_PER_TICKET * real));
  return { priceCents, realCents, hopeCents: priceCents - realCents };
}

export function isTradable(priceCents: Cents): boolean {
  return priceCents >= MIN_TICKET_PRICE_CENTS;
}
