import { describe, expect, it } from 'vitest';
import type { BuyCommand, Receipt } from '@strike-desk/shared/protocol';
import type { OrderTicketProps, SubmitOutcome, TicketDraft } from '../../src/modules/order-ticket/index';

/**
 * What anything that stands behind the order ticket must do: the scripted
 * desk the block is built against today, and the real desk the game is
 * assembled with later. Every case builds a fresh desk.
 *
 * Every promise here is awaited; nothing waits for a duration.
 *
 * This file is not a test file by itself: a test file names the desk to try
 * and calls `describeTicketDeskContract`.
 */

export interface TicketDeskUnderTest {
  submit: OrderTicketProps['submit'];
  quote: OrderTicketProps['quote'];
  onDraftChange: OrderTicketProps['onDraftChange'];
  /** The server answers the oldest unanswered command. */
  answer: (outcome: SubmitOutcome) => void;
  /** How many different commands the desk has sent on. */
  commandsSeen: () => number;
  /** A draft the desk can quote, with a spend that buys at least one ticket. */
  known: { contractId: number; spendCents: number };
}

let issued = 0;

function buyOf(known: TicketDeskUnderTest['known']): BuyCommand {
  issued += 1;
  return {
    t: 'buy',
    commandId: `desk-contract-${String(issued).padStart(4, '0')}`,
    day: 1,
    contractId: known.contractId,
    spendCents: known.spendCents,
    seenPriceCents: 100,
  };
}

function receiptFor(command: BuyCommand, outcome: 'accepted' | 'rejected'): Receipt {
  return outcome === 'accepted'
    ? { commandId: command.commandId, kind: 'buy', step: 400, outcome, positionId: 'd1' }
    : { commandId: command.commandId, kind: 'buy', step: 400, outcome, reason: 'overCap' };
}

export function describeTicketDeskContract(name: string, make: () => TicketDeskUnderTest): void {
  describe(`the ticket desk contract: ${name}`, () => {
    it('resolves a submit with exactly the outcome the server gave', async () => {
      const desk = make();
      const command = buyOf(desk.known);
      const outcome: SubmitOutcome = { outcome: 'accepted', receipt: receiptFor(command, 'accepted') };

      const submitted = desk.submit(command);
      desk.answer(outcome);

      await expect(submitted).resolves.toEqual(outcome);
      expect(desk.commandsSeen()).toBe(1);
    });

    it('resolves, and does not reject, when no answer will ever come', async () => {
      const desk = make();

      const submitted = desk.submit(buyOf(desk.known));
      desk.answer({ outcome: 'lost' });

      await expect(submitted).resolves.toEqual({ outcome: 'lost' });
    });

    it('answers commands in the order they were sent, each with its own outcome', async () => {
      const desk = make();
      const first = buyOf(desk.known);
      const second = buyOf(desk.known);
      const firstOutcome: SubmitOutcome = { outcome: 'rejected', receipt: receiptFor(first, 'rejected') };
      const secondOutcome: SubmitOutcome = { outcome: 'accepted', receipt: receiptFor(second, 'accepted') };

      const firstSubmitted = desk.submit(first);
      const secondSubmitted = desk.submit(second);
      desk.answer(firstOutcome);
      desk.answer(secondOutcome);

      await expect(firstSubmitted).resolves.toEqual(firstOutcome);
      await expect(secondSubmitted).resolves.toEqual(secondOutcome);
      expect(desk.commandsSeen()).toBe(2);
    });

    it('treats the same command id submitted twice as one command', async () => {
      const desk = make();
      const command = buyOf(desk.known);
      const outcome: SubmitOutcome = { outcome: 'accepted', receipt: receiptFor(command, 'accepted') };

      const first = desk.submit(command);
      const second = desk.submit({ ...command });
      expect(desk.commandsSeen()).toBe(1);
      desk.answer(outcome);

      await expect(first).resolves.toEqual(outcome);
      await expect(second).resolves.toEqual(outcome);
      expect(desk.commandsSeen()).toBe(1);
    });

    it('keeps the reason of a rejected outcome', async () => {
      const desk = make();
      const command = buyOf(desk.known);

      const submitted = desk.submit(command);
      desk.answer({ outcome: 'rejected', receipt: receiptFor(command, 'rejected') });

      const resolved = await submitted;
      expect(resolved.outcome).toBe('rejected');
      expect(resolved.outcome === 'lost' ? undefined : resolved.receipt.reason).toBe('overCap');
    });

    it('quotes the draft it is told about, echoing it, and nothing when there is no draft', () => {
      const desk = make();
      let told = 0;
      const unsubscribe = desk.quote.subscribe(() => {
        told += 1;
      });
      expect(desk.quote.get()).toBeNull();

      desk.onDraftChange(desk.known);
      const quoted = desk.quote.get();
      expect(quoted).toMatchObject(desk.known);
      expect(told).toBe(1);
      expect(desk.quote.get()).toBe(quoted);

      const nothing: TicketDraft = { contractId: null, spendCents: null };
      desk.onDraftChange(nothing);
      expect(desk.quote.get()).toBeNull();
      expect(told).toBe(2);

      unsubscribe();
      desk.onDraftChange(desk.known);
      expect(told).toBe(2);
      expect(desk.quote.get()).toMatchObject(desk.known);
    });

    it('quotes in whole numbers, with the what-if stops in order and one of them at the break-even', () => {
      const desk = make();
      desk.onDraftChange(desk.known);
      const quote = desk.quote.get();
      if (quote === null) throw new Error('the desk did not quote its known draft');

      const money = [quote.priceCents, quote.quantity, quote.costCents, quote.limitPriceCents, quote.breakEvenCents, ...quote.whatIf.flatMap((stop) => [stop.atCents, stop.profitCents])];
      for (const value of money) expect(Number.isInteger(value)).toBe(true);

      expect(quote.quantity).toBeGreaterThanOrEqual(1);
      const stops = quote.whatIf.map((stop) => stop.atCents);
      expect(stops).toEqual([...stops].sort((a, b) => a - b));
      expect(new Set(stops).size).toBe(stops.length);
      expect(quote.whatIf.filter((stop) => stop.atCents === quote.breakEvenCents)).toEqual([{ atCents: quote.breakEvenCents, profitCents: 0 }]);
    });
  });
}
