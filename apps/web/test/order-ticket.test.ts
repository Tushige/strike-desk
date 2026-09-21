import { describe, expect, it } from 'vitest';
import { cashOutCommandSchema, rejectReasonSchema } from '@strike-desk/shared/protocol';
import type { Receipt } from '@strike-desk/shared/protocol';
import { recordedFrame } from '../src/fixtures/recordedGame';
import { FAKE_ACCOUNT_AFTER_BUY, FAKE_CONTRACT_A, FAKE_OPEN_TICKET, createFakeTicketDesk, createHeldTicketDesk } from '../src/modules/order-ticket/fake';
import type { FakeTicketDesk } from '../src/modules/order-ticket/fake';
import { DRAFT_MIN_GAP_MS, createDraftPacer } from '../src/modules/order-ticket/draftPacer';
import type { TicketAccount, TicketDraft, TicketQuote } from '../src/modules/order-ticket/index';
import {
  breakEvenStopIndex,
  buyAllowed,
  buyBlocker,
  buyCommandOf,
  cashOutBlocker,
  initialTicketState,
  pressOf,
  retryAllowed,
  stopAt,
  ticketReducer,
} from '../src/modules/order-ticket/machine';
import type { TicketSnapshot, TicketState } from '../src/modules/order-ticket/machine';
import { BLOCKER_WORDS, CASH_OUT_BLOCKER_WORDS, REJECT_WORDS } from '../src/modules/order-ticket/words';

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

/**
 * Typed-in snapshots for the rules below: RoboPup UP $85.00 selected, the
 * first price level's quote for a $50,000 spend, $1,000,000 of cash, a
 * $500,000 cap and a live line. Each case changes one thing.
 */
const LEVEL_1_QUOTE: TicketQuote = {
  contractId: 24,
  spendCents: 5_000_000,
  priceCents: 11_800,
  quantity: 423,
  costCents: 4_991_400,
  limitPriceCents: 12_036,
  breakEvenCents: 8618,
  whatIf: [],
};

const LEVEL_2_QUOTE: TicketQuote = {
  contractId: 24,
  spendCents: 5_000_000,
  priceCents: 12_000,
  quantity: 416,
  costCents: 4_992_000,
  limitPriceCents: 12_240,
  breakEvenCents: 8620,
  whatIf: [],
};

const ACCOUNT: TicketAccount = { cashCents: 100_000_000, capCents: 50_000_000, canBuy: true, minTicketCents: 500 };

function snapshot(over: Partial<TicketSnapshot>): TicketSnapshot {
  return {
    day: 1,
    contract: { contractId: 24, companyName: 'RoboPup', ticker: 'RPUP', side: 'up', targetCents: 8500, offered: true },
    quote: LEVEL_1_QUOTE,
    account: ACCOUNT,
    position: null,
    line: 'live',
    ...over,
  };
}

function pressed(kind: 'buy' | 'cashOut', from: TicketState = chosen()): TicketState {
  return ticketReducer(from, { type: 'pressed', commandId: 'fake-cmd-0001', kind });
}

function answered(state: TicketState, outcome: 'accepted' | 'rejected', kind: 'buy' | 'cashOut'): TicketState {
  const made: Receipt =
    outcome === 'accepted'
      ? { commandId: 'fake-cmd-0001', kind, step: 400, outcome }
      : { commandId: 'fake-cmd-0001', kind, step: 400, outcome, reason: 'priceMoved' };
  return ticketReducer(state, { type: 'outcome', commandId: 'fake-cmd-0001', outcome: { outcome, receipt: made } });
}

