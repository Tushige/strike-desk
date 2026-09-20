import type { Company } from '../src/cast';

/**
 * A small stand-in cast for price fixtures. It is passed in to `buildMarket`,
 * so an edit to the real cast can never move a pinned price. With four
 * companies and three headlines a day, one company is quiet each day.
 *
 * Each own wobble is chosen so that, with the whole-market part, the company
 * wobbles by 3.5% a day: sqrt((beta * 0.015)^2 + ownWobble^2) = 0.0350.
 *
 * Changing anything here changes every pinned price: regenerate the fixtures
 * in the same commit, and say why.
 */
export const TEST_CAST: readonly Company[] = [
  { id: 0, ticker: 'TSTA', name: 'Test Alpha', product: 'test kites', kind: 'toys', rivalId: 1, startPrice: 100, beta: 1.0, ownWobble: 0.03162 },
  { id: 1, ticker: 'TSTB', name: 'Test Bravo', product: 'test juice', kind: 'drinks', rivalId: 0, startPrice: 50, beta: 0.5, ownWobble: 0.03419 },
  { id: 2, ticker: 'TSTC', name: 'Test Charlie', product: 'test snacks', kind: 'food', rivalId: 3, startPrice: 20, beta: 1.5, ownWobble: 0.02681 },
  { id: 3, ticker: 'TSTD', name: 'Test Delta', product: 'test cells', kind: 'energy', rivalId: 2, startPrice: 200, beta: 0.8, ownWobble: 0.03288 },
];
