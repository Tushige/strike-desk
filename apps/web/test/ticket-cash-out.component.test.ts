// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTicket } from '../src/modules/order-ticket/index';
import type { OpenTicket, OrderTicketProps, ReadSlice, SubmitOutcome } from '../src/modules/order-ticket/index';
import type { PositionView } from '@strike-desk/shared/protocol';

type BuyProps = Extract<OrderTicketProps, { mode: 'buy' }>;
type Transaction = NonNullable<ReturnType<BuyProps['transaction']['get']>>;
type Purchase = NonNullable<ReturnType<NonNullable<BuyProps['purchase']>['get']>>;
function slice<T>(initial: T): ReadSlice<T> & { set(next: T): void } {
  let value = initial; const listeners = new Set<() => void>();
  return { get: () => value, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => { listener(); }); } };
}
// Two tickets bought at $5 cost $10. Sale at $6 returns $12, a $2 profit.
const position: PositionView = { id: 'held-ticket', day: 1, companyId: 0, contractId: 24, side: 'up', targetCents: 8000,
  quantity: 2, entryPriceCents: 500, costCents: 1000, entryStep: 0, entryPriceIndex: 0, breakEvenCents: 8500,
  status: 'open', valueCents: 1200, profitCents: 200, realCents: 400, hopeCents: 200 };

function setup() {
  let resolve!: (outcome: SubmitOutcome) => void;
  const promise = new Promise<SubmitOutcome>((done) => { resolve = done; });
  const purchase = slice<Purchase | null>({ session: 'game', companyName: 'Example', ticker: 'EX', position });
  const open = slice<OpenTicket | null>({ ...position, positionId: position.id, companyName: 'Example', ticker: 'EX' });
  const transaction = slice<Transaction | null>(null);
  const submitSale = vi.fn(() => promise);
  const props: BuyProps = { mode: 'buy', day: 1,
    contract: { contractId: 24, companyName: 'Example', ticker: 'EX', side: 'up', targetCents: 8000, offered: true },
    choices: [], quote: slice(null), account: slice({ canBuy: false, cashCents: 99999000, capCents: 50000000, minTicketCents: 500 }),
    line: 'live', retryOffered: false, onRetry: vi.fn(), onPick: vi.fn(), onDraftChange: vi.fn(),
    newCommandId: vi.fn(() => 'one-sale-id'), submit: vi.fn(() => promise), transaction, purchase,
    cashOut: { position: open, submit: submitSale },
    spendEditor: { value: '11.00', spendCents: 1100, error: null, onChange: vi.fn() } };
  return { props, open, purchase, transaction, submitSale, resolve };
}
afterEach(cleanup);

