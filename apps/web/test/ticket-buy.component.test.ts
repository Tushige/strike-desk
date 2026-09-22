// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTicket, REJECT_WORDS } from '../src/modules/order-ticket/index';
import type { OrderTicketProps, ReadSlice, SubmitOutcome, TicketQuote } from '../src/modules/order-ticket/index';

type BuyProps = Extract<OrderTicketProps, { mode: 'buy' }>;
function slice<T>(initial: T): ReadSlice<T> & { set(next: T): void } {
  let value = initial; const listeners = new Set<() => void>();
  return { get: () => value, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => { listener(); }); } };
}
const quote: TicketQuote = { contractId: 24, spendCents: 10000, priceCents: 5000, quantity: 2, costCents: 10000,
  limitPriceCents: 5100, breakEvenCents: 8500, whatIf: [{ atCents: 8500, profitCents: 0 }] };
function setup() {
  let resolve!: (outcome: SubmitOutcome) => void;
  const promise = new Promise<SubmitOutcome>((done) => { resolve = done; });
  const props: BuyProps = { mode: 'buy', day: 1,
    contract: { contractId: 24, companyName: 'Example', ticker: 'EX', side: 'up', targetCents: 8000, offered: true },
    choices: [{ side: 'up', choice: 'close', contractId: 24, targetCents: 8000 }, { side: 'down', choice: 'close', contractId: 25, targetCents: 9000 }],
    quote: slice<TicketQuote | null>(quote), account: slice({ canBuy: true, cashCents: 100000000, capCents: 50000000, minTicketCents: 500 }),
    line: 'live', retryOffered: false, onRetry: vi.fn(), onPick: vi.fn(), onDraftChange: vi.fn(),
    newCommandId: vi.fn(() => 'one-buy-id'), submit: vi.fn(() => promise), transaction: slice(null),
    spendEditor: { value: '100.00', spendCents: 10000, error: null, onChange: vi.fn() } };
  return { props, resolve };
}
afterEach(cleanup);
describe('typed buy-only ticket', () => {
  it('explains the daily purchase limit accurately', () => {
    expect(REJECT_WORDS.alreadyBought).toBe("You already bought today's ticket. It is one ticket a day.");
  });
  it('submits the displayed draft once for two same-turn clicks and never offers cash out', async () => {
    const { props, resolve } = setup(); const view = render(createElement(OrderTicket, props));
    expect((view.getByRole('textbox', { name: 'How much to spend' }) as HTMLInputElement).value).toBe('100.00');
    const button = view.getByRole('button', { name: 'Buy ticket' });
    act(() => { button.click(); button.click(); });
    expect(props.newCommandId).toHaveBeenCalledTimes(1);
    expect(props.submit).toHaveBeenCalledExactlyOnceWith({ t: 'buy', commandId: 'one-buy-id', day: 1, contractId: 24, spendCents: 10000, seenPriceCents: 5000 });
    expect(view.getByRole('status').textContent).toBe('Pending...');
    await act(async () => { resolve({ outcome: 'accepted', receipt: { kind: 'buy', commandId: 'one-buy-id', step: 0, outcome: 'accepted' } }); await Promise.resolve(); });
    expect(view.getByRole('status').textContent).toBe('Accepted. The ticket is yours.');
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
  });
  it('offers choices without a default and preserves incomplete controlled text', () => {
    const { props } = setup(); const view = render(createElement(OrderTicket, { ...props, contract: null }));
    expect(view.getAllByRole('button', { pressed: false })).toHaveLength(2);
    expect((view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(createElement(OrderTicket, { ...props, spendEditor: { ...props.spendEditor, value: '1e', spendCents: null, error: 'Enter an amount in dollars and cents.' } }));
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('1e');
    expect(view.queryByText('Cost & most you can lose')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
    expect(props.submit).not.toHaveBeenCalled();
  });
  it.each(['stale', 'offline'] as const)('explains %s prices beside focusable content without duplicating the shared notice', (line) => {
    const { props } = setup(); const view = render(createElement(OrderTicket, { ...props, line, staleNoticeId: 'waiting' }));
    const words = line === 'stale' ? 'Buying is off until prices are up to date.' : 'Not connected. Buying is off until fresh prices arrive.';
    const explanation = view.getByText(words);
    expect(view.getByRole('textbox').getAttribute('aria-describedby')).toContain(explanation.id);
    expect(view.queryByText('Prices are stale')).toBeNull();
    expect(view.getByText('Ticket price').closest('.opacity-60')).not.toBeNull();
    expect((view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.submit).not.toHaveBeenCalled();
  });
  it('rejects a quote for another spend and shows the approved reason after a refused buy', async () => {
    const { props, resolve } = setup(); const view = render(createElement(OrderTicket, { ...props, spendEditor: { ...props.spendEditor, spendCents: 20000, value: '200' } }));
    expect((view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(createElement(OrderTicket, props)); fireEvent.click(view.getByRole('button', { name: 'Buy ticket' }));
    await act(async () => { resolve({ outcome: 'rejected', receipt: { kind: 'buy', commandId: 'one-buy-id', step: 0, outcome: 'rejected', reason: 'priceMoved' } }); await Promise.resolve(); });
    expect(view.getByRole('status').textContent).toBe('Rejected. The price moved. Check the new price and press again.');
  });
  it('keeps an unanswered original-day request blocking purchases across a remount while today stays editable', () => {
    const { props } = setup();
    const transaction: NonNullable<ReturnType<BuyProps['transaction']['get']>> = { session: 'current-game',
      command: { t: 'buy', commandId: 'original-buy', day: 1, contractId: 24, spendCents: 10000, seenPriceCents: 5000 },
      interrupted: true, sent: true, retryAllowed: false, gameGone: false };
    const view = render(createElement(OrderTicket, { ...props, day: 2, transaction: slice(transaction) }));
    expect(view.getByRole('status').textContent).toBe('Checking...');
    expect((view.getByRole('textbox') as HTMLInputElement).disabled).toBe(false);
    expect((view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(view.getByRole('textbox'), { target: { value: '200' } });
    expect(props.spendEditor.onChange).toHaveBeenCalledWith('200');
    expect(props.submit).not.toHaveBeenCalled(); expect(props.newCommandId).not.toHaveBeenCalled();
  });
});
