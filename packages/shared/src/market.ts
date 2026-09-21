import type { Board } from './board';
import { DEFAULT_TARGETS_PER_COMPANY, OFFERED_PASSED_MOVES, buildCompanyBoard } from './board';
import type { Company } from './cast';
import { CAST, DAY_WOBBLE, MARKET_WOBBLE } from './cast';
import { DAYS, OPEN_STEPS } from './clock';
import { exactExp } from './exact';
import { centsToDollars } from './money';
import type { TicketValue, Trust } from './pricing';
import { QUIET_MARKUP, TRUST_RULES, priceTicket } from './pricing';
import { decodeContractId } from './protocol';
import { createStream } from './rng';

/**
 * The market: everything that will happen in one game, worked out up front
 * from the market identity. It is hidden state. It lives on the server (and
 * in tests and robots) and never crosses the wire; only `projectFrame`
 * decides what part of it a player may see at a given step.
 */

/** Bump when the model changes: the same seed then means a different market. */
export const ENGINE_VERSION = 'e3';
/** Bump when headline content changes. */
export const CONTENT_VERSION = 'c0';

/**
 * What names a market. The same identity always gives the same market, so
 * `buildMarket` refuses an engine or content version other than its own:
 * this code could only build a different market under the same name.
 */
export interface MarketIdentity {
  seed: number;
  engine: string;
  content: string;
}

/** What a market is built on. Everything is optional; the defaults are the real game. */
export interface MarketSettings {
  /** The companies. A company's id is its index. Defaults to the real cast. */
  cast?: readonly Company[];
  /**
   * How many expected moves of already-passed targets each board keeps on
   * offer. Defaults to the full board. It changes what may be bought and
   * nothing else: no price, no target and no contract id depends on it.
   */
  offeredPassedMoves?: number;
}

/** The half of a headline a player may read from the start of its day. */
export interface Headline {
  id: number;
  day: number;
  companyId: number;
  trust: Trust;
  source: string;
  title: string;
  body: string;
}

/** The half nobody sees until it has happened. */
export interface HiddenOutcome {
  /** Point of the day's path at which the whole news move lands: 35% to 70% of the open market. */
  revealIndex: number;
  wasTrue: boolean;
  /**
   * Signed log move: the price is multiplied by the exponential of it, so an
   * up move and a down move of the same size mirror each other exactly.
   */
  move: number;
}

export interface MarketNews {
  headline: Headline;
  hidden: HiddenOutcome;
}

export interface MarketDay {
  /** 1 to 5. */
  day: number;
  /** By company id: OPEN_STEPS + 1 share prices in dollars. Index 0 is the opening price, the last is the bell. */
  paths: number[][];
  news: MarketNews[];
}

export interface Market {
  identity: MarketIdentity;
  /** The cast this market was built on. */
  cast: readonly Company[];
  /** What every board of this market is built with. See `MarketSettings`. */
  offeredPassedMoves: number;
  days: MarketDay[];
}

const STEP_SCALE = 1 / Math.sqrt(OPEN_STEPS);
const TRUST_ORDER: readonly Trust[] = [3, 2, 1];

function drawNews(cast: readonly Company[], seed: number, day: number, firstId: number): MarketNews[] {
  const pickRng = createStream(seed, 'newsPick', day);
  const outcomeRng = createStream(seed, 'newsOutcome', day);
  const free = cast.map((company) => company.id);
  return TRUST_ORDER.map((trust, index) => {
    const companyId = free.splice(pickRng.nextInt(free.length), 1)[0] ?? 0;
    const company = cast[companyId];
    const direction = pickRng.nextFloat() < 0.5 ? -1 : 1;
    const rule = TRUST_RULES[trust];
    const wasTrue = outcomeRng.nextFloat() < rule.chanceTrue;
    const x = outcomeRng.nextFloat();
    const move = wasTrue ? direction * rule.move * (0.6 + 1.4 * x * x) : -direction * rule.move * (0.4 + 0.6 * x);
    const revealIndex = Math.floor(OPEN_STEPS * (0.35 + 0.35 * outcomeRng.nextFloat()));
    // Stand-in wording until the reviewed headline pool replaces it.
    const name = company?.name ?? '';
    return {
      headline: {
        id: firstId + index,
        day,
        companyId,
        trust,
        source: trust === 3 ? 'Company statement' : trust === 2 ? 'A store manager says' : 'Someone online says',
        title: direction > 0 ? `Good news for ${name}?` : `Trouble at ${name}?`,
        body: direction > 0 ? `${name} may be about to have a very good day.` : `${name} may be about to have a very bad day.`,
      },
      hidden: { revealIndex, wasTrue, move },
    };
  });
}

function drawPaths(cast: readonly Company[], seed: number, day: number, openPrices: readonly number[], news: readonly MarketNews[]): number[][] {
  const marketRng = createStream(seed, 'marketWide', day);
  const marketShocks: number[] = [];
  for (let k = 0; k < OPEN_STEPS; k += 1) marketShocks.push(marketRng.nextNormal());

  return cast.map((company) => {
    const rng = createStream(seed, 'prices', day, company.id);
    const hidden = news.find((item) => item.headline.companyId === company.id)?.hidden;
    const marketSd = company.beta * MARKET_WOBBLE * STEP_SCALE;
    const ownSd = company.ownWobble * STEP_SCALE;
    const drift = -0.5 * (marketSd * marketSd + ownSd * ownSd);
    let price = openPrices[company.id] ?? company.startPrice;
    const path = [price];
    for (let k = 1; k <= OPEN_STEPS; k += 1) {
      const shock = marketSd * (marketShocks[k - 1] ?? 0) + ownSd * rng.nextNormal();
      price *= exactExp(drift + shock);
      if (hidden !== undefined && k === hidden.revealIndex) price *= exactExp(hidden.move);
      path.push(price);
    }
    return path;
  });
}

