import { expect, it } from 'vitest';
import { bellStep, GAME_STEPS } from '../src/clock';
import { projectFrame } from '../src/frame';
import { advanceTo } from '../src/game';
import { boardFor } from '../src/market';
import { EVENTS } from '../src/news';
import { EVENT_FOLLOW_UPS, newsResolution } from '../src/newsResolution';
import { sharePriceCents } from '../src/money';
import { contractId, frameSchema } from '../src/protocol';
import { buyAt, ME, startedGame, testMarket } from './helpers';

it('covers every authored event with distinct follow-ups without changing its initial headline', () => {
  expect(Object.keys(EVENT_FOLLOW_UPS).sort()).toEqual(EVENTS.map(event => event.id).sort());
  const market = testMarket();
  for (const day of market.days) for (const { headline } of day.news) {
    expect(headline.eventId).toBeTruthy();
    const yes = newsResolution(headline, true);
    const no = newsResolution(headline, false);
    expect(yes).not.toEqual(no);
    expect(yes.updateBody.length).toBeGreaterThan(20);
    expect(no.updateBody.length).toBeGreaterThan(20);
  }
});

it('releases each explanation and observed jump exactly at its own reveal, never in advance', () => {
  const market = testMarket();
  for (const event of market.days[0]!.news) {
    const { headline, hidden } = event;
    const beforeStep = 300 + hidden.revealIndex - 1;
    const before = projectFrame(market, advanceTo(market, startedGame(market), beforeStep), ME, beforeStep, { session: 'test', history: true });
    const pending = before.news.find(item => item.id === headline.id)!;
    expect(pending).not.toHaveProperty('updateBody');
    expect(pending).not.toHaveProperty('eventDirection');
    expect(pending).not.toHaveProperty('eventBeforeCents');
    const step = beforeStep + 1;
    const frame = projectFrame(market, advanceTo(market, startedGame(market), step), ME, step, { session: 'test', history: true });
    const landed = frame.news.find(item => item.id === headline.id)!;
    expect(landed).toMatchObject(newsResolution(headline, hidden.wasTrue));
    expect(landed.title).toBe(headline.title);
    expect(landed.eventDirection).toBe(hidden.move > 0 ? 'up' : 'down');
    expect(landed.eventBeforeCents).toBe(sharePriceCents(market.days[0]!.paths[headline.companyId]![hidden.revealIndex - 1]!));
    expect(landed.eventAfterCents).toBe(sharePriceCents(market.days[0]!.paths[headline.companyId]![hidden.revealIndex]!));
    expect(frameSchema.parse(frame)).toEqual(frame);
  }
});

it('preserves the traded company’s original news and closing prices in the final review', () => {
  const market = testMarket();
  const companyId = market.days[0]!.news[0]!.headline.companyId;
  const board = boardFor(market, 1);
  const contract = contractId(board.targetsPerCompany, { companyId, targetIndex: board.companies[companyId]!.simpleUp[0], side: 'up' });
  const bought = buyAt(market, startedGame(market), ME, 0, 1, 0, contract, 1000000);
  expect(bought.receipt.outcome).toBe('accepted');
  const closed = advanceTo(market, bought.game, bellStep(1));
  const first = projectFrame(market, closed, ME, bellStep(1), { session: 'test', history: true }).days[0]!.review;
  expect(first?.news?.companyId).toBe(companyId);
  const ended = advanceTo(market, closed, GAME_STEPS);
  const final = projectFrame(market, ended, ME, GAME_STEPS, { session: 'test', history: true });
  expect(final.days[0]!.review).toEqual(first);
  expect(first?.news?.day).toBe(1);
  expect(frameSchema.parse(final)).toEqual(final);
});
