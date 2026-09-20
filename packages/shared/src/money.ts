/**
 * Money is whole cents, as an integer, everywhere in `shared` and on the
 * wire. Prices inside the market model are fractional dollars; they become
 * money in exactly two places, both in this file.
 */
export type Cents = number;

const CENTS_PER_DOLLAR = 100;

/**
 * The one rounding function for ticket money: a ticket's price is a whole
 * number of dollars. Everything a player pays or receives is this price
 * times a whole quantity, so no other rounding is ever needed.
 */
export function ticketPriceCents(dollarsPerTicket: number): Cents {
  if (!(dollarsPerTicket > 0)) return 0;
  return Math.round(dollarsPerTicket) * CENTS_PER_DOLLAR;
}

/** A share price or a target for display and the wire: nearest cent. */
export function sharePriceCents(dollars: number): Cents {
  return Math.round(dollars * CENTS_PER_DOLLAR);
}

export function centsToDollars(cents: Cents): number {
  return cents / CENTS_PER_DOLLAR;
}

/** How many whole tickets a spend buys at a price. Zero when the price is not tradable. */
export function quantityForSpend(spendCents: Cents, priceCents: Cents): number {
  if (priceCents <= 0 || spendCents <= 0) return 0;
  return Math.floor(spendCents / priceCents);
}

/** Cost and payout alike: price times quantity, already whole cents. */
export function totalCents(priceCents: Cents, quantity: number): Cents {
  return priceCents * quantity;
}

/** "$1,234,567" for whole dollars, "$12.34" when there are cents. */
export function formatCents(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / CENTS_PER_DOLLAR);
  const rest = abs % CENTS_PER_DOLLAR;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`;
  return `${negative ? '-' : ''}$${grouped}${tail}`;
}