describe('the order ticket: when the buy may be pressed', () => {
  it('is on for the typed-in snapshot, which changes nothing', () => {
    expect(buyAllowed(chosen(), snapshot({}))).toBe(true);
    expect(buyBlocker(chosen(), snapshot({}))).toBeNull();
  });

  it('is off when the form is not in draft', () => {
    expect(buyAllowed(pressed('buy'), snapshot({}))).toBe(false);
    expect(buyBlocker(pressed('buy'), snapshot({}))).toBe('notDraft');
  });

  it('is off when the line is stale', () => {
    expect(buyAllowed(chosen(), snapshot({ line: 'stale' }))).toBe(false);
    expect(buyBlocker(chosen(), snapshot({ line: 'stale' }))).toBe('stale');
  });

  it('is off when the line is offline', () => {
    expect(buyAllowed(chosen(), snapshot({ line: 'offline' }))).toBe(false);
    expect(buyBlocker(chosen(), snapshot({ line: 'offline' }))).toBe('offline');
  });

  it('is off when the account cannot buy', () => {
    const closed = snapshot({ account: { ...ACCOUNT, canBuy: false } });

    expect(buyAllowed(chosen(), closed)).toBe(false);
    expect(buyBlocker(chosen(), closed)).toBe('cannotBuy');
  });

  it('is off when the contract is not offered', () => {
    const unoffered = snapshot({ contract: { contractId: 24, companyName: 'RoboPup', ticker: 'RPUP', side: 'up', targetCents: 8500, offered: false } });

    expect(buyAllowed(chosen(), unoffered)).toBe(false);
    expect(buyBlocker(chosen(), unoffered)).toBe('notOffered');
  });

  it('is off when there is no quote', () => {
    expect(buyAllowed(chosen(), snapshot({ quote: null }))).toBe(false);
    expect(buyBlocker(chosen(), snapshot({ quote: null }))).toBe('waitingForQuote');
  });

  it('is off when the quote answers another contract: 61 while the form holds 24', () => {
    const other = snapshot({ quote: { ...LEVEL_1_QUOTE, contractId: 61 } });

    expect(buyAllowed(chosen(), other)).toBe(false);
    expect(buyBlocker(chosen(), other)).toBe('waitingForQuote');
  });

  it('is off when the quote answers another spend: $100,000 while the form holds $50,000', () => {
    const other = snapshot({ quote: { ...LEVEL_1_QUOTE, spendCents: 10_000_000 } });

    expect(buyAllowed(chosen(), other)).toBe(false);
    expect(buyBlocker(chosen(), other)).toBe('waitingForQuote');
  });

  it('is off when the spend buys no whole ticket', () => {
    const none = snapshot({ quote: { ...LEVEL_1_QUOTE, quantity: 0 } });

    expect(buyAllowed(chosen(), none)).toBe(false);
    expect(buyBlocker(chosen(), none)).toBe('spendTooSmall');
  });

  it('is off when the $50,000 spend is over a $40,000 cap', () => {
    const capped = snapshot({ account: { ...ACCOUNT, capCents: 4_000_000 } });

    expect(buyAllowed(chosen(), capped)).toBe(false);
    expect(buyBlocker(chosen(), capped)).toBe('overCap');
  });

  it('is off when the $50,000 spend is over $40,000 of cash', () => {
    const short = snapshot({ account: { ...ACCOUNT, cashCents: 4_000_000 } });

    expect(buyAllowed(chosen(), short)).toBe(false);
    expect(buyBlocker(chosen(), short)).toBe('notEnoughCash');
  });

  it('is off when the $4.00 price is under the $5.00 cheapest ticket', () => {
    const cheap = snapshot({ quote: { ...LEVEL_1_QUOTE, priceCents: 400 } });

    expect(buyAllowed(chosen(), cheap)).toBe(false);
    expect(buyBlocker(chosen(), cheap)).toBe('tooCheap');
  });

  it('is on at the edges: a spend equal to the cap and to the cash, a price equal to the cheapest ticket', () => {
    const edge = snapshot({
      account: { cashCents: 5_000_000, capCents: 5_000_000, canBuy: true, minTicketCents: 500 },
      quote: { ...LEVEL_1_QUOTE, priceCents: 500 },
    });

    expect(buyAllowed(chosen(), edge)).toBe(true);
  });
});

describe('the order ticket: a price update never changes a chosen field', () => {
  it('keeps contract 24 and the $50,000 spend when the second price level arrives, and the press then carries $120.00', () => {
    const desk = deskWithKnownDraft();
    desk.controls.setPriceLevel(2);

    const state = ticketReducer(chosen(), { type: 'quote', quote: desk.props().quote.get() });
    expect(state.contractId).toBe(24);
    expect(state.spendCents).toBe(5000000);

    const press = pressOf(state, snapshotOf(desk), desk.props().newCommandId);
    expect(press?.command).toEqual({ t: 'buy', commandId: 'fake-cmd-0001', day: 1, contractId: 24, spendCents: 5000000, seenPriceCents: 12000 });
  });
});

