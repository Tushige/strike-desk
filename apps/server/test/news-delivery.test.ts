import { expect, it } from 'vitest';
import { CONTENT_VERSION, ENGINE_VERSION, FIRST_PLAYER_ID, PROTOCOL_VERSION, createSession, handleCommand, momentAt } from '@strike-desk/shared/engine';
import type { Frame, Session } from '@strike-desk/shared/engine';
import { liveNewsFrameFor } from '../src/liveNewsFrame';
import { FIXED_SEEDS, startHarness } from './harness';

function started(): Session {
  const session = createSession('news-session', { seed: FIXED_SEEDS[0] ?? 0, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  return handleCommand(session, FIRST_PLAYER_ID, { t: 'start', commandId: 'start-news', pace: 1 }, 0).session;
}

function publicFrame(session: Session, step: number): Frame {
  return liveNewsFrameFor(session, FIRST_PLAYER_ID, step * 200, true).frame;
}

/** Change only data still in the future, preserving every landed reveal. */
function scrambleFuture(session: Session, step: number): Session {
  const copy = structuredClone(session);
  const { day, priceIndex } = momentAt(step);
  for (const current of copy.market.days) {
    if (current.day < day) continue;
    const today = current.day === day;
    current.paths = current.paths.map((prices) => prices.map((price, index) =>
      today && index <= priceIndex ? price : price * 1.37 + 11 + index));
    for (const news of current.news) {
      if (today && news.hidden.revealIndex <= priceIndex) continue;
      const next = today ? priceIndex + 1 : 1;
      news.hidden.revealIndex = news.hidden.revealIndex === next ? next + 1 : next;
      news.hidden.wasTrue = !news.hidden.wasTrue;
      news.hidden.move = -news.hidden.move + 0.01;
      if (!today) {
        news.headline.title = 'Changed future title';
        news.headline.body = 'Changed future body';
      }
    }
  }
  return copy;
}

function expectPublicOnly(frame: Frame): void {
  expect(frame.positions).toEqual([]);
  expect(frame.receipts).toEqual([{ commandId: 'start-news', kind: 'start', step: 0, outcome: 'accepted' }]);
  for (const day of frame.days) expect(day).toMatchObject({ startCents: 100000000, endCents: 100000000, changeCents: 0 });
  expect(frame.history).toHaveLength(6);
  frame.history?.forEach((path, companyId) => {
    expect(path).toHaveLength(frame.clock.priceIndex + 1);
    expect(path.at(-1)).toBe(frame.prices[companyId]);
  });
  if (frame.clock.phase === 'final') expect(frame.final).toMatchObject({ finalCents: 100000000, changeCents: 0 });
  else expect(frame).not.toHaveProperty('final');
  expect(frame).not.toHaveProperty('draft');
  expect(frame.account).toEqual({ cashCents: 100000000, worthCents: 100000000, capCents: 50000000,
    canBuy: !frame.stress && (frame.clock.phase === 'preBell' || frame.clock.phase === 'open') });
  for (const news of frame.news) {
    expect(Object.keys(news).sort()).toEqual([
      'body', 'companyId', 'day', 'direction', 'id', ...(news.revealed ? ['revealIndex'] : []), 'revealed', 'source', 'title', 'trust',
    ].sort());
    if (news.revealed) expect(news.revealIndex).toBeLessThanOrEqual(frame.clock.priceIndex);
  }
}

it.each(['before', 'mixed'] as const)('scrambling future values cannot change the %s-reveal live projection', (when) => {
  const session = started();
  const news = session.market.days[0]?.news;
  if (news === undefined) throw new Error('missing first day');
  const first = Math.min(...news.map((item) => item.hidden.revealIndex));
  const step = 300 + (when === 'before' ? first - 1 : first);
  const altered = scrambleFuture(session, step);
  const current = publicFrame(session, step);
  expect(current.news.filter((item) => item.revealed)).toHaveLength(when === 'before' ? 0 : 1);
  expect(publicFrame(altered, step)).toEqual(current);
  expectPublicOnly(current);
  // Positive controls: the transformation really changes tomorrow and the
  // very next price, while leaving the current public picture untouched.
  expect(publicFrame(altered, step + 1).prices).not.toEqual(publicFrame(session, step + 1).prices);
  expect(publicFrame(altered, 1200).news).not.toEqual(publicFrame(session, 1200).news);
});

it.each([0, 300, 800, 4500])('keeps outcomes and unrelated sections absent at step %s', (step) => {
  const frame = publicFrame(started(), step);
  expect(frame.news).toHaveLength(3);
  expectPublicOnly(frame);
  if (step >= 800) expect(frame.news.every((news) => news.revealed)).toBe(true);
});

it.each([undefined, 2500])('delivers the passed reveal on samples and resuming hello (board %s)', async (board) => {
  const harness = await startHarness({ sweepMs: 0 });
  try {
    const client = harness.connect();
    await client.opened();
    client.send({ t: 'hello', v: PROTOCOL_VERSION, ...(board === undefined ? {} : { board }) });
    const lobby = await client.nextFrame();
    client.send({ t: 'start', commandId: 'start-news', pace: 1 });
    await client.nextReply();
    harness.clock.advance(140000); // 700 steps: open index 400, all reveals have passed.
    harness.sample();
    const revealed = await client.nextFrame();
    expect(revealed.news).toHaveLength(3);
    expect(revealed.news.every((news) => news.revealed)).toBe(true);
    expectPublicOnly(revealed);
    await client.close();
    const resumed = harness.connect();
    await resumed.opened();
    resumed.send({ t: 'hello', v: PROTOCOL_VERSION, session: lobby.session, ...(board === undefined ? {} : { board }) });
    expect(await resumed.nextFrame()).toEqual(revealed);
  } finally {
    await harness.close();
  }
});
