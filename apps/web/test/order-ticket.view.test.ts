import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OrderTicketDemo from '../src/lab/modules/order-ticket.demo';
import { OrderTicket, TicketView } from '../src/modules/order-ticket/OrderTicket';
import type { TicketViewProps } from '../src/modules/order-ticket/OrderTicket';
import { FAKE_ACCOUNT, FAKE_ACCOUNT_AFTER_BUY, FAKE_CHOICES, FAKE_CONTRACT_A, FAKE_OPEN_TICKET, FAKE_SPEND_CHOICES, createFakeTicketDesk } from '../src/modules/order-ticket/fake';
import { initialTicketState, ticketReducer } from '../src/modules/order-ticket/machine';
import type { TicketSnapshot, TicketState } from '../src/modules/order-ticket/machine';
import {
  ACCEPTED_WORDS,
  BLOCKER_WORDS,
  BUY_LABEL,
  CASH_OUT_LABEL,
  CHECKING_WORDS,
  COST_LABEL,
  LINE_WORDS,
  NOTHING_PICKED,
  PENDING_WORDS,
  REJECT_WORDS,
  RETRY_LABEL,
} from '../src/modules/order-ticket/words';

/**
 * What the form says, read off its static markup: these tests run under node
 * beside every other test, and nothing in them is clicked. What a press does
 * is tried in `order-ticket.test.ts`, where the rules live.
 *
 * The form's own words are taken from `words.ts` by name, so that rewording
 * one does not break a test. The money is typed in.
 */

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The way React writes text into markup. */
function escaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
}

const nothing = (): void => undefined;

/** RoboPup UP $85.00 quoted at the first price level for a $50,000 spend, as the scripted desk answers it. */
function knownSnapshot(over: Partial<TicketSnapshot> = {}): TicketSnapshot {
  const desk = createFakeTicketDesk();
  desk.props().onDraftChange({ contractId: 24, spendCents: 5_000_000 });
  return { day: 1, contract: FAKE_CONTRACT_A, quote: desk.props().quote.get(), account: FAKE_ACCOUNT, position: null, line: 'live', ...over };
}

function chosen(spendCents = 5_000_000): TicketState {
  return initialTicketState({ day: 1, contractId: 24, spendCents, held: false });
}

function markupOf(over: Partial<TicketViewProps>): string {
  const props: TicketViewProps = {
    state: chosen(),
    snapshot: knownSnapshot(),
    choices: FAKE_CHOICES,
    spendChoices: FAKE_SPEND_CHOICES,
    retryOffered: false,
    onPick: nothing,
    onChooseSpend: nothing,
    onPress: nothing,
    onRetry: nothing,
    ...over,
  };
  return renderToStaticMarkup(createElement(TicketView, props));
}

function pending(): TicketState {
  return ticketReducer(chosen(), { type: 'pressed', commandId: 'fake-cmd-0001', kind: 'buy' });
}