describe('the order ticket: when the line stops being live', () => {
  it('turns pending into checking when the line goes stale', () => {
    expect(ticketReducer(pressed('buy'), { type: 'line', line: 'stale' }).form).toBe('checking');
  });

  it('turns pending into checking when the line goes offline', () => {
    expect(ticketReducer(pressed('buy'), { type: 'line', line: 'offline' }).form).toBe('checking');
  });

  it('stays checking when the line comes back: only an answer ends it', () => {
    const checking = ticketReducer(pressed('buy'), { type: 'line', line: 'stale' });

    expect(ticketReducer(checking, { type: 'line', line: 'live' })).toBe(checking);
  });

  it('ends checking with the outcome, whatever it is', () => {
    const checking = ticketReducer(pressed('buy'), { type: 'line', line: 'offline' });

    expect(answered(checking, 'rejected', 'buy').form).toBe('rejected');
    expect(answered(checking, 'accepted', 'buy').form).toBe('accepted');
    expect(ticketReducer(checking, { type: 'outcome', commandId: 'fake-cmd-0001', outcome: { outcome: 'lost' } }).form).toBe('draft');
  });

  it('leaves a draft alone when the line changes', () => {
    const draft = chosen();

    expect(ticketReducer(draft, { type: 'line', line: 'stale' })).toBe(draft);
  });

  it('sends no new order while the line is stale, which is how a resumed connection reaches the form', () => {
    const desk = deskWithKnownDraft();
    desk.controls.setLine('stale');

    expect(pressOf(chosen(), snapshotOf(desk), desk.props().newCommandId)).toBeNull();
    expect(desk.controls.submitted()).toEqual([]);
  });

  it('offers the retry only while checking and only when the desk offers it; the retry asks the desk and submits nothing', () => {
    const desk = deskWithKnownDraft();
    const props = desk.props();
    let state = chosen();
    const first = pressOf(state, snapshotOf(desk), props.newCommandId);
    if (first === null) throw new Error('the first press should have been allowed');
    state = ticketReducer(state, first.event);
    void props.submit(first.command);
    expect(retryAllowed(state, true)).toBe(false);

    desk.controls.setLine('offline');
    state = ticketReducer(state, { type: 'line', line: 'offline' });
    expect(retryAllowed(state, false)).toBe(false);
    expect(retryAllowed(state, true)).toBe(true);

    // What the form does on a press of the retry control: it asks the desk, and that is all.
    if (retryAllowed(state, true)) props.onRetry();
    expect(desk.controls.retries()).toBe(1);
    expect(desk.controls.submitted()).toHaveLength(1);
    expect(pressOf(state, snapshotOf(desk), props.newCommandId)).toBeNull();
  });
});

