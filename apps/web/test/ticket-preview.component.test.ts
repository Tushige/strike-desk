// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTicket } from '../src/modules/order-ticket/index';
import type { ReadSlice, TicketPreviewProps, TicketQuote } from '../src/modules/order-ticket/index';

function slice<T>(initial: T): ReadSlice<T> & { set: (value: T) => void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return { get: () => value, subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, set: (next) => { value = next; listeners.forEach((fn) => { fn(); }); } };
}

// Synthetic server answers: at $84 this ticket loses $100, at $85 it breaks even,
// and at $86 it profits $100. The view only looks these values up.
const ANSWER: TicketQuote = {
  contractId: 24, spendCents: 10000, priceCents: 5000, costCents: 10000, quantity: 2,
  limitPriceCents: 5100, breakEvenCents: 8500,
  whatIf: [{ atCents: 8400, profitCents: -10000 }, { atCents: 8500, profitCents: 0 }, { atCents: 8600, profitCents: 10000 }],
};

function setup() {
  const quote = slice<TicketQuote | null>(ANSWER);
  const props: TicketPreviewProps = {
    mode: 'preview', day: 1,
    contract: { contractId: 24, companyName: 'Example', ticker: 'EX', side: 'up', targetCents: 8000, offered: true },
    choices: [{ side: 'up', choice: 'close', contractId: 24, targetCents: 8000 }, { side: 'down', choice: 'close', contractId: 25, targetCents: 9000 }],
    quote, account: slice({ cashCents: 100000000, capCents: 50000000, minTicketCents: 500, canBuy: true }),
    line: 'live', onPick: vi.fn(), onDraftChange: vi.fn(),
    spendEditor: { value: '100.00', spendCents: 10000, error: null, onChange: vi.fn() },
  };
  return { quote, props };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the ticket preview', () => {
  it('shares the waiting description and keeps compatible dim numbers editable until the draft changes', () => {
    const { props, quote } = setup();
    const view = render(createElement(OrderTicket, props));
    fireEvent.change(view.getByRole('slider'), { target: { value: '2' } });
    const stale = { ...props, line: 'stale' as const, staleNoticeId: 'shared-waiting' };
    view.rerender(createElement(OrderTicket, stale));
    expect(view.getByRole('region', { name: 'Your ticket' }).getAttribute('aria-describedby')).toBe('shared-waiting');
    expect(view.queryByText(/Prices have stopped moving/)).toBeNull();
    expect(view.getByText('Cost & most you can lose').nextElementSibling?.textContent).toBe('$100');
    expect(view.getByText('Ticket price').closest('.opacity-60')).not.toBeNull();
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$86. Profit or loss +$100');
    expect((view.getByRole('textbox') as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(view.getByRole('slider'), { target: { value: '0' } });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$84. Profit or loss -$100');
    view.rerender(createElement(OrderTicket, { ...stale, line: 'offline' }));
    expect(view.getByText('Ticket price').closest('.opacity-60')).not.toBeNull();
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('100.00');
    view.rerender(createElement(OrderTicket, { ...stale, spendEditor: { ...props.spendEditor, value: '200.', spendCents: 20000 } }));
    expect(view.queryByText('Cost & most you can lose')).toBeNull();
    expect(view.queryByRole('slider')).toBeNull();
    view.rerender(createElement(OrderTicket, { ...stale, contract: { ...props.contract!, contractId: 25 } }));
    expect(view.queryByText('Cost & most you can lose')).toBeNull();
    view.rerender(createElement(OrderTicket, stale));
    act(() => { quote.set(null); });
    expect(view.queryByText('Cost & most you can lose')).toBeNull();
    expect(view.queryByRole('slider')).toBeNull();
    expect(view.queryByRole('button', { name: /Buy ticket|Cash out|Retry/ })).toBeNull();
  });

  it('shows server zero quantity and zero cost without inventing a payoff curve', () => {
    const { props, quote } = setup();
    quote.set({ ...ANSWER, quantity: 0, costCents: 0, whatIf: [] });
    const view = render(createElement(OrderTicket, props));
    expect(view.getByText('Tickets').nextElementSibling?.textContent).toBe('0');
    expect(view.getByText('Cost & most you can lose').nextElementSibling?.textContent).toBe('$0');
    expect(view.queryByRole('slider')).toBeNull();
    view.rerender(createElement(OrderTicket, { ...props, contract: null }));
    expect(view.queryByRole('slider')).toBeNull();
    expect(view.queryByText('Cost & most you can lose')).toBeNull();
  });
  it('offers a labelled typed spend without a trading action', () => {
    const { props } = setup();
    const view = render(createElement(OrderTicket, props));
    expect(view.queryByRole('textbox', { name: 'How much to spend' })).not.toBeNull();
    expect(view.queryByRole('button', { name: /Buy ticket|Cash out|Retry safely/ })).toBeNull();
  });

  it('retains the chosen stop while a quote disappears and returns', () => {
    const { props, quote } = setup();
    const view = render(createElement(OrderTicket, props));
    fireEvent.change(view.getByRole('slider'), { target: { value: '2' } });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$86. Profit or loss +$100');
    act(() => { quote.set(null); });
    expect(view.queryByRole('slider')).toBeNull();
    act(() => { quote.set({ ...ANSWER, priceCents: 4900 }); });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$86. Profit or loss +$100');
  });

  it.each(['up', 'down'] as const)('shows the exact %s server stops, including the zero-profit stop', (side) => {
    const { props, quote } = setup();
    props.contract = { ...props.contract!, side };
    if (side === 'down') quote.set({ ...ANSWER, whatIf: [{ atCents: 8400, profitCents: 10000 }, { atCents: 8500, profitCents: 0 }, { atCents: 8600, profitCents: -10000 }] });
    const view = render(createElement(OrderTicket, props));
    const slider = view.getByRole('slider');
    expect(slider.getAttribute('type')).toBe('range');
    expect(slider.getAttribute('step')).toBe('1');
    expect(slider.getAttribute('aria-valuetext')).toBe('$85. Profit or loss $0');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider.getAttribute('aria-valuetext')).toBe(side === 'up' ? '$84. Profit or loss -$100' : '$84. Profit or loss +$100');
    fireEvent.change(slider, { target: { value: '2' } });
    expect(slider.getAttribute('aria-valuetext')).toBe(side === 'up' ? '$86. Profit or loss +$100' : '$86. Profit or loss -$100');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('$85. Profit or loss $0');
    expect(props.onDraftChange).toHaveBeenCalledTimes(1);
  });

  it('withholds mismatched money immediately and resets the stop for a new draft', () => {
    const { props, quote } = setup();
    const view = render(createElement(OrderTicket, props));
    fireEvent.change(view.getByRole('slider'), { target: { value: '2' } });
    const changed = { ...props, spendEditor: { ...props.spendEditor, value: '200.', spendCents: 20000 } };
    view.rerender(createElement(OrderTicket, changed));
    expect(view.queryByRole('slider')).toBeNull();
    expect(view.queryByText('Cost & most you can lose')).toBeNull();
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('200.');
    act(() => { quote.set({ ...ANSWER, spendCents: 20000, contractId: 25 }); });
    expect(view.queryByRole('slider')).toBeNull();
    act(() => { quote.set({ ...ANSWER, spendCents: 20000 }); });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$85. Profit or loss $0');
    view.rerender(createElement(OrderTicket, props));
    act(() => { quote.set(ANSWER); });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('$85. Profit or loss $0');
  });

  it('keeps raw controlled text and links invalid text to its explanation', () => {
    const { props } = setup();
    props.spendEditor = { ...props.spendEditor, value: '1.', spendCents: 100 };
    const view = render(createElement(OrderTicket, props));
    const input = view.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('1.');
    expect(input.inputMode).toBe('decimal');
    fireEvent.change(input, { target: { value: '1e3' } });
    expect(props.spendEditor.onChange).toHaveBeenCalledWith('1e3');
    view.rerender(createElement(OrderTicket, { ...props, spendEditor: { ...props.spendEditor, value: '1e3', spendCents: null, error: 'Enter an amount in dollars and cents.' } }));
    expect(input.value).toBe('1e3');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter an amount in dollars and cents.');
  });

  it('paces only draft changes, reports the latest, and cancels on unmount', () => {
    vi.useFakeTimers();
    const { props, quote } = setup();
    const view = render(createElement(OrderTicket, props));
    expect(props.onDraftChange).toHaveBeenLastCalledWith({ contractId: 24, spendCents: 10000 });
    act(() => { quote.set({ ...ANSWER, priceCents: 5100 }); });
    fireEvent.click(view.getByRole('button', { name: 'Close$90' }));
    expect(props.onPick).toHaveBeenCalledWith(25);
    const next = { ...props, spendEditor: { ...props.spendEditor, value: '200', spendCents: 20000 } };
    view.rerender(createElement(OrderTicket, next));
    view.rerender(createElement(OrderTicket, { ...next, spendEditor: { ...next.spendEditor, value: '300', spendCents: 30000 } }));
    act(() => { vi.advanceTimersByTime(999); });
    expect(props.onDraftChange).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(props.onDraftChange).toHaveBeenLastCalledWith({ contractId: 24, spendCents: 30000 });
    view.rerender(createElement(OrderTicket, next));
    view.unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(props.onDraftChange).toHaveBeenCalledTimes(2);
  });
});