describe('the order ticket, drawn', () => {
  it('shows the cost and the highest price the buy still fills at, each once, exactly as the server sent them', () => {
    const markup = markupOf({});

    // 4,991,400 cents is $49,914; 12,036 cents is $120.36.
    expect(countOf(markup, '$49,914')).toBe(1);
    expect(countOf(markup, '$120.36')).toBe(1);
    expect(markup).toContain(escaped(COST_LABEL));
    expect(markup).toContain(BUY_LABEL);
    expect(markup).not.toContain('disabled=""');
  });

  it('shows no server number and keeps the buy off while the quote answers another spend', () => {
    const markup = markupOf({ state: chosen(10_000_000) });

    expect(markup).not.toContain('$49,914');
    expect(markup).not.toContain('$120.36');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain(escaped(BLOCKER_WORDS.waitingForQuote ?? ''));
  });

  it('draws the what-if as a range over the stops, starting on the break-even, with its answer in words', () => {
    const markup = markupOf({});

    // Five scripted stops, places 0 to 4; the break-even, $86.18, is place 2, where the profit is $0.
    expect(markup).toMatch(/<input[^>]*type="range"/);
    expect(markup).toMatch(/<input[^>]*min="0"[^>]*max="4"/);
    expect(markup).toMatch(/<input[^>]*value="2"/);
    expect(markup).toMatch(/aria-valuetext="[^"]*\$86\.18[^"]*\$0[^"]*"/);
  });

  it('says pending and locks the choices while a command is on its way', () => {
    const markup = markupOf({ state: pending() });

    expect(markup).toContain(PENDING_WORDS);
    // Two groups of choices, the six tickets and the spends, and both are locked.
    expect(countOf(markup, '<fieldset')).toBe(2);
    expect(markup.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
    expect(markupOf({}).match(/<fieldset[^>]*disabled=""/g)).toBeNull();
  });

  it('keeps the choices locked once a buy is accepted, until the server moves the form on', () => {
    const accepted = ticketReducer(pending(), {
      type: 'outcome',
      commandId: 'fake-cmd-0001',
      outcome: { outcome: 'accepted', receipt: { commandId: 'fake-cmd-0001', kind: 'buy', step: 400, outcome: 'accepted', positionId: 'd1' } },
    });

    const markup = markupOf({ state: accepted });

    expect(markup).toContain(ACCEPTED_WORDS.buy);
    expect(markup.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
  });

  it('leaves the choices open on a rejected form, because changing one is a way back to draft', () => {
    const rejected = ticketReducer(pending(), {
      type: 'outcome',
      commandId: 'fake-cmd-0001',
      outcome: { outcome: 'rejected', receipt: { commandId: 'fake-cmd-0001', kind: 'buy', step: 400, outcome: 'rejected', reason: 'priceMoved' } },
    });

    expect(markupOf({ state: rejected }).match(/<fieldset[^>]*disabled=""/g)).toBeNull();
  });

  it('holds the plain words for the code of a rejected buy', () => {
    const rejected = ticketReducer(pending(), {
      type: 'outcome',
      commandId: 'fake-cmd-0001',
      outcome: { outcome: 'rejected', receipt: { commandId: 'fake-cmd-0001', kind: 'buy', step: 400, outcome: 'rejected', reason: 'overCap' } },
    });

    expect(markupOf({ state: rejected })).toContain(escaped(REJECT_WORDS.overCap));
  });

  it('says checking, and offers the retry only when the desk does', () => {
    const checking = ticketReducer(pending(), { type: 'line', line: 'offline' });
    const offline = knownSnapshot({ line: 'offline' });

    const without = markupOf({ state: checking, snapshot: offline });
    const withRetry = markupOf({ state: checking, snapshot: offline, retryOffered: true });

    expect(without).toContain(CHECKING_WORDS);
    expect(without).not.toContain(RETRY_LABEL);
    expect(withRetry).toContain(RETRY_LABEL);
  });

  it('says the prices are stale, says why the buy is off, and turns it off', () => {
    const markup = markupOf({ snapshot: knownSnapshot({ line: 'stale' }) });

    expect(markup).toContain(LINE_WORDS.stale);
    expect(markup).toContain(escaped(BLOCKER_WORDS.stale ?? ''));
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Buy/);
  });

  it('is the cash-out form once the ticket is held: its worth, what it cost, real value and hope value, as sent', () => {
    const markup = markupOf({
      state: initialTicketState({ day: 1, contractId: 24, spendCents: 5_000_000, held: true }),
      snapshot: knownSnapshot({ account: FAKE_ACCOUNT_AFTER_BUY, position: FAKE_OPEN_TICKET }),
    });

    expect(markup).toContain(CASH_OUT_LABEL);
    expect(markup).not.toContain(BUY_LABEL);
    // Worth $49,914 and cost $49,914; hope value $118 a ticket; break-even $86.18; cash $950,086.
    expect(countOf(markup, '$49,914')).toBe(2);
    expect(markup).toContain('$118');
    expect(markup).toContain('$86.18');
    expect(markup).toContain('$950,086');
  });
});

describe('the order ticket on the scripted desk', () => {
  it('asks for a pick when nothing is selected', () => {
    const markup = renderToStaticMarkup(createElement(OrderTicket, createFakeTicketDesk().props()));

    expect(markup).toContain(NOTHING_PICKED);
  });

  it('is what the lab page mounts', () => {
    const markup = renderToStaticMarkup(createElement(OrderTicketDemo));

    expect(markup).toContain('id="lab-demo-order-ticket"');
    expect(markup).toContain(NOTHING_PICKED);
  });
});