describe('the order ticket: the way back to draft follows the server', () => {
  it('returns from rejected when a quote echoing the form arrives, and keeps the reason on screen', () => {
    const rejected = answered(pressed('buy'), 'rejected', 'buy');

    const next = ticketReducer(rejected, { type: 'quote', quote: LEVEL_2_QUOTE });

    expect(next.form).toBe('draft');
    expect(next.command).toBeNull();
    expect(next.notice).toEqual({ kind: 'rejected', of: 'buy', reason: 'priceMoved' });
  });

  it('stays rejected when the quote that arrives answers another draft', () => {
    const rejected = answered(pressed('buy'), 'rejected', 'buy');

    expect(ticketReducer(rejected, { type: 'quote', quote: { ...LEVEL_2_QUOTE, spendCents: 10_000_000 } })).toBe(rejected);
  });

  it('returns from rejected when the player changes the spend, and clears the reason', () => {
    const rejected = answered(pressed('buy'), 'rejected', 'buy');

    const next = ticketReducer(rejected, { type: 'spend', spendCents: 10_000_000 });

    expect(next.form).toBe('draft');
    expect(next.spendCents).toBe(10000000);
    expect(next.notice).toBeNull();
  });

  it('clears the reason on the next press', () => {
    const back = ticketReducer(answered(pressed('buy'), 'rejected', 'buy'), { type: 'quote', quote: LEVEL_2_QUOTE });

    expect(ticketReducer(back, { type: 'pressed', commandId: 'fake-cmd-0002', kind: 'buy' }).notice).toBeNull();
  });

  it('returns from an accepted buy when the open ticket arrives', () => {
    const accepted = answered(pressed('buy'), 'accepted', 'buy');
    expect(accepted.form).toBe('accepted');

    const next = ticketReducer(accepted, { type: 'position', held: true });

    expect(next.form).toBe('draft');
    expect(next.held).toBe(true);
    expect(next.notice).toEqual({ kind: 'accepted', of: 'buy' });
  });

  it('returns at once from an accepted buy whose open ticket arrived before the answer did', () => {
    const holding = ticketReducer(pressed('buy'), { type: 'position', held: true });
    expect(holding.form).toBe('pending');

    expect(answered(holding, 'accepted', 'buy').form).toBe('draft');
  });

  it('returns from an accepted cash-out when the day changes', () => {
    const accepted = answered(pressed('cashOut'), 'accepted', 'cashOut');
    expect(accepted.form).toBe('accepted');

    const next = ticketReducer(accepted, { type: 'day', day: 2 });

    expect(next.form).toBe('draft');
    expect(next.day).toBe(2);
    expect(next.notice).toBeNull();
  });

  it('returns at once from an accepted cash-out whose day had already changed', () => {
    const nextDay = ticketReducer(pressed('cashOut'), { type: 'day', day: 2 });

    expect(answered(nextDay, 'accepted', 'cashOut').form).toBe('draft');
  });

  it('returns at once from a buy accepted after its day was over, and still says it was accepted', () => {
    // Pressed on day 1 near the bell; the answer lands on day 2. No open ticket will ever arrive for day 1.
    const nextDay = ticketReducer(pressed('buy'), { type: 'day', day: 2 });
    expect(nextDay.form).toBe('pending');

    const next = answered(nextDay, 'accepted', 'buy');

    expect(next.form).toBe('draft');
    expect(next.command).toBeNull();
    expect(next.notice).toEqual({ kind: 'accepted', of: 'buy' });
  });

  it('returns at once from a buy rejected after its day was over, and keeps the reason on screen', () => {
    const nextDay = ticketReducer(pressed('buy'), { type: 'day', day: 2 });

    const next = answered(nextDay, 'rejected', 'buy');

    expect(next.form).toBe('draft');
    expect(next.command).toBeNull();
    expect(next.notice).toEqual({ kind: 'rejected', of: 'buy', reason: 'priceMoved' });
  });

  it('returns at once from a command that was being checked when its day ended', () => {
    const checking = ticketReducer(pressed('buy'), { type: 'line', line: 'offline' });
    const nextDay = ticketReducer(checking, { type: 'day', day: 2 });
    expect(nextDay.form).toBe('checking');

    expect(answered(nextDay, 'accepted', 'buy').form).toBe('draft');
  });

  it('leaves pending alone when the day changes', () => {
    const pending = pressed('buy');

    const next = ticketReducer(pending, { type: 'day', day: 2 });

    expect(next.form).toBe('pending');
    expect(next.command).toEqual({ id: 'fake-cmd-0001', kind: 'buy', day: 1 });
  });

  it('returns from rejected when the day changes, and clears the reason', () => {
    const next = ticketReducer(answered(pressed('buy'), 'rejected', 'buy'), { type: 'day', day: 2 });

    expect(next.form).toBe('draft');
    expect(next.notice).toBeNull();
  });

  it('returns from a rejected cash-out when the open ticket is next updated, and keeps the reason', () => {
    const rejected = answered(pressed('cashOut', { ...chosen(), held: true }), 'rejected', 'cashOut');

    const next = ticketReducer(rejected, { type: 'position', held: true });

    expect(next.form).toBe('draft');
    expect(next.notice).toEqual({ kind: 'rejected', of: 'cashOut', reason: 'priceMoved' });
  });
});

