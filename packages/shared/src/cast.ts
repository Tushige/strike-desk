/**
 * The cast: six companies, as reviewed data. A company's id is its index.
 * Wobble numbers are fractions of the price per day; together the shared
 * market part and the company's own part come to about 3.5% a day.
 */

export type CompanyKind = 'toys' | 'drinks' | 'wearables' | 'food' | 'games' | 'energy';

export interface Company {
  id: number;
  ticker: string;
  name: string;
  product: string;
  kind: CompanyKind;
  /** Id of the company headlines may name as its rival. */
  rivalId: number;
  startPrice: number;
  /** Sensitivity to the whole-market move. */
  beta: number;
  /** The company's own daily wobble, as a fraction of price. */
  ownWobble: number;
}

/** Daily wobble of the whole-market part, as a fraction of price. */
export const MARKET_WOBBLE = 0.015;
/** Typical total daily wobble; ticket pricing uses this for every company. */
export const DAY_WOBBLE = 0.035;

export const CAST: readonly Company[] = [
  { id: 0, ticker: 'RPUP', name: 'RoboPup', product: 'robot pets', kind: 'toys', rivalId: 4, startPrice: 84, beta: 1.0, ownWobble: 0.0316 },
  { id: 1, ticker: 'FIZZ', name: 'Fizzly', product: 'fizzy drinks', kind: 'drinks', rivalId: 3, startPrice: 42, beta: 0.6, ownWobble: 0.0338 },
  { id: 2, ticker: 'JETK', name: 'JetKicks', product: 'jet sneakers', kind: 'wearables', rivalId: 0, startPrice: 120, beta: 1.2, ownWobble: 0.03 },
  { id: 3, ticker: 'MUNC', name: 'MoonMunch', product: 'space snacks', kind: 'food', rivalId: 1, startPrice: 28, beta: 0.8, ownWobble: 0.0329 },
  { id: 4, ticker: 'PIXL', name: 'PixelPals', product: 'video games', kind: 'games', rivalId: 0, startPrice: 65, beta: 1.4, ownWobble: 0.028 },
  { id: 5, ticker: 'ZAPP', name: 'ZapCharge', product: 'super batteries', kind: 'energy', rivalId: 2, startPrice: 150, beta: 1.6, ownWobble: 0.0255 },
];

export const COMPANY_COUNT = CAST.length;
