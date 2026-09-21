import { contractCount } from './board';
import { DAYS, GAME_STEPS, OPEN_STEPS, momentAt } from './clock';
import type { GameState, PositionRecord } from './game';
import { STARTING_CASH_CENTS, breakEvenCents, playerOf, spendCapCents } from './game';
import type { Market } from './market';
import { boardFor, marketDay, quoteAt } from './market';
import { sharePriceCents, totalCents } from './money';
import { MIN_TICKET_PRICE_CENTS } from './pricing';
import type { CompanyView, Frame, NewsView, PositionView } from './protocol';
import { FRAME_RECEIPTS, decodeContractId } from './protocol';
import { seedToMarketCode } from './rng';

/**
 * The single projection: hidden market + game state + a player + a step in,
 * that player's public frame out. Everything a player ever sees passes
 * through here, so this is the one place that keeps the future secret. It
 * reads nothing past the current price index except where the result provably
 * does not depend on it; the test scrambles the future and expects an
 * identical frame.
 *
 * A frame is one player's picture. The revision, the account, the positions,
 * the receipts and the day results are the named player's and nobody else's;
 * prices, the clock, the board, the quotes and the news are the same for
 * every player of the session.
 *
 * `game` must already be advanced to the step (see `advanceTo`).
 */

export interface ProjectOptions {
  session: string;
  /** Include today's price history. Only the full form carries it. */
  history: boolean;
  /**
   * Which sections are filled in. Both forms carry rev, step, the clock,
   * the companies' names, six share prices, the cheapest tradable price,
   * today's board and one ticket price per contract with its real value, its
   * hope value and its break-even (no board and no ticket price in the lobby).
   * 'live': besides those, only the account, with the player's cash as its
   *         worth and `canBuy` false. News, positions, receipts and days
   *         are empty; `history` and `final` are never set.
   * 'full': every section. The default.
   */
  sections?: 'live' | 'full';
}

function projectPosition(market: Market, game: GameState, position: PositionRecord, step: number): PositionView {
  const board = boardFor(market, position.day, game.targetsPerCompany);
  const moment = momentAt(step);
  // A past day's ticket is looked up at its own bell, never at today's index.
  const index = position.day < moment.day ? OPEN_STEPS : moment.priceIndex;
  const live = quoteAt(market, position.day, index, board, position.contractId);
  const livePriceCents = live?.priceCents ?? 0;
  const base = {
    id: position.id,
    day: position.day,
    contractId: position.contractId,
    companyId: position.companyId,
    side: position.side,
    targetCents: position.targetCents,
    quantity: position.quantity,
    entryPriceCents: position.entryPriceCents,
    costCents: position.costCents,
    entryStep: position.entryStep,
    entryPriceIndex: position.entryPriceIndex,
    breakEvenCents: breakEvenCents(position.targetCents, position.entryPriceCents, position.side),
  };
  if (position.exit === undefined) {
    return {
      ...base,
      status: 'open',
      valueCents: totalCents(livePriceCents, position.quantity),
      realCents: live?.realCents ?? 0,
      hopeCents: live?.hopeCents ?? 0,
    };
  }
  const atExit = quoteAt(market, position.day, position.exit.priceIndex, board, position.contractId);
  const view: PositionView = {
    ...base,
    status: position.exit.kind === 'bell' ? 'settled' : 'cashedOut',
    valueCents: position.exit.proceedsCents,
    realCents: atExit?.realCents ?? 0,
    hopeCents: atExit?.hopeCents ?? 0,
    exit: position.exit,
  };
  if (position.exit.kind === 'cashOut') view.ifHeldCents = totalCents(livePriceCents, position.quantity);
  return view;
}

