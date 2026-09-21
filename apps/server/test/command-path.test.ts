import { describe, expect, it } from 'vitest';
import {
  BUY_TOLERANCE_BPS,
  BUY_TOLERANCE_FLOOR_CENTS,
  applyCommand,
  isOffered,
  playerOf,
  replySchema,
  seedToMarketCode,
  spendCapCents,
  toleranceLimitCents,
} from '@strike-desk/shared/engine';
import type { Command, DraftRequest, Frame, Session } from '@strike-desk/shared/engine';
import { handle } from '../src/modules/command-path/index';
import type { Handled } from '../src/modules/command-path/index';
import { PLAYER, T0, closeUp, frameAt, msAtStep, newId, sessionAt, tradableTicket } from './contracts/sessionAt';

/**
 * The command path's own cases, on the same fixed game the contract suite
 * stands on.
 *
 * What lives where. The contract suite (`contracts/commandPath.contract.ts`)
 * holds the laws any command path obeys: explicit outcomes, the bell rule, the
 * id deciding, the fill at the server's price and the edges of the tolerance
 * on the fixed game's own quotes, one ticket a day, the cap, the draft's
 * quote. This file holds what belongs to this block: safe retries told as the
 * three stories a dropped connection produces, the path touching nothing it
 * was handed, the input log played again, the rounding of the tolerance and
 * of the cap as typed-in numbers, and a search of the reply for anything that
 * would make the market's future computable.
 *
 * No case names a share price, a ticket price or a quantity of the fixed
 * game. The money typed in is the starting cash and what a case spends; every
 * other amount is read off the same reply it is compared with.
 *
 * Newly stored refusals move revision and enter the input log once, just
 * like accepted commands; duplicate IDs preserve their original receipts.
 */

const STARTING_CASH = 100_000_000;
const SPEND = 10_000_000;
/** The fixed game's market, as `contracts/sessionAt.ts` builds it. No live game uses it. */
const SEED = 4242424242;

function send(session: Session, command: Command, nowMs: number, draft: DraftRequest | null = null): Handled {
  return handle({ session, playerId: PLAYER, command, nowMs, draft });
}

function buy(ticket: { contractId: number; priceCents: number }, day = 1): Command {
  return { t: 'buy', commandId: newId(), day, contractId: ticket.contractId, spendCents: SPEND, seenPriceCents: ticket.priceCents };
}

function onlyTicket(frame: Frame): Frame['positions'][number] {
  expect(frame.positions).toHaveLength(1);
  const position = frame.positions[0];
  if (position === undefined) throw new Error('the frame holds no ticket');
  return position;
}

/**
 * A buy, already handled, of a ticket the closing bell goes on to pay
 * something for. Most tickets of a day end worth nothing, and a case about
 * money being paid once proves nothing on a ticket that pays $0: paying
 * nothing twice looks the same as paying nothing once. Which ticket pays is
 * not typed in. A session is never changed by being used, so each ticket the
 * board offers is simply tried, and the first whose own settlement pays is
 * kept. Throws when the day has none, so the cases that need one fail loudly.
 */
function boughtTicketTheBellPays(): { afterBuy: Handled; command: Command } {
  const { session, nowMs } = sessionAt('open');
  const frame = frameAt(session, nowMs);
  const board = frame.board;
  if (board === null) throw new Error('this frame has no board to pick a ticket from');
  for (let id = 0; id < frame.quotes.length; id += 1) {
    const priceCents = frame.quotes[id];
    if (priceCents === undefined || priceCents < frame.minTicketCents || !isOffered(board, id)) continue;
    const command = buy({ contractId: id, priceCents });
    const afterBuy = send(session, command, nowMs);
    if (afterBuy.reply.receipt.outcome !== 'accepted') continue;
    const atTheBell = frameAt(afterBuy.session, msAtStep(810)).positions[0]?.exit;
    if (atTheBell?.kind === 'bell' && atTheBell.proceedsCents > 0) return { afterBuy, command };
  }
  throw new Error('no ticket of the fixed day pays anything at the bell');
}

/** Freeze a value and everything it holds, so that any write to it throws. */
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value)) deepFreeze(inner, seen);
  return Object.freeze(value);
}