describe('cash out from the purchased ticket', () => {
  it('sends one position identity on two same-turn presses and shows pending in the same purchase panel', () => {
    const h = setup(); const view = render(createElement(OrderTicket, h.props));
    const button = view.queryByRole('button', { name: 'Cash out' });
    expect(button).not.toBeNull();
    if (button === null) throw new Error('missing cash-out action');
    act(() => { button.click(); button.click(); });
    expect(h.props.newCommandId).toHaveBeenCalledTimes(1);
    expect(h.submitSale).toHaveBeenCalledExactlyOnceWith({ t: 'cashOut', commandId: 'one-sale-id', positionId: 'held-ticket' });
    expect(h.props.submit).not.toHaveBeenCalled();
    expect(view.getByRole('status').textContent).toBe('Pending...');
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();
    expect(view.getByText('Bought for').nextElementSibling?.textContent).toBe('$10');
  });

  it.each(['cashOut', 'bell'] as const)('uses the authoritative %s exit and preserves pending until its receipt', async (kind) => {
    const h = setup(); const view = render(createElement(OrderTicket, h.props));
    fireEvent.click(view.getByRole('button', { name: 'Cash out' }));
    act(() => {
      h.open.set(null);
      h.purchase.set({ ...h.purchase.get()!, position: { ...position, status: kind === 'cashOut' ? 'cashedOut' : 'settled',
        exit: { kind, step: 11, priceIndex: 1, priceCents: 600, proceedsCents: 1200 } } });
    });
    expect(view.getByRole('status').textContent).toBe('Pending...');
    await act(async () => { h.resolve({ outcome: 'accepted', receipt: { kind: 'cashOut', commandId: 'one-sale-id', step: 11, outcome: 'accepted' } }); await Promise.resolve(); });
    const label = kind === 'cashOut' ? 'Money back in your pocket' : 'Paid at the bell';
    expect(view.queryByText(kind === 'cashOut' ? 'You cashed out' : 'Your ticket settled at the closing bell.')).not.toBeNull();
    expect(view.getByText(label).nextElementSibling?.textContent).toBe('$12');
    expect(view.getByText('You paid').nextElementSibling?.textContent).toBe('$10');
    expect(view.getByText('Profit or loss').nextElementSibling?.textContent).toBe('+$2');
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();
    if (kind === 'bell') expect(view.queryByText('You cashed out')).toBeNull();
  });

  it.each(['stale', 'offline'] as const)('disables cash-out with the approved %s explanation and shared freshness association', (line) => {
    const h = setup(); const view = render(createElement(OrderTicket, { ...h.props, line, staleNoticeId: 'freshness-warning' }));
    const words = line === 'stale' ? 'Cashing out is off until prices are up to date.' : 'Not connected. Cashing out is off until fresh prices arrive.';
    const explanation = view.queryByText(words); expect(explanation).not.toBeNull();
    const action = view.getByRole('button', { name: 'Cash out' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.getAttribute('aria-describedby')).toBe(explanation?.id);
    expect(view.getByRole('region', { name: 'Your ticket' }).getAttribute('aria-describedby')).toBe('freshness-warning');
    expect(view.getByText('Ticket price').closest('.opacity-60')).not.toBeNull();
    expect(h.submitSale).not.toHaveBeenCalled();
  });

  it('shows zero proceeds and the complete loss without deriving money from the requested spend', () => {
    const h = setup(); h.open.set(null);
    // $0 received minus the actual $10 cost is a $10 loss; requested spend was $11.
    h.purchase.set({ ...h.purchase.get()!, position: { ...position, status: 'settled', valueCents: 0, profitCents: -1000,
      exit: { kind: 'bell', step: 800, priceIndex: 500, priceCents: 0, proceedsCents: 0 } } });
    const view = render(createElement(OrderTicket, h.props));
    expect(view.getByText('Paid at the bell').nextElementSibling?.textContent).toBe('$0');
    expect(view.getByText('You paid').nextElementSibling?.textContent).toBe('$10');
    expect(view.getByText('Profit or loss').nextElementSibling?.textContent).toBe('-$10');
    expect(view.getByRole('status').textContent).toBe('Your ticket settled at the closing bell.');
  });

  it('preserves a rejected cash-out reason and reads the authoritative position again at the press', async () => {
    const h = setup(); const view = render(createElement(OrderTicket, h.props));
    fireEvent.click(view.getByRole('button', { name: 'Cash out' }));
    await act(async () => { h.resolve({ outcome: 'rejected', receipt: { kind: 'cashOut', commandId: 'one-sale-id', step: 11, outcome: 'rejected', reason: 'alreadyClosed' } }); await Promise.resolve(); });
    expect(view.getByRole('status').textContent).toBe('Rejected. That ticket is already cashed out. You were paid once.');
    act(() => { h.open.set({ ...h.open.get()! }); });
    const action = view.getByRole('button', { name: 'Cash out' });
    act(() => { h.open.set(null); action.click(); });
    expect(h.submitSale).toHaveBeenCalledTimes(1);
    expect(h.props.newCommandId).toHaveBeenCalledTimes(1);
  });

  it('restores an unanswered original-day sale as checking without minting a new command', () => {
    const h = setup(); h.purchase.set(null); h.open.set(null);
    h.transaction.set({ session: 'game', originalDay: 1, command: { t: 'cashOut', commandId: 'original-sale', positionId: position.id },
      interrupted: true, sent: true, retryAllowed: true, gameGone: false });
    const view = render(createElement(OrderTicket, { ...h.props, day: 2, retryOffered: true }));
    expect(view.getByRole('status').textContent).toBe('Checking...');
    expect((view.getByRole('button', { name: 'Buy ticket' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Retry safely' }));
    expect(h.props.onRetry).toHaveBeenCalledTimes(1);
    expect(h.props.newCommandId).not.toHaveBeenCalled();
    expect(h.submitSale).not.toHaveBeenCalled();
  });

  it('keeps a caller without the optional capability buy-only even when it supplies an open purchase', () => {
    const h = setup(); const buyOnly = { ...h.props }; delete buyOnly.cashOut;
    const view = render(createElement(OrderTicket, buyOnly));
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
    expect(h.submitSale).not.toHaveBeenCalled();
  });
});
