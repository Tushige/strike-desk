import { describe, expect, it } from 'vitest';
import { isTradable } from '../src/pricing';
import type { Session } from '../src/session';
import { createSession, frameFor, handleCommand, sessionStep } from '../src/session';
import { TEST_IDENTITY, buyCommand, clockCommand, findContract, priceOf, start } from './helpers';

const T0 = 1_700_000_000_000;

function startedSession(pace: 1 | 3 | 7.5 = 1): Session {
  const handled = handleCommand(createSession('s1', TEST_IDENTITY), start(pace), T0);
  expect(handled.receipt.outcome).toBe('accepted');
  return handled.session;
}

describe('session', () => {
  it('waits in the lobby at step 0 however much time passes', () => {
    const session = createSession('s1', TEST_IDENTITY);
    expect(session.clock).toBeNull();
    expect(sessionStep(session, T0)).toBe(0);
    expect(sessionStep(session, T0 + 3_600_000)).toBe(0);
    const { frame, session: same } = frameFor(session, T0 + 3_600_000, { history: true });
    expect(frame.clock.phase).toBe('lobby');
    expect(frame.session).toBe('s1');
    expect(same).toBe(session);
  });

  it('makes a board of the wanted size', () => {
    const session = createSession('big', TEST_IDENTITY, { targetsPerCompany: 209 });
    expect(session.game.stress).toBe(true);
    expect(frameFor(startedSession(), T0, { history: false }).frame.quotes).toHaveLength(252);
    expect(frameFor(handleCommand(session, start(1), T0).session, T0, { history: false }).frame.quotes).toHaveLength(2508);
  });

  it('starts the clock at the moment of an accepted start', () => {
    const lobby = createSession('s1', TEST_IDENTITY);
    const session = startedSession(3);
    expect(lobby.clock).toBeNull();
    expect(session.clock).toEqual({ pace: 3, anchorMs: T0, anchorStep: 0 });
    expect(sessionStep(session, T0)).toBe(0);
    expect(sessionStep(session, T0 + 1_000)).toBe(15);
    expect(sessionStep(session, T0 + 60_000)).toBe(900);
  });

  it('keeps the first clock when start is sent again', () => {
    const session = startedSession(1);
    const handled = handleCommand(session, start(7.5), T0 + 5_000);
    expect(handled.receipt).toMatchObject({ outcome: 'rejected', reason: 'alreadyStarted', step: 25 });
    expect(handled.session.clock).toEqual(session.clock);
  });

  it('re-anchors on a jump so time continues from the jump target', () => {
    const session = startedSession(1);
    const handled = handleCommand(session, clockCommand('openBell', 1), T0 + 2_000);
    expect(handled.receipt).toMatchObject({ outcome: 'accepted', step: 10 });
    expect(handled.session.clock).toEqual({ pace: 1, anchorMs: T0 + 2_000, anchorStep: 300 });
    expect(sessionStep(handled.session, T0 + 2_000)).toBe(300);
    expect(sessionStep(handled.session, T0 + 2_400)).toBe(302);
    expect(session.clock).toEqual({ pace: 1, anchorMs: T0, anchorStep: 0 });
  });

  it('does not re-anchor on a refused jump or a repeat', () => {
    const session = startedSession(1);
    const refused = handleCommand(session, clockCommand('skipToBell', 1), T0 + 2_000);
    expect(refused.receipt.outcome).toBe('rejected');
    expect(refused.session.clock).toEqual(session.clock);

    const jump = clockCommand('openBell', 1);
    const first = handleCommand(session, jump, T0 + 2_000);
    const again = handleCommand(first.session, jump, T0 + 9_000);
    expect(again.repeat).toBe(true);
    expect(again.receipt).toBe(first.receipt);
    expect(again.session).toBe(first.session);
  });

  it('never steps back if the wall clock does', () => {
    const jumped = handleCommand(startedSession(1), clockCommand('openBell', 1), T0 + 2_000).session;
    expect(sessionStep(jumped, T0)).toBe(300);
  });

  it('settles at the bell when a frame is asked for, and leaves its input alone', () => {
    const opened = handleCommand(startedSession(1), clockCommand('openBell', 1), T0).session;
    const market = opened.market;
    const contract = findContract(market, 1, (id) => isTradable(priceOf(market, 1, 5, id)));
    const buy = buyCommand({ day: 1, contractId: contract, spendCents: 10_000_000, seenPriceCents: priceOf(market, 1, 5, contract) });
    const held = handleCommand(opened, buy, T0 + 1_000).session;
    expect(held.game.positions[0]).toMatchObject({ entryStep: 305, entryPriceIndex: 5 });

    const before = frameFor(held, T0 + 99_999, { history: false });
    expect(before.frame.step).toBe(799);
    expect(before.frame.positions[0]?.status).toBe('open');

    const atBell = frameFor(held, T0 + 100_000, { history: false });
    expect(atBell.frame.step).toBe(800);
    expect(atBell.frame.clock.phase).toBe('debrief');
    expect(atBell.frame.positions[0]?.status).toBe('settled');
    expect(atBell.frame.rev).toBe(held.game.rev + 1);
    expect(atBell.frame.account.cashCents).toBe(held.game.cashCents + priceOf(market, 1, 500, contract) * (held.game.positions[0]?.quantity ?? NaN));
    expect(atBell.session.game.dayEndCents).toEqual([atBell.frame.account.cashCents]);
    expect(held.game.dayEndCents).toEqual([]);

    const later = frameFor(atBell.session, T0 + 100_000, { history: false });
    expect(later.session).toBe(atBell.session);
    expect(later.frame).toEqual(atBell.frame);
  });

  it('reaches the final screen and stays there', () => {
    const { frame } = frameFor(startedSession(7.5), T0 + 10_000_000, { history: false });
    expect(frame.step).toBe(4500);
    expect(frame.clock.phase).toBe('final');
    expect(frame.final).toBeDefined();
  });
});