describe('safe retries: what a dropped connection can do to one buy', () => {
  it('the reply was lost: the same command comes again and gets the first receipt, one ticket, cash charged once', () => {
    const { session, nowMs } = sessionAt('open');
    const command = buy(closeUp(frameAt(session, nowMs)));

    // The server handled it and kept the session; the reply never reached the page.
    const first = send(session, command, nowMs);
    expect(first.reply.receipt.outcome).toBe('accepted');
    expect(first.repeat).toBe(false);

    // Three seconds later the page sends the very same command again.
    const again = send(first.session, command, nowMs + 3_000);

    expect(again.repeat).toBe(true);
    expect(again.reply.receipt).toEqual(first.reply.receipt);
    // Nothing of the player's was touched: the account is the very same object,
    // with its one receipt and its log as they were.
    expect(playerOf(again.session.game, PLAYER)).toBe(playerOf(first.session.game, PLAYER));
    // Only the game's step moved on with the clock: 3,000 ms is 15 steps of 200 ms, from step 400.
    expect(again.session.game.step).toBe(415);

    const ticket = onlyTicket(again.reply.frame);
    expect(ticket.id).toBe('d1');
    expect(again.reply.frame.account.cashCents).toBe(STARTING_CASH - ticket.costCents);
    expect(again.reply.frame.rev).toBe(first.reply.frame.rev);
  });

  it('the reply was lost and the resend arrives after the bell: the session handed back holds the money the reply shows', () => {
    const { afterBuy: first, command } = boughtTicketTheBellPays();

    // The connection stays down past the closing bell; the resend lands at step 810, in the debrief.
    const again = send(first.session, command, msAtStep(810));

    expect(again.repeat).toBe(true);
    expect(again.reply.receipt).toEqual(first.reply.receipt);
    // The bell paid the ticket while the page was away, and the reply says so...
    const ticket = onlyTicket(again.reply.frame);
    expect(ticket.exit?.kind).toBe('bell');
    expect(ticket.exit?.proceedsCents).toBeGreaterThan(0);
    const cashAfterBell = first.reply.frame.account.cashCents + (ticket.exit?.proceedsCents ?? NaN);
    expect(again.reply.frame.account.cashCents).toBe(cashAfterBell);
    // ...and the session to keep is the one that was paid, not the one from before the bell.
    const kept = playerOf(again.session.game, PLAYER);
    expect(kept.cashCents).toBe(cashAfterBell);
    expect(kept.dayEndCents).toEqual([cashAfterBell]);
    expect(kept.receipts).toEqual(playerOf(first.session.game, PLAYER).receipts);
  });

  it('the command never arrived: it comes once, late, and is accepted once', () => {
    // Before the bell, where prices stand still, so that the only thing the
    // three seconds change is when the command arrives.
    const { session, nowMs } = sessionAt('beforeBell');
    const command = buy(closeUp(frameAt(session, nowMs)));

    // The first sending was lost on the way: the server never saw it. The resend is the first it hears.
    const late = send(session, command, nowMs + 3_000);

    expect(late.repeat).toBe(false);
    // Step 10, and 3,000 ms later: 10 + 15.
    expect(late.reply.receipt).toEqual({ commandId: command.commandId, kind: 'buy', step: 25, outcome: 'accepted', positionId: 'd1' });
    const ticket = onlyTicket(late.reply.frame);
    expect(late.reply.frame.account.cashCents).toBe(STARTING_CASH - ticket.costCents);

    // And should the page send it a third time, it is a repeat like any other.
    const again = send(late.session, command, nowMs + 6_000);
    expect(again.repeat).toBe(true);
    expect(onlyTicket(again.reply.frame)).toMatchObject({ id: 'd1', quantity: ticket.quantity, costCents: ticket.costCents });
    expect(again.reply.frame.account.cashCents).toBe(STARTING_CASH - ticket.costCents);
  });

  it('the same command on two sockets in one tick: the second is a repeat and changes nothing at all', () => {
    const { session, nowMs } = sessionAt('open');
    const command = buy(closeUp(frameAt(session, nowMs)));

    const first = send(session, command, nowMs);
    const second = send(first.session, command, nowMs);

    expect(first.repeat).toBe(false);
    expect(second.repeat).toBe(true);
    expect(second.reply.receipt).toEqual(first.reply.receipt);
    // Same clock reading, so not even the step moved: the very session comes back.
    expect(second.session).toBe(first.session);
    const ticket = onlyTicket(second.reply.frame);
    expect(second.reply.frame.account.cashCents).toBe(STARTING_CASH - ticket.costCents);
    expect(playerOf(second.session.game, PLAYER).receipts).toHaveLength(2); // the start, and the one buy
  });
});

describe('the path changes nothing it was handed', () => {
  it('handles a command on a session frozen all the way down, and hands back another session', () => {
    const { session, nowMs } = sessionAt('open');
    const command = buy(closeUp(frameAt(session, nowMs)));
    deepFreeze(session);

    const handled = send(session, command, nowMs);

    expect(handled.reply.receipt.outcome).toBe('accepted');
    expect(handled.session).not.toBe(session);
    expect(playerOf(session.game, PLAYER).positions).toEqual([]);
    expect(playerOf(session.game, PLAYER).cashCents).toBe(STARTING_CASH);
  });

  it('answers a repeat on a frozen session too', () => {
    const { session, nowMs } = sessionAt('open');
    const command = buy(closeUp(frameAt(session, nowMs)));
    const first = send(session, command, nowMs);
    deepFreeze(first.session);

    expect(send(first.session, command, nowMs + 3_000).repeat).toBe(true);
  });
});