function checkIdentity(identity: MarketIdentity): void {
  if (identity.engine === ENGINE_VERSION && identity.content === CONTENT_VERSION) return;
  throw new Error(
    `cannot build this market: it was made with engine ${identity.engine} and content ${identity.content}, ` +
      `and this code is engine ${ENGINE_VERSION} and content ${CONTENT_VERSION}`,
  );
}

function checkCast(cast: readonly Company[]): void {
  if (cast.length < TRUST_ORDER.length) throw new Error(`a cast needs at least ${TRUST_ORDER.length} companies: one per headline`);
  cast.forEach((company, index) => {
    if (company.id !== index) throw new Error(`company ${company.ticker} must have its place in the cast, ${index}, as its id`);
    if (!Number.isInteger(company.rivalId) || company.rivalId < 0 || company.rivalId >= cast.length) {
      throw new Error(`company ${company.ticker} names a rival that is not in the cast`);
    }
    if (!Number.isFinite(company.startPrice) || company.startPrice <= 0) throw new Error(`company ${company.ticker} needs a start price above zero`);
  });
}

export function buildMarket(identity: MarketIdentity, settings: MarketSettings = {}): Market {
  checkIdentity(identity);
  const cast = settings.cast ?? CAST;
  checkCast(cast);
  const offeredPassedMoves = settings.offeredPassedMoves ?? OFFERED_PASSED_MOVES;
  if (!Number.isFinite(offeredPassedMoves) || offeredPassedMoves < 0) throw new Error('the offered already-passed moves must be a number at or above zero');
  const days: MarketDay[] = [];
  let openPrices = cast.map((company) => company.startPrice);
  for (let day = 1; day <= DAYS; day += 1) {
    const news = drawNews(cast, identity.seed, day, (day - 1) * TRUST_ORDER.length);
    const paths = drawPaths(cast, identity.seed, day, openPrices, news);
    days.push({ day, paths, news });
    openPrices = paths.map((path) => path[OPEN_STEPS] ?? 0);
  }
  return { identity, cast, offeredPassedMoves, days };
}

export function marketDay(market: Market, day: number): MarketDay {
  const found = market.days[day - 1];
  if (found === undefined) throw new Error(`no day ${day} in this market`);
  return found;
}

function newsFor(marketDayData: MarketDay, companyId: number): MarketNews | undefined {
  return marketDayData.news.find((item) => item.headline.companyId === companyId);
}

/**
 * The swing the market is braced for today, as a fraction of price. Public:
 * it depends on the headline's trust level only.
 */
export function expectedMove(marketDayData: MarketDay, companyId: number): number {
  const news = newsFor(marketDayData, companyId);
  const newsMove = news === undefined ? 0 : TRUST_RULES[news.headline.trust].move;
  return Math.sqrt(DAY_WOBBLE * DAY_WOBBLE + newsMove * newsMove);
}

const boardCache = new WeakMap<MarketDay, Map<number, Board>>();

/** The day's board at a size. Built from opening prices and public trust levels only. */
export function boardFor(market: Market, day: number, targetsPerCompany = DEFAULT_TARGETS_PER_COMPANY): Board {
  const data = marketDay(market, day);
  let bySize = boardCache.get(data);
  if (bySize === undefined) {
    bySize = new Map();
    boardCache.set(data, bySize);
  }
  let board = bySize.get(targetsPerCompany);
  if (board === undefined) {
    board = {
      targetsPerCompany,
      companies: market.cast.map((company) =>
        buildCompanyBoard(data.paths[company.id]?.[0] ?? company.startPrice, expectedMove(data, company.id), targetsPerCompany, market.offeredPassedMoves),
      ),
    };
    bySize.set(targetsPerCompany, board);
  }
  return board;
}

export function sharePriceAt(market: Market, day: number, priceIndex: number, companyId: number): number {
  const price = marketDay(market, day).paths[companyId]?.[priceIndex];
  if (price === undefined) throw new Error('no such price');
  return price;
}

/**
 * One contract's ticket value at a point of the day. Reads the hidden reveal
 * moment, but its result only changes once that moment has passed.
 */
export function quoteAt(market: Market, day: number, priceIndex: number, board: Board, id: number): TicketValue | null {
  const ref = decodeContractId(board.targetsPerCompany, id);
  const targetCents = board.companies[ref.companyId]?.targets[ref.targetIndex];
  if (targetCents === undefined || !Number.isInteger(id) || id < 0) return null;
  const data = marketDay(market, day);
  const news = newsFor(data, ref.companyId);
  const timeLeft = (OPEN_STEPS - priceIndex) / OPEN_STEPS;
  let varianceLeft = DAY_WOBBLE * DAY_WOBBLE * timeLeft;
  let markup = QUIET_MARKUP;
  if (news !== undefined) {
    const rule = TRUST_RULES[news.headline.trust];
    markup = rule.markup;
    if (priceIndex < news.hidden.revealIndex) varianceLeft += rule.move * rule.move;
  }
  return priceTicket({
    price: sharePriceAt(market, day, priceIndex, ref.companyId),
    target: centsToDollars(targetCents),
    side: ref.side,
    varianceLeft,
    markup,
  });
}
