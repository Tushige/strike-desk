import { describe, expect, it } from 'vitest';
import type { Receipt } from '@strike-desk/shared/protocol';
import { FAKE_CONTRACT_A, createFakeTicketDesk } from '../src/modules/order-ticket/fake';
import type { FakeTicketDesk } from '../src/modules/order-ticket/fake';
import { buyAllowed, buyCommandOf, initialTicketState, pressOf, ticketReducer } from '../src/modules/order-ticket/machine';
import type { TicketSnapshot, TicketState } from '../src/modules/order-ticket/machine';

/**
 * The order ticket's rules, tried with no page: the state machine is a pure
 * function, a press is a pure function plus one call for an id, and the desk
 * is the scripted one. Nothing here is clicked, because nothing here is drawn.
 *
 * Every expected value is typed in. The quotes are the scripted desk's, which
 * were themselves worked out by hand:
 *   contract 24 (RoboPup UP, target $85.00) at a ticket price of $118.00,
 *   spend $50,000: 5,000,000 / 11,800 = 423.7, so 423 whole tickets.
 */

/** What the form can see of the desk right now: the values the rules read, and nothing else. */
function snapshotOf(desk: FakeTicketDesk): TicketSnapshot {
  const props = desk.props();
  return {
    day: props.day,
    contract: props.contract,
    quote: props.quote.get(),
    account: props.account.get(),
    position: props.position.get(),
    line: props.line,
  };
}

/** A desk with RoboPup UP $85.00 selected and a $50,000 spend quoted at the first price level. */
function deskWithKnownDraft(): FakeTicketDesk {
  const desk = createFakeTicketDesk();
  desk.controls.select(FAKE_CONTRACT_A);
  desk.props().onDraftChange({ contractId: 24, spendCents: 5_000_000 });
  return desk;
}

/** The form after the player chose contract 24 and a $50,000 spend. */
function chosen(): TicketState {
  return initialTicketState({ day: 1, contractId: 24, spendCents: 5_000_000, held: false });
}

function receipt(commandId: string, over: Partial<Receipt>): Receipt {
  return { commandId, kind: 'buy', step: 400, outcome: 'accepted', ...over };
}

describe('the order ticket: a buy, from the press to the answer', () => {
  it('starts in draft with no command in flight and nothing to say', () => {
    expect(initialTicketState({ day: 1, contractId: null, spendCents: null, held: false })).toEqual({
      form: 'draft',
      command: null,
      notice: null,
      contractId: null,
      spendCents: null,
      day: 1,
      held: false,
    });
  });

  it('allows the buy when the first price level echoes the chosen contract and spend', () => {
    const desk = deskWithKnownDraft();

    expect(buyAllowed(chosen(), snapshotOf(desk))).toBe(true);
  });

  it('builds the buy from the chosen fields and the price the quote shows, and from nothing else', () => {
    const desk = deskWithKnownDraft();

    // seenPriceCents is the quote's own priceCents: $118.00.
    expect(buyCommandOf(chosen(), snapshotOf(desk), 'fake-cmd-0001')).toEqual({
      t: 'buy',
      commandId: 'fake-cmd-0001',
      day: 1,
      contractId: 24,
      spendCents: 5000000,
      seenPriceCents: 11800,
    });
  });

  it('builds no buy while the quote answers another draft', () => {
    const desk = deskWithKnownDraft();
    const other = initialTicketState({ day: 1, contractId: 24, spendCents: 10_000_000, held: false });

    expect(buyCommandOf(other, snapshotOf(desk), 'fake-cmd-0001')).toBeNull();
  });

  it('goes from draft to pending on a press, and keeps the command it sent', () => {
    const next = ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' });

    expect(next.form).toBe('pending');
    expect(next.command).toEqual({ id: 'fake-cmd-0001', kind: 'buy', day: 1 });
  });

  it('ignores a second press while pending: the state is the same object', () => {
    const pending = ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' });

    expect(ticketReducer(pending, { type: 'pressed', commandId: 'fake-cmd-0002', kind: 'buy' })).toBe(pending);
  });

  it('goes to accepted on an accepted outcome', () => {
    const pending = ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' });

    const next = ticketReducer(pending, {
      type: 'outcome',
      commandId: 'fake-cmd-0001',
      outcome: { outcome: 'accepted', receipt: receipt('fake-cmd-0001', { positionId: 'd1' }) },
    });

    expect(next.form).toBe('accepted');
    expect(next.notice).toEqual({ kind: 'accepted', of: 'buy' });
  });

  it('goes to rejected on a rejected outcome, carrying the reason', () => {
    const pending = ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' });

    const next = ticketReducer(pending, {
      type: 'outcome',
      commandId: 'fake-cmd-0001',
      outcome: { outcome: 'rejected', receipt: receipt('fake-cmd-0001', { outcome: 'rejected', reason: 'overCap' }) },
    });

    expect(next.form).toBe('rejected');
    expect(next.notice).toEqual({ kind: 'rejected', of: 'buy', reason: 'overCap' });
  });

  it('goes back to draft at once on a lost outcome, and says that no answer came', () => {
    const pending = ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' });

    const next = ticketReducer(pending, { type: 'outcome', commandId: 'fake-cmd-0001', outcome: { outcome: 'lost' } });

    expect(next.form).toBe('draft');
    expect(next.command).toBeNull();
    expect(next.notice).toEqual({ kind: 'lost' });
  });

  it('ignores the outcome of a command that is not the one in flight', () => {
    const pending = ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0002', kind: 'buy' });

    expect(ticketReducer(pending, { type: 'outcome', commandId: 'fake-cmd-0001', outcome: { outcome: 'lost' } })).toBe(pending);
  });
});

describe('the order ticket: the whole of a press', () => {
  it('mints one id, builds the command and says pressed, when the press is allowed', () => {
    const desk = deskWithKnownDraft();

    const press = pressOf(chosen(), snapshotOf(desk), desk.props().newCommandId);

    expect(press).toEqual({
      command: { t: 'buy', commandId: 'fake-cmd-0001', day: 1, contractId: 24, spendCents: 5000000, seenPriceCents: 11800 },
      event: { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' },
    });
  });

  it('does nothing and mints nothing when the press is not allowed', () => {
    const desk = deskWithKnownDraft();
    desk.controls.setLine('offline');
    let minted = 0;

    const press = pressOf(chosen(), snapshotOf(desk), () => {
      minted += 1;
      return 'never-used';
    });

    expect(press).toBeNull();
    expect(minted).toBe(0);
  });

  it('sends one command for two presses: the second sees pending, mints no id and submits nothing', () => {
    const desk = deskWithKnownDraft();
    const props = desk.props();
    let minted = 0;
    const newCommandId = (): string => {
      minted += 1;
      return props.newCommandId();
    };
    let state = chosen();

    // The first press: the form moves on before anything else can happen, then the command goes out.
    const first = pressOf(state, snapshotOf(desk), newCommandId);
    if (first === null) throw new Error('the first press should have been allowed');
    state = ticketReducer(state, first.event);
    void props.submit(first.command);

    // The second press, in the same moment: nothing has answered yet.
    const second = pressOf(state, snapshotOf(desk), newCommandId);

    expect(second).toBeNull();
    expect(minted).toBe(1);
    expect(desk.controls.submitted()).toEqual([{ t: 'buy', commandId: 'fake-cmd-0001', day: 1, contractId: 24, spendCents: 5000000, seenPriceCents: 11800 }]);
  });
});