describe('who the command is for', () => {
  it('throws on a player the session does not hold: a fault in the wiring, not an outcome of a command', () => {
    const { session, nowMs } = sessionAt('open');
    const command = buy(closeUp(frameAt(session, nowMs)));

    expect(() => handle({ session, playerId: 'somebody-else', command, nowMs, draft: null })).toThrow('no such player: somebody-else');
    // And nothing was done in anybody's name on the way to finding that out.
    expect(playerOf(session.game, PLAYER).receipts).toHaveLength(1); // the start
    expect(playerOf(session.game, PLAYER).cashCents).toBe(STARTING_CASH);
  });
});

describe('the input log', () => {
  it('stores each new refused clock input once and replays its authoritative arrival step', () => {
    const { session, nowMs } = sessionAt('beforeBell');
    const command: Command = { t: 'nextDay', commandId: 'early-next-day', day: 1 };
    const first = send(session, command, nowMs);
    expect(first.reply.receipt).toEqual({ commandId: command.commandId, kind: 'nextDay', step: 10, outcome: 'rejected', reason: 'wrongPhase' });
    expect(first.reply.frame.rev).toBe(2); // One Start outcome, one refused Next day.
    // At step 950 day two has begun. A retry keeps the first receipt while
    // the returned session catches up through day one's closing bell.
    const again = send(first.session, command, msAtStep(950));
    expect(again.repeat).toBe(true);
    expect(again.reply.receipt).toEqual(first.reply.receipt);
    expect(again.session.game.step).toBe(950);
    expect(again.reply.frame.rev).toBe(2);
    expect(again.reply.frame.days).toEqual([{ day: 1, startCents: 100000000, endCents: 100000000, changeCents: 0 }]);
    expect(playerOf(again.session.game, PLAYER).log).toEqual(playerOf(first.session.game, PLAYER).log);
    const wrongDay = send(again.session, { ...command, commandId: 'late-next-day' }, msAtStep(950));
    expect(wrongDay.reply.receipt).toMatchObject({ step: 950, reason: 'wrongDay' });
    expect(wrongDay.reply.frame.rev).toBe(3);
    const wrongPhase = send(wrongDay.session, { ...command, commandId: 'new-next-day', day: 2 }, msAtStep(950));
    expect(wrongPhase.reply.receipt).toMatchObject({ step: 950, reason: 'wrongPhase' });
    expect(wrongPhase.reply.frame.rev).toBe(4);
    const log = playerOf(wrongPhase.session.game, PLAYER).log;
    expect(log.map((input) => input.step)).toEqual([0, 10, 950, 950]);
    const fresh = sessionAt('lobby').session;
    let replayed = fresh.game;
    for (const input of log) replayed = applyCommand(fresh.market, replayed, PLAYER, input.command, input.step).game;
    expect(replayed).toEqual(wrongPhase.session.game);
  });

  it('holds every command that was not a repeat, with its step, and plays again to the same accounts', () => {
    const lobby = sessionAt('lobby');
    let session = lobby.session;
    const sent: { command: Command; repeat: boolean }[] = [];
    function play(command: Command, nowMs: number): Handled {
      const handled = send(session, command, nowMs);
      session = handled.session;
      sent.push({ command, repeat: handled.repeat });
      return handled;
    }

    // A day with every kind of thing in it: a start, a buy, the same buy
    // again, a second buy that is refused, a cash-out in the open market, a
    // skip to the bell and the next day.
    play({ t: 'start', commandId: newId(), pace: 1 }, T0);
    const firstBuy = buy(closeUp(frameAt(session, msAtStep(10))));
    expect(play(firstBuy, msAtStep(10)).reply.receipt.outcome).toBe('accepted');
    expect(play(firstBuy, msAtStep(25)).repeat).toBe(true);
    expect(play(buy(closeUp(frameAt(session, msAtStep(40)))), msAtStep(40)).reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'alreadyBought' });
    expect(play({ t: 'cashOut', commandId: newId(), positionId: 'd1' }, msAtStep(350)).reply.receipt.outcome).toBe('accepted');
    expect(play({ t: 'skipToBell', commandId: newId(), day: 1 }, msAtStep(360)).reply.receipt.outcome).toBe('accepted');
    // The skip put the game at the bell, step 800, at that clock reading. Two seconds on is step 810, in the debrief.
    expect(play({ t: 'nextDay', commandId: newId(), day: 1 }, msAtStep(360) + 2_000).reply.receipt.outcome).toBe('accepted');

    const log = playerOf(session.game, PLAYER).log;
    // Six of the seven: all but the repeat, in the order they came, the refused one included.
    expect(log.map((entry) => entry.step)).toEqual([0, 10, 40, 350, 360, 810]);
    expect(log.map((entry) => entry.command)).toEqual(sent.filter((one) => !one.repeat).map((one) => one.command));

    // The log and the market are enough: a fresh game of the same market, fed
    // the log step by step, ends with the very same accounts.
    const fresh = sessionAt('lobby').session;
    let replayed = fresh.game;
    for (const entry of log) {
      replayed = applyCommand(fresh.market, replayed, PLAYER, entry.command, entry.step).game;
    }
    expect(replayed.players).toEqual(session.game.players);
    expect(replayed.step).toBe(session.game.step);
  });
});