describe('the order ticket: cash out', () => {
  /** A desk whose buy was accepted: the account after the buy, and the open ticket `d1`. */
  function deskHoldingTheTicket(): FakeTicketDesk {
    const desk = deskWithKnownDraft();
    void desk.props().submit({ t: 'buy', commandId: 'an-earlier-buy', day: 1, contractId: 24, spendCents: 5_000_000, seenPriceCents: 11_800 });
    desk.controls.answer(
      { outcome: 'accepted', receipt: { commandId: 'an-earlier-buy', kind: 'buy', step: 400, outcome: 'accepted', positionId: 'd1' } },
      { account: FAKE_ACCOUNT_AFTER_BUY, position: FAKE_OPEN_TICKET },
    );
    return desk;
  }

  function holding(): TicketState {
    return initialTicketState({ day: 1, contractId: 24, spendCents: 5_000_000, held: true });
  }

  it('builds the whole of the cash-out command from the open ticket: its position id and nothing else', () => {
    const desk = deskHoldingTheTicket();

    const press = pressOf(holding(), snapshotOf(desk), desk.props().newCommandId);

    expect(press).toEqual({
      command: { t: 'cashOut', commandId: 'fake-cmd-0001', positionId: 'd1' },
      event: { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'cashOut' },
    });
    expect(cashOutCommandSchema.safeParse(press?.command).success).toBe(true);
  });

  it('sends one cash-out for two presses: the second returns null and mints no id', () => {
    const desk = deskHoldingTheTicket();
    let minted = 0;
    const newCommandId = (): string => {
      minted += 1;
      return desk.props().newCommandId();
    };
    const first = pressOf(holding(), snapshotOf(desk), newCommandId);
    if (first === null) throw new Error('the first press should have been allowed');
    const after = ticketReducer(holding(), first.event);

    expect(pressOf(after, snapshotOf(desk), newCommandId)).toBeNull();
    expect(minted).toBe(1);
  });

  it('is off while the line is not live, and says which', () => {
    const desk = deskHoldingTheTicket();
    expect(cashOutBlocker(holding(), snapshotOf(desk))).toBeNull();

    desk.controls.setLine('stale');
    expect(cashOutBlocker(holding(), snapshotOf(desk))).toBe('stale');
    expect(pressOf(holding(), snapshotOf(desk), desk.props().newCommandId)).toBeNull();

    desk.controls.setLine('offline');
    expect(cashOutBlocker(holding(), snapshotOf(desk))).toBe('offline');
  });

  it('never builds a buy while a ticket is held', () => {
    const desk = deskHoldingTheTicket();

    expect(pressOf(holding(), snapshotOf(desk), desk.props().newCommandId)?.command.t).toBe('cashOut');
  });
});

describe('the what-if slider', () => {
  it('starts on the break-even stop, where the profit is 0', () => {
    const quote = deskWithKnownDraft().props().quote.get();
    if (quote === null) throw new Error('the desk did not quote its known draft');

    // The scripted stops are $83, $85, $86.18, $87 and $89: the break-even is the third.
    expect(breakEvenStopIndex(quote)).toBe(2);
    expect(stopAt(quote, 2)).toEqual({ atCents: 8618, profitCents: 0 });
  });

  it('looks the next stop up and multiplies nothing: $87.00 shows the $34,686 the server sent', () => {
    const quote = deskWithKnownDraft().props().quote.get();
    if (quote === null) throw new Error('the desk did not quote its known draft');

    // 423 tickets, each paying $87.00 - $85.00 = $2.00 a share on 100 shares: 423 x 200 x 100 = 8,460,000, less the 4,991,400 paid.
    expect(stopAt(quote, 3)).toEqual({ atCents: 8700, profitCents: 3468600 });
  });

  it('has no stop outside the table, and starts at the first stop when the break-even is not among them', () => {
    const quote = deskWithKnownDraft().props().quote.get();
    if (quote === null) throw new Error('the desk did not quote its known draft');

    expect(stopAt(quote, 5)).toBeNull();
    expect(stopAt(quote, -1)).toBeNull();
    expect(breakEvenStopIndex({ ...quote, breakEvenCents: 1 })).toBe(0);
  });

  it('has a position for every stop of a real recorded draft, and one of them is the break-even', () => {
    const draft = recordedFrame('day1-draft').draft;
    const ticket = draft?.ticket;
    if (draft === undefined || ticket === undefined) throw new Error('the recorded frame holds no draft ticket');
    const quote: TicketQuote = { ...ticket, spendCents: draft.spendCents };

    // A stop per target of the board (21), one at the break-even, one a gap past it; fewer when two fall together.
    expect(quote.whatIf.length).toBeGreaterThanOrEqual(21);
    expect(quote.whatIf.length).toBeLessThanOrEqual(23);
    expect(stopAt(quote, quote.whatIf.length - 1)).not.toBeNull();
    expect(stopAt(quote, quote.whatIf.length)).toBeNull();
    expect(stopAt(quote, breakEvenStopIndex(quote))).toEqual({ atCents: quote.breakEvenCents, profitCents: 0 });
  });
});

