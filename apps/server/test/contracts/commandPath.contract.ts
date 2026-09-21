import { describe, expect, it } from 'vitest';
import { BELL_STEP_IN_DAY, contractId, playerOf, replySchema } from '@strike-desk/shared/engine';
import type { Command, DraftRequest, Frame, Session } from '@strike-desk/shared/engine';
import type { HandleCommand, Handled } from '../../src/modules/command-path/index';
import { PLAYER, closeUp, frameAt, msAtStep, newId, sessionAt } from './sessionAt';

/**
 * What any command path must do, whatever is behind it. Every case stands on
 * the same fixed game at a named moment and sends schema-valid commands with
 * fresh ids.
 *
 * No case names a ticket price, a share price or a quantity of that game:
 * the expected values are rules between numbers of the same reply, and codes.
 * The only money typed in here is the starting cash, what a case spends, and
 * how far a case's claimed price is from the real one.
 *
 * Left open on purpose, so nothing here says either way: whether a refused
 * command moves the revision, and whether a refused command is logged.
 *
 * This file is not a test file by itself: a test file names the command path
 * to try and calls `describeCommandPathContract`.
 */

const STARTING_CASH = 100_000_000;
const SPEND = 10_000_000;
type PositionOnFrame = Frame['positions'][number];

export function describeCommandPathContract(name: string, handle: HandleCommand): void {
  /**
   * One command through the path. Every answer, in every case, is checked to
   * be explicit: it fits the wire's reply shape, it answers the command that
   * was sent, and it carries a reason exactly when it refuses.
   */
  function send(session: Session, command: Command, nowMs: number, draft: DraftRequest | null = null): Handled {
    const handled = handle({ session, playerId: PLAYER, command, nowMs, draft });
    const { receipt } = handled.reply;
    expect(replySchema.safeParse(handled.reply).success).toBe(true);
    expect(receipt.commandId).toBe(command.commandId);
    expect(receipt.kind).toBe(command.t);
    expect(['accepted', 'rejected']).toContain(receipt.outcome);
    if (receipt.outcome === 'rejected') expect(receipt.reason).toBeDefined();
    else expect(receipt.reason).toBeUndefined();
    return handled;
  }

  function buy(ticket: { contractId: number; priceCents: number }, fields: { spendCents?: number; seenPriceCents?: number; commandId?: string; day?: number } = {}): Command {
    return {
      t: 'buy',
      commandId: fields.commandId ?? newId(),
      day: fields.day ?? 1,
      contractId: ticket.contractId,
      spendCents: fields.spendCents ?? SPEND,
      seenPriceCents: fields.seenPriceCents ?? ticket.priceCents,
    };
  }

  function cashOut(positionId: string): Command {
    return { t: 'cashOut', commandId: newId(), positionId };
  }

  function onlyPosition(frame: Frame): PositionOnFrame {
    expect(frame.positions).toHaveLength(1);
    const position = frame.positions[0];
    if (position === undefined) throw new Error('the frame holds no ticket');
    return position;
  }

  /** The fixed game with today's ticket bought while the market is open. */
  function holding(): { session: Session; nowMs: number; afterBuy: Frame } {
    const { session, nowMs } = sessionAt('open');
    const bought = send(session, buy(closeUp(frameAt(session, nowMs))), nowMs);
    expect(bought.reply.receipt.outcome).toBe('accepted');
    return { session: bought.session, nowMs, afterBuy: bought.reply.frame };
  }

  describe(`the command path contract: ${name}`, () => {
    it('starts the game from the lobby, once', () => {
      const { session, nowMs } = sessionAt('lobby');

      const started = send(session, { t: 'start', commandId: newId(), pace: 1 }, nowMs);
      expect(started.reply.receipt.outcome).toBe('accepted');
      expect(started.repeat).toBe(false);
      expect(started.reply.frame.clock).toMatchObject({ phase: 'preBell', day: 1 });

      const again = send(started.session, { t: 'start', commandId: newId(), pace: 1 }, nowMs + 1_000);
      expect(again.reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'alreadyStarted' });
    });

    it('accepts a buy before the bell and answers with the whole picture after it', () => {
      const { session, nowMs } = sessionAt('beforeBell');
      const before = frameAt(session, nowMs);

      const { reply, repeat } = send(session, buy(closeUp(before)), nowMs);

      expect(repeat).toBe(false);
      expect(reply.receipt).toMatchObject({ outcome: 'accepted', kind: 'buy', positionId: 'd1' });
      const position = onlyPosition(reply.frame);
      expect(position.quantity).toBeGreaterThanOrEqual(1);
      expect(position.costCents).toBe(position.entryPriceCents * position.quantity);
      expect(position.costCents).toBeLessThanOrEqual(SPEND);
      expect(reply.frame.account.cashCents).toBe(STARTING_CASH - position.costCents);
      expect(reply.frame.account.canBuy).toBe(false);
      expect(reply.frame.rev).toBeGreaterThan(before.rev);
      expect(reply.frame.history).toBeDefined();
    });

    it('leaves the session it was handed exactly as it was', () => {
      const { session, nowMs } = sessionAt('open');
      const before = frameAt(session, nowMs);

      send(session, buy(closeUp(before)), nowMs);

      expect(frameAt(session, nowMs)).toEqual(before);
      expect(playerOf(session.game, PLAYER).log).toHaveLength(1);
    });

    it('answers a repeated command with the first receipt and changes nothing', () => {
      const { session, nowMs } = sessionAt('open');
      const command = buy(closeUp(frameAt(session, nowMs)));
      const first = send(session, command, nowMs);
      expect(first.reply.receipt.outcome).toBe('accepted');

      const later = nowMs + 1_000;
      const pictureBefore = frameAt(first.session, later);
      const logBefore = playerOf(first.session.game, PLAYER).log.length;
      const again = send(first.session, command, later);

      expect(again.repeat).toBe(true);
      expect(again.reply.receipt).toEqual(first.reply.receipt);
      const pictureAfter = frameAt(again.session, later);
      expect(pictureAfter.rev).toBe(pictureBefore.rev);
      expect(pictureAfter.account.cashCents).toBe(pictureBefore.account.cashCents);
      expect(pictureAfter.positions).toEqual(pictureBefore.positions);
      expect(pictureAfter.receipts).toEqual(pictureBefore.receipts);
      expect(playerOf(again.session.game, PLAYER).log.length).toBeLessThanOrEqual(logBefore);
    });

    it('goes by the command id alone: the same id with another ticket and twice the spend is still the first command', () => {
      const { session, nowMs } = sessionAt('open');
      const picture = frameAt(session, nowMs);
      const command = buy(closeUp(picture));
      const first = send(session, command, nowMs);
      const bought = onlyPosition(first.reply.frame);

      const board = picture.board;
      const otherTarget = board?.companies[1]?.simpleUp[0];
      if (board === null || otherTarget === undefined) throw new Error('the board has no second company');
      const other = contractId(board.targetsPerCompany, { companyId: 1, targetIndex: otherTarget, side: 'up' });
      const otherPrice = picture.quotes[other];
      if (otherPrice === undefined) throw new Error('the second company has no price');
      expect(other).not.toBe(bought.contractId);

      const again = send(first.session, buy({ contractId: other, priceCents: Math.max(otherPrice, 100) }, { commandId: command.commandId, spendCents: SPEND * 2 }), nowMs + 1_000);

      expect(again.repeat).toBe(true);
      expect(again.reply.receipt).toEqual(first.reply.receipt);
      expect(onlyPosition(again.reply.frame)).toMatchObject({ contractId: bought.contractId, quantity: bought.quantity, costCents: bought.costCents });
    });

    it('refuses a spend over the cap without touching what the player owns, and the day can still be played', () => {
      const { session, nowMs } = sessionAt('open');
      const before = frameAt(session, nowMs);

      const refused = send(session, buy(closeUp(before), { spendCents: before.account.capCents + 100_000 }), nowMs);

      expect(refused.reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'overCap' });
      expect(refused.reply.frame.account.cashCents).toBe(before.account.cashCents);
      expect(refused.reply.frame.positions).toEqual([]);

      const later = nowMs + 1_000;
      const accepted = send(refused.session, buy(closeUp(frameAt(refused.session, later))), later);
      expect(accepted.reply.receipt.outcome).toBe('accepted');
      onlyPosition(accepted.reply.frame);
    });

    it('sells one ticket a day', () => {
      const { session, nowMs, afterBuy } = holding();

      const later = nowMs + 1_000;
      const second = send(session, buy(closeUp(frameAt(session, later))), later);

      expect(second.reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'alreadyBought' });
      expect(second.reply.frame.account.cashCents).toBe(afterBuy.account.cashCents);
      onlyPosition(second.reply.frame);
    });

    describe('the price the player saw', () => {
      it('fills when the price rose by $1 since', () => {
        const { session, nowMs } = sessionAt('open');
        const ticket = closeUp(frameAt(session, nowMs));
        // The fixed game's ticket has to be dear enough for the three claims below to be valid prices.
        expect(ticket.priceCents).toBeGreaterThanOrEqual(300);

        const { reply } = send(session, buy(ticket, { seenPriceCents: ticket.priceCents - 100 }), nowMs);

        expect(reply.receipt.outcome).toBe('accepted');
        expect(onlyPosition(reply.frame).entryPriceCents).toBe(ticket.priceCents);
      });

      it('refuses when the price has doubled since', () => {
        const { session, nowMs } = sessionAt('open');
        const before = frameAt(session, nowMs);
        const ticket = closeUp(before);
        expect(ticket.priceCents).toBeGreaterThanOrEqual(300);

        const { reply } = send(session, buy(ticket, { seenPriceCents: Math.floor(ticket.priceCents / 2) }), nowMs);

        expect(reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'priceMoved' });
        expect(reply.frame.positions).toEqual([]);
        expect(reply.frame.account.cashCents).toBe(before.account.cashCents);
      });

      it('fills at the server price, never at the price claimed', () => {
        const { session, nowMs } = sessionAt('open');
        const ticket = closeUp(frameAt(session, nowMs));

        const { reply } = send(session, buy(ticket, { seenPriceCents: ticket.priceCents + 5_000 }), nowMs);

        expect(reply.receipt.outcome).toBe('accepted');
        const position = onlyPosition(reply.frame);
        expect(position.entryPriceCents).toBe(ticket.priceCents);
        expect(position.costCents).toBe(ticket.priceCents * position.quantity);
      });
    });

    describe('the bell rule: the step the command arrives at decides', () => {
      // A ticket can be worth nothing at the bell, and a command has to name a price above zero.
      const claimable = (ticket: { contractId: number; priceCents: number }) => ({ ...ticket, priceCents: Math.max(ticket.priceCents, 100) });

      it('does not call the market closed one step before the bell', () => {
        const { session, nowMs } = sessionAt('lastOpenStep');

        const { reply } = send(session, buy(claimable(closeUp(frameAt(session, nowMs)))), nowMs);

        expect(reply.receipt.step).toBe(BELL_STEP_IN_DAY - 1);
        expect(reply.receipt.reason).not.toBe('marketClosed');
      });

      it.each([
        ['at the bell', BELL_STEP_IN_DAY],
        ['one step after it', BELL_STEP_IN_DAY + 1],
      ])('refuses a buy %s', (_when, step) => {
        const { session } = sessionAt('atBell');
        const nowMs = msAtStep(step);
        const before = frameAt(session, nowMs);

        const { reply } = send(session, buy(claimable(closeUp(before))), nowMs);

        expect(reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'marketClosed', step });
        expect(reply.frame.positions).toEqual([]);
        expect(reply.frame.account.cashCents).toBe(before.account.cashCents);
      });
    });

    it('cashes out while the market is open, once', () => {
      const { session, nowMs, afterBuy } = holding();
      const bought = onlyPosition(afterBuy);

      const later = nowMs + 10_000;
      const sold = send(session, cashOut(bought.id), later);

      expect(sold.reply.receipt).toMatchObject({ outcome: 'accepted', kind: 'cashOut', positionId: bought.id });
      const position = onlyPosition(sold.reply.frame);
      expect(position.status).toBe('cashedOut');
      expect(position.exit?.kind).toBe('cashOut');
      const proceeds = position.exit?.proceedsCents ?? NaN;
      expect(sold.reply.frame.account.cashCents).toBe(afterBuy.account.cashCents + proceeds);
      expect(position.profitCents).toBe(proceeds - position.costCents);

      const again = send(sold.session, cashOut(bought.id), later + 1_000);
      expect(again.reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'alreadyClosed' });
      expect(again.reply.frame.account.cashCents).toBe(sold.reply.frame.account.cashCents);
    });

    it.each([
      ['at the bell', BELL_STEP_IN_DAY],
      ['after the bell', BELL_STEP_IN_DAY + 10],
    ])('settles a cash-out that arrives %s at the bell value, and pays it once', (_when, step) => {
      const { session, afterBuy } = holding();
      const bought = onlyPosition(afterBuy);

      const nowMs = msAtStep(step);
      const late = send(session, cashOut(bought.id), nowMs);

      expect(late.reply.receipt.outcome).toBe('accepted');
      const position = onlyPosition(late.reply.frame);
      expect(position.status).toBe('settled');
      expect(position.exit?.kind).toBe('bell');
      const proceeds = position.exit?.proceedsCents ?? NaN;
      expect(late.reply.frame.account.cashCents).toBe(afterBuy.account.cashCents + proceeds);
      expect(position.profitCents).toBe(proceeds - position.costCents);

      const again = send(late.session, cashOut(bought.id), nowMs + 1_000);
      expect(again.reply.frame.account.cashCents).toBe(late.reply.frame.account.cashCents);
      expect(onlyPosition(again.reply.frame)).toEqual(position);
    });

    it('gives every schema-valid command an explicit outcome and never throws', () => {
      const lobby = sessionAt('lobby');
      const early = send(lobby.session, cashOut('d1'), lobby.nowMs);
      expect(early.reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'notStarted' });

      const { session, nowMs } = sessionAt('beforeBell');
      const ticket = closeUp(frameAt(session, nowMs));
      const asked: [Command, string][] = [
        [{ t: 'skipToBell', commandId: newId(), day: 1 }, 'wrongPhase'],
        [{ t: 'nextDay', commandId: newId(), day: 2 }, 'wrongDay'],
        [cashOut('d4'), 'unknownPosition'],
        [buy(ticket, { day: 2 }), 'wrongDay'],
        [buy({ contractId: 999_999, priceCents: ticket.priceCents }), 'unknownContract'],
        [buy(ticket, { spendCents: 1 }), 'spendTooSmall'],
      ];
      let current = session;
      for (const [command, reason] of asked) {
        const handled = send(current, command, nowMs);
        expect(handled.reply.receipt).toMatchObject({ outcome: 'rejected', reason });
        current = handled.session;
      }

      const opened = send(current, { t: 'openBell', commandId: newId(), day: 1 }, nowMs);
      expect(opened.reply.receipt.outcome).toBe('accepted');
      expect(opened.reply.frame.clock.phase).toBe('open');
    });

    it('logs an accepted command with the step it arrived at', () => {
      const { session, nowMs } = sessionAt('open');
      const command = buy(closeUp(frameAt(session, nowMs)));

      const { session: after, reply } = send(session, command, nowMs);

      expect(reply.receipt.outcome).toBe('accepted');
      const log = playerOf(after.game, PLAYER).log;
      expect(log[log.length - 1]).toEqual({ step: reply.receipt.step, command });
      expect(log).toHaveLength(playerOf(session.game, PLAYER).log.length + 1);
    });

    it('sells nothing on a stress board', () => {
      const { session, nowMs } = sessionAt('open', { targetsPerCompany: 209 });
      const before = frameAt(session, nowMs);

      const { reply } = send(session, buy(closeUp(before)), nowMs);

      expect(reply.receipt).toMatchObject({ outcome: 'rejected', reason: 'stressMode' });
      expect(reply.frame.positions).toEqual([]);
      expect(reply.frame.account.cashCents).toBe(before.account.cashCents);
    });

    it("quotes the connection's draft in the reply's frame, and only when there is one", () => {
      const { session, nowMs } = sessionAt('open');
      const ticket = closeUp(frameAt(session, nowMs));

      const withDraft = send(session, cashOut('d1'), nowMs, { contractId: ticket.contractId, spendCents: SPEND });
      expect(withDraft.reply.frame.draft).toMatchObject({ contractId: ticket.contractId, spendCents: SPEND });
      expect(withDraft.reply.frame.draft?.ticket?.contractId).toBe(ticket.contractId);

      const without = send(session, cashOut('d1'), nowMs, null);
      expect(without.reply.frame.draft).toBeUndefined();
    });
  });
}