describe('the rounding the path relies on, typed in', () => {
  it('measures the tolerance with the two numbers the game states', () => {
    // 2% is 200 basis points; the floor is $1.
    expect(BUY_TOLERANCE_BPS).toBe(200);
    expect(BUY_TOLERANCE_FLOOR_CENTS).toBe(100);
  });

  it.each([
    // 2% of 11,800 is 236, larger than the floor of 100: 11,800 + 236.
    [11_800, 12_036],
    // 2% of 12,345 is 246.9; whole cents only, so 246: 12,345 + 246.
    [12_345, 12_591],
    // 2% of 3,000 is 60; the floor of 100 is larger: 3,000 + 100.
    [3_000, 3_100],
    // 2% of 5,000 is 100, the same as the floor: 5,000 + 100.
    [5_000, 5_100],
  ])('a buy that saw %i cents fills at up to %i cents', (seen, limit) => {
    expect(toleranceLimitCents(seen)).toBe(limit);
  });

  it('caps a spend at half the cash, rounded down to whole thousands of dollars', () => {
    // Half of 95,008,600 is 47,504,300; down to a multiple of 100,000 cents.
    expect(spendCapCents(95_008_600)).toBe(47_500_000);
  });
});

describe('what a reply gives away', () => {
  const code = seedToMarketCode(SEED);
  const codeWithoutDashes = code.replace(/-/g, '');

  it('searches for a market number of the right form', () => {
    // A search for the wrong string would pass for the wrong reason: ten
    // characters from the look-alike-free alphabet, grouped 3-3-4.
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/);
    expect(codeWithoutDashes).toHaveLength(10);
  });

  it.each(['beforeBell', 'open', 'debrief'] as const)('holds neither the seed nor the market number, with a draft quoted, at the moment %s', (moment) => {
    const { session, nowMs } = sessionAt(moment);
    const ticket = tradableTicket(frameAt(session, nowMs));

    // Accepted before the bell and in the open market, refused in the debrief: a reply either way.
    const { reply } = send(session, buy(ticket), nowMs, { contractId: ticket.contractId, spendCents: SPEND });

    const text = JSON.stringify(reply);
    expect({
      moment,
      seedInDecimal: text.includes(String(SEED)),
      marketNumber: text.includes(code),
      marketNumberWithoutDashes: text.includes(codeWithoutDashes),
      theFieldName: text.includes('marketCode'),
    }).toEqual({ moment, seedInDecimal: false, marketNumber: false, marketNumberWithoutDashes: false, theFieldName: false });
    expect(replySchema.safeParse(JSON.parse(text)).success).toBe(true);
  });
});

describe('a cash-out that arrives after the bell', () => {
  it('sent three times with three new ids, leaves the cash exactly where the bell put it', () => {
    const { afterBuy: bought } = boughtTicketTheBellPays();

    // What the bell alone does, with nobody pressing anything: step 810, in the debrief.
    const debrief = msAtStep(810);
    const settled = frameAt(bought.session, debrief);
    const paid = onlyTicket(settled).exit;
    expect(paid?.kind).toBe('bell');
    // A payment worth counting: were it made twice, the cash below would show it.
    expect(paid?.proceedsCents).toBeGreaterThan(0);
    expect(settled.account.cashCents).toBe(bought.reply.frame.account.cashCents + (paid?.proceedsCents ?? NaN));

    let session = bought.session;
    for (const afterMs of [0, 1_000, 2_000]) {
      const pressed = send(session, { t: 'cashOut', commandId: newId(), positionId: 'd1' }, debrief + afterMs);
      session = pressed.session;
      expect(pressed.repeat).toBe(false);
      expect(pressed.reply.frame.account.cashCents).toBe(settled.account.cashCents);
      expect(onlyTicket(pressed.reply.frame).exit).toEqual(paid);
    }
    expect(playerOf(session.game, PLAYER).dayEndCents).toEqual([settled.account.cashCents]);
  });
});