describe('the words of the order ticket', () => {
  const EMOJI = /\p{Extended_Pictographic}/u;

  it('has plain words for all 17 ways the server can say no', () => {
    const codes = rejectReasonSchema.options;
    expect(codes).toHaveLength(17);

    for (const code of codes) {
      expect(REJECT_WORDS[code].trim().length, `${code} has words`).toBeGreaterThan(0);
      expect(EMOJI.test(REJECT_WORDS[code]), `${code} has no emoji`).toBe(false);
    }
    expect(Object.keys(REJECT_WORDS).sort()).toEqual([...codes].sort());
  });

  it('says why, in words, for every reason a button can be off; only a form that is not in draft says it another way', () => {
    const buyReasons = ['stale', 'offline', 'noContract', 'notOffered', 'cannotBuy', 'noSpend', 'waitingForQuote', 'tooCheap', 'spendTooSmall', 'overCap', 'notEnoughCash'] as const;
    const cashOutReasons = ['stale', 'offline', 'noTicket'] as const;

    for (const reason of buyReasons) {
      expect((BLOCKER_WORDS[reason] ?? '').trim().length, `buy off because ${reason}`).toBeGreaterThan(0);
    }
    for (const reason of cashOutReasons) {
      expect((CASH_OUT_BLOCKER_WORDS[reason] ?? '').trim().length, `cash-out off because ${reason}`).toBeGreaterThan(0);
    }
    // One more than the lists above in each table: `notDraft`, where pending, checking or the answer is on screen instead.
    expect(Object.keys(BLOCKER_WORDS)).toHaveLength(12);
    expect(Object.keys(CASH_OUT_BLOCKER_WORDS)).toHaveLength(4);
    expect(BLOCKER_WORDS.notDraft).toBeNull();
    expect(CASH_OUT_BLOCKER_WORDS.notDraft).toBeNull();
  });

  it('never states the numbers of the price tolerance', () => {
    for (const words of Object.values(REJECT_WORDS)) {
      expect(words).not.toMatch(/2\s?%|\$1\b/);
    }
  });
});

describe('the lab desk that can hold a quote back', () => {
  const KNOWN: TicketDraft = { contractId: 24, spendCents: 5_000_000 };

  it('passes quotes straight through until it is told to hold them', () => {
    const desk = createHeldTicketDesk({});

    desk.props().onDraftChange(KNOWN);

    expect(desk.props().quote.get()).toMatchObject({ contractId: 24, spendCents: 5000000, costCents: 4991400 });
  });

  it('leaves the quote as it was while holding, and lets the newest one through on release, telling subscribers once', () => {
    const desk = createHeldTicketDesk({ holding: true });
    const { quote, onDraftChange } = desk.props();
    let told = 0;
    quote.subscribe(() => {
      told += 1;
    });

    onDraftChange(KNOWN);
    onDraftChange({ contractId: 24, spendCents: 10_000_000 });
    expect(quote.get()).toBeNull();
    expect(told).toBe(0);
    expect(desk.held.waiting()).toBe(true);

    desk.held.release();

    // The newest: the $100,000 spend, which costs $99,946.
    expect(quote.get()).toMatchObject({ contractId: 24, spendCents: 10000000, costCents: 9994600 });
    expect(told).toBe(1);
    expect(desk.held.waiting()).toBe(false);
  });

  it('lets a quote through when its wait runs: 800 ms on a timer moved by hand', () => {
    const timer = handTimer();
    const desk = createHeldTicketDesk({ delayMs: 800, schedule: timer.schedule });
    const { quote, onDraftChange } = desk.props();

    onDraftChange(KNOWN);
    timer.advanceTo(799);
    expect(quote.get()).toBeNull();

    timer.advanceTo(800);
    expect(quote.get()).toMatchObject({ contractId: 24, spendCents: 5000000 });
  });

  it('is still a desk: the same command id submitted twice is one command, and the day can be moved on', () => {
    const desk = createHeldTicketDesk({});
    const props = desk.props();
    const command = { t: 'buy', commandId: 'held-desk-0001', day: 1, contractId: 24, spendCents: 5_000_000, seenPriceCents: 11_800 } as const;

    void props.submit(command);
    void props.submit({ ...command });
    expect(desk.controls.submitted()).toHaveLength(1);

    let told = 0;
    desk.subscribe(() => {
      told += 1;
    });
    desk.held.setDay(2);
    expect(desk.props().day).toBe(2);
    expect(told).toBe(1);
  });

  it('hands over the account and the open ticket when told to, and clears them again', () => {
    const desk = createHeldTicketDesk({});
    const { account, position } = desk.props();

    desk.held.hand({ account: FAKE_ACCOUNT_AFTER_BUY, position: FAKE_OPEN_TICKET });
    expect(account.get()).toBe(FAKE_ACCOUNT_AFTER_BUY);
    expect(position.get()).toBe(FAKE_OPEN_TICKET);

    desk.held.hand({ position: null });
    expect(position.get()).toBeNull();
    expect(account.get()).toBe(FAKE_ACCOUNT_AFTER_BUY);
  });
});