export function projectFrame(market: Market, game: GameState, playerId: string, step: number, options: ProjectOptions): Frame {
  const player = playerOf(game, playerId);
  const live = options.sections === 'live';
  const started = game.pace !== null;
  // Field by field: a field added to a company later never reaches the wire by default.
  const companies: CompanyView[] = market.cast.map((company) => ({ ticker: company.ticker, name: company.name }));
  const receipts = live ? [] : player.receipts.slice(-FRAME_RECEIPTS);
  const days = live
    ? []
    : player.dayEndCents.map((endCents, index) => ({
        day: index + 1,
        startCents: index === 0 ? STARTING_CASH_CENTS : (player.dayEndCents[index - 1] ?? STARTING_CASH_CENTS),
        endCents,
      }));

  if (!started) {
    return {
      t: 'frame',
      session: options.session,
      rev: player.rev,
      step: 0,
      clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null },
      companies,
      prices: market.cast.map((company) => sharePriceCents(company.startPrice)),
      minTicketCents: MIN_TICKET_PRICE_CENTS,
      board: null,
      quotes: [],
      quoteReals: [],
      quoteHopes: [],
      quoteBreakEvens: [],
      news: [],
      account: { cashCents: player.cashCents, worthCents: player.cashCents, capCents: spendCapCents(player.cashCents), canBuy: false },
      positions: [],
      receipts,
      days,
      stress: game.stress,
    };
  }

  const moment = momentAt(step);
  const data = marketDay(market, moment.day);
  const prices = data.paths.map((path) => sharePriceCents(path[moment.priceIndex] ?? 0));

  // Both forms share the board and the quotes. One pricing call per contract,
  // at the current point of the path and nowhere else, gives the price and
  // its two parts, so real plus hope is the price on every contract. The
  // break-even comes from that same price and the contract's target, by the
  // rule a bought ticket uses, so the table and the ticket cannot disagree.
  const board = boardFor(market, moment.day, game.targetsPerCompany);
  const quotes: number[] = [];
  const quoteReals: number[] = [];
  const quoteHopes: number[] = [];
  const quoteBreakEvens: number[] = [];
  const total = contractCount(board);
  for (let id = 0; id < total; id += 1) {
    const value = quoteAt(market, moment.day, moment.priceIndex, board, id);
    const priceCents = value?.priceCents ?? 0;
    const { companyId, targetIndex, side } = decodeContractId(board.targetsPerCompany, id);
    const targetCents = board.companies[companyId]?.targets[targetIndex] ?? 0;
    quotes.push(priceCents);
    quoteReals.push(value?.realCents ?? 0);
    quoteHopes.push(value?.hopeCents ?? 0);
    // A contract with no quote has a price of 0, so it breaks even at its target.
    quoteBreakEvens.push(breakEvenCents(targetCents, priceCents, side));
  }

  if (live) {
    // Returns before any headline or position is projected: news and
    // positions stay empty, the account is the player's cash alone, and
    // history and final are never set.
    return {
      t: 'frame',
      session: options.session,
      rev: player.rev,
      step,
      clock: { ...moment, pace: game.pace },
      companies,
      prices,
      minTicketCents: MIN_TICKET_PRICE_CENTS,
      board,
      quotes,
      quoteReals,
      quoteHopes,
      quoteBreakEvens,
      news: [],
      account: { cashCents: player.cashCents, worthCents: player.cashCents, capCents: spendCapCents(player.cashCents), canBuy: false },
      positions: [],
      receipts,
      days,
      stress: game.stress,
    };
  }

  const bellRung = moment.priceIndex >= OPEN_STEPS;

  const news: NewsView[] = data.news.map(({ headline, hidden }) => {
    const revealed = moment.priceIndex >= hidden.revealIndex;
    // Field by field: a field added to the internal headline later never reaches the wire by default.
    const view: NewsView = {
      id: headline.id,
      day: headline.day,
      companyId: headline.companyId,
      trust: headline.trust,
      source: headline.source,
      title: headline.title,
      body: headline.body,
      revealed,
    };
    if (revealed) view.revealIndex = hidden.revealIndex;
    if (bellRung) view.wasTrue = hidden.wasTrue;
    return view;
  });

  const positions = player.positions.map((position) => projectPosition(market, game, position, step));
  const openValueCents = positions
    .filter((position) => position.status === 'open')
    .reduce((sum, position) => sum + position.valueCents, 0);
  const marketIsOpen = moment.phase === 'preBell' || moment.phase === 'open';
  const boughtToday = player.positions.some((position) => position.day === moment.day);

  const frame: Frame = {
    t: 'frame',
    session: options.session,
    rev: player.rev,
    step,
    clock: { ...moment, pace: game.pace },
    companies,
    prices,
    minTicketCents: MIN_TICKET_PRICE_CENTS,
    board,
    quotes,
    quoteReals,
    quoteHopes,
    quoteBreakEvens,
    news,
    account: {
      cashCents: player.cashCents,
      worthCents: player.cashCents + openValueCents,
      capCents: spendCapCents(player.cashCents),
      canBuy: marketIsOpen && !boughtToday && !game.stress,
    },
    positions,
    receipts,
    days,
    stress: game.stress,
  };
  if (options.history) {
    frame.history = data.paths.map((path) => path.slice(0, moment.priceIndex + 1).map(sharePriceCents));
  }
  if (step >= GAME_STEPS && moment.day === DAYS) {
    frame.final = {
      marketCode: seedToMarketCode(market.identity.seed),
      engine: market.identity.engine,
      content: market.identity.content,
      finalCents: player.cashCents,
    };
  }
  return frame;
}