/** A clock and a timer moved by hand. Time is in milliseconds. */
function handTimer(): { now: () => number; schedule: (run: () => void, delayMs: number) => () => void; advanceTo: (ms: number) => void } {
  let time = 0;
  let waiting: { at: number; run: () => void }[] = [];
  return {
    now: () => time,
    schedule: (run, delayMs) => {
      const entry = { at: time + delayMs, run };
      waiting.push(entry);
      return () => {
        waiting = waiting.filter((one) => one !== entry);
      };
    },
    advanceTo: (ms) => {
      for (;;) {
        const due = waiting.filter((one) => one.at <= ms).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        waiting = waiting.filter((one) => one !== due);
        time = due.at;
        due.run();
      }
      time = ms;
    },
  };
}

describe('the draft pacer', () => {
  const A: TicketDraft = { contractId: 24, spendCents: null };
  const B: TicketDraft = { contractId: 24, spendCents: 5_000_000 };
  const C: TicketDraft = { contractId: 24, spendCents: 10_000_000 };
  const D: TicketDraft = { contractId: 61, spendCents: 10_000_000 };

  function paced(): { timer: ReturnType<typeof handTimer>; reports: { at: number; draft: TicketDraft }[]; pacer: ReturnType<typeof createDraftPacer> } {
    const timer = handTimer();
    const reports: { at: number; draft: TicketDraft }[] = [];
    const pacer = createDraftPacer({
      report: (draft) => {
        reports.push({ at: timer.now(), draft });
      },
      schedule: timer.schedule,
      now: timer.now,
      minGapMs: 1000,
    });
    return { timer, reports, pacer };
  }

  it('holds to one report a second by default', () => {
    expect(DRAFT_MIN_GAP_MS).toBe(1000);
  });

  it('reports the first change at once and the latest of the rest one second later: A at 0, C at 1,000, never B', () => {
    const { timer, reports, pacer } = paced();

    pacer.change(A);
    timer.advanceTo(100);
    pacer.change(B);
    timer.advanceTo(200);
    pacer.change(C);
    timer.advanceTo(5000);

    expect(reports).toEqual([
      { at: 0, draft: A },
      { at: 1000, draft: C },
    ]);
  });

  it('reports at once again after a quiet second: D at 2,500', () => {
    const { timer, reports, pacer } = paced();
    pacer.change(A);
    timer.advanceTo(200);
    pacer.change(C);
    timer.advanceTo(2500);

    pacer.change(D);

    expect(reports.at(-1)).toEqual({ at: 2500, draft: D });
    expect(reports).toHaveLength(3);
  });

  it('makes 11 reports of a change every 100 ms for 10,000 ms: at 0, 1,000, 2,000 and so on to 10,000', () => {
    const { timer, reports, pacer } = paced();

    // 101 changes, each naming a different contract, so none repeats the one before it.
    for (let tenth = 0; tenth <= 100; tenth += 1) {
      timer.advanceTo(tenth * 100);
      pacer.change({ contractId: tenth, spendCents: null });
    }

    expect(reports).toHaveLength(11);
    expect(reports.map((one) => one.at)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  });

  it('drops a waiting report when it is cancelled', () => {
    const { timer, reports, pacer } = paced();
    pacer.change(A);
    timer.advanceTo(100);
    pacer.change(B);

    pacer.cancel();
    timer.advanceTo(5000);

    expect(reports).toEqual([{ at: 0, draft: A }]);
  });

  it('does not report again a choice the desk already has: A, then B and back to A inside the second', () => {
    const { timer, reports, pacer } = paced();
    pacer.change(A);
    timer.advanceTo(100);
    pacer.change(B);
    timer.advanceTo(200);
    pacer.change(A);
    timer.advanceTo(5000);

    expect(reports).toEqual([{ at: 0, draft: A }]);
  });
});
