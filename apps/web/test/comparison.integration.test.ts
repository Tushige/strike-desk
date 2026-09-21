// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import { formatCents } from '@strike-desk/shared/money';
import { contractId, decodeContractId } from '@strike-desk/shared/protocol';
import type { Outbound } from '@strike-desk/shared/feed';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';

interface TestSocket extends SocketLike {
  ping: () => void;
  once: (event: 'pong', listener: () => void) => void;
}
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as
  new (url: string, options: { origin: string }) => TestSocket;

afterEach(() => {
  cleanup();
  vi.doUnmock('../src/feed/wsFeed');
  window.sessionStorage.clear();
});

it.each([null, 2500])('selects and previews a live contract through boot and the real server (board %s)', async (board) => {
  vi.resetModules();
  window.history.replaceState(null, '', board === null ? '/' : '/?board=2500');
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service readiness timeout: ${errors}`)), 30000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'url' in message && typeof message.url === 'string') {
        clearTimeout(timer);
        resolve(message.url);
      }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let unsubscribe = () => {};
  let sockets = 0;
  let socket: TestSocket | undefined;
  try {
    const url = await ready;
    const makeFeed = vi.fn((options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        sockets += 1;
        socket = new Socket(address, { origin: window.location.origin });
        return socket;
      } });
      feed = live;
      unsubscribe = live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send: (message: Outbound) => { outbound.push(message); return live.send(message); } };
    });
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: makeFeed }));
    const { store, comparisonStore } = await import('../src/boot');
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    await waitFor(() => expect(store.currentRows()).toHaveLength(board === null ? 252 : 2508), { timeout: 5000 });
    expect(view.queryByRole('textbox', { name: 'How much to spend' })).not.toBeNull();
    expect(view.queryByRole('combobox', { name: 'Company' })).not.toBeNull();
    expect(view.queryByRole('combobox', { name: 'Ticket' })).not.toBeNull();
    expect(view.queryByRole('checkbox', { name: 'Affordable for me' })).not.toBeNull();
    const grid = await view.findByRole('grid', { name: 'Contracts' });
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"]')).not.toBeNull());
    const row = grid.querySelector('.ag-row[row-id="0"]');
    if (row === null) throw new Error('missing first contract row');
    const cell = row.querySelector('[col-id="company"]');
    if (cell === null) throw new Error('missing company cell');
    fireEvent.click(cell);
    await waitFor(() => expect(comparisonStore.requested.get().contractId).toBe(0));
    const input = view.getByRole('textbox', { name: 'How much to spend' });
    fireEvent.change(input, { target: { value: '1000.50' } });
    expect(comparisonStore.requested.get()).toEqual({ contractId: 0, spendCents: 100050 });
    await waitFor(() => expect(outbound).toContainEqual({ t: 'draft', contractId: 0, spendCents: 100050 }), { timeout: 2000 });

    async function sample(advanceMs: number): Promise<Frame | null> {
      // A pong proves the service read every preceding draft before its clock advances.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket barrier timeout')), 3000);
        socket?.once('pong', () => { clearTimeout(timer); resolve(); });
        socket?.ping();
      });
      const count = messages.length;
      await act(async () => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { stop?.(); reject(new Error('sample timeout')); }, 5000);
          const stop = feed?.subscribe((event) => {
            if (event.type !== 'message') return;
            clearTimeout(timer);
            stop?.();
            resolve();
          });
          child.stdin.write(`${String(advanceMs)}\n`);
        });
      });
      expect(messages.length).toBe(count + 1);
      const newest = messages.at(-1);
      return newest?.t === 'frame' ? newest : null;
    }

    const first = await sample(1500);
    expect(first?.draft).toMatchObject({ contractId: 0, spendCents: 100050 });
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"] [col-id="costCents"]')?.textContent).toBe(formatCents(first?.draft?.costs?.[0] ?? -1)));
    expect((input as HTMLInputElement).value).toBe('1000.50');
    for (const [text, cents] of [['1.', 100], ['.50', 50], ['1000000000', 100000000000], ['', null]] as const) {
      fireEvent.change(input, { target: { value: text } });
      expect((input as HTMLInputElement).value).toBe(text);
      expect(comparisonStore.requested.get().spendCents).toBe(cents);
      expect(store.currentRows().every((current) => current.costCents === null)).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('false');
    }
    for (const text of ['-1', '+1', '1e3', '1.001', '0', '.', ' 1', '9007199254740992', '1000000000.01']) {
      fireEvent.change(input, { target: { value: text } });
      expect(comparisonStore.requested.get().spendCents).toBeNull();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(view.getByText('Enter an amount in dollars and cents.')).toBeTruthy();
      expect(view.queryByRole('slider')).toBeNull();
    }
    fireEvent.change(input, { target: { value: '50000' } });
    await waitFor(() => expect(outbound.at(-1)).toEqual({ t: 'draft', contractId: 0, spendCents: 5000000 }), { timeout: 2000 });
    const quoted = await sample(1500);
    const ticket = quoted?.draft?.ticket;
    if (quoted === null || ticket === undefined) throw new Error('missing server ticket');
    const panel = view.getByRole('region', { name: 'Your ticket' });
    const numbers = within(panel);
    expect(numbers.getByText('Ticket price').nextElementSibling?.textContent).toBe(formatCents(ticket.priceCents));
    expect(numbers.getByText('Tickets').nextElementSibling?.textContent).toBe(ticket.quantity.toLocaleString('en-US'));
    expect(numbers.getByText('Cost & most you can lose').nextElementSibling?.textContent).toBe(formatCents(ticket.costCents));
    expect(numbers.getByText('Profit at the bell if price is above').nextElementSibling?.textContent).toBe(formatCents(ticket.breakEvenCents));
    expect(ticket.priceCents).toBe(quoted.quotes[0]);
    expect(ticket.breakEvenCents).toBe(quoted.quoteBreakEvens[0]);
    expect(view.getAllByRole('button', { name: /Close|Far|Moonshot/ })).toHaveLength(6);
    const zero = ticket.whatIf.findIndex((stop) => stop.atCents === ticket.breakEvenCents && stop.profitCents === 0);
    expect(zero).toBeGreaterThanOrEqual(0);
    const slider = view.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.change(slider, { target: { value: String(zero) } });
    expect(slider.getAttribute('aria-valuetext')).toBe(`${formatCents(ticket.breakEvenCents)}. Profit or loss $0`);

    const companySelect = view.getByRole('combobox', { name: 'Company' });
    const sideSelect = view.getByRole('combobox', { name: 'Ticket' });
    const affordable = view.getByRole('checkbox', { name: 'Affordable for me' });
    const visibleRows = () => [...grid.querySelectorAll('.ag-row')].map((element) => ({
      element, row: store.currentRows().find((current) => current.id === element.getAttribute('row-id'))!,
    }));
    fireEvent.change(companySelect, { target: { value: '1' } });
    await waitFor(() => {
      expect(visibleRows().length).toBeGreaterThan(0);
      expect(visibleRows().every(({ row: current }) => current.companyId === 1)).toBe(true);
      expect(grid.querySelector('.ag-row[row-id="0"]')).toBeNull();
    });
    expect((input as HTMLInputElement).value).toBe('50000');
    expect(comparisonStore.requested.get()).toEqual({ contractId: 0, spendCents: 5000000 });
    expect((view.getByRole('slider') as HTMLInputElement).value).toBe(String(zero));
    fireEvent.change(sideSelect, { target: { value: 'up' } });
    fireEvent.click(affordable);
    await waitFor(() => {
      expect(visibleRows().length).toBeGreaterThan(0);
      expect(visibleRows().every(({ row: current }) => current.companyId === 1 && current.side === 'up' &&
        current.priceCents >= quoted.minTicketCents && current.priceCents <= quoted.account.cashCents && current.priceCents <= quoted.account.capCents &&
        decodeContractId(quoted.board!.targetsPerCompany, current.contractId).targetIndex >= quoted.board!.companies[1]!.lowestUpIndex)).toBe(true);
    });
    // The preview release deliberately cannot buy; this does not make every ticket unaffordable.
    expect(quoted.account.canBuy).toBe(false);
    const filterCell = grid.querySelector('.ag-cell')!;
    fireEvent.focusIn(filterCell);
    expect(view.getByText('Sorting and filters paused')).toBeTruthy();
    fireEvent.change(sideSelect, { target: { value: 'down' } });
    await waitFor(() => expect(visibleRows().every(({ row: current }) => current.side === 'down')).toBe(true));
    fireEvent.focusOut(filterCell, { relatedTarget: input });
    fireEvent.click(affordable);
    fireEvent.change(companySelect, { target: { value: '' } });
    fireEvent.change(sideSelect, { target: { value: '' } });
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"]')?.getAttribute('aria-selected')).toBe('true'));
    expect(view.queryByText('Sorting and filters paused')).toBeNull();
    const highlightIds = new Set(quoted.board!.companies[0]!.simpleUp.map((targetIndex) =>
      contractId(quoted.board!.targetsPerCompany, { companyId: 0, side: 'up', targetIndex })));
    for (const { element, row: current } of visibleRows()) expect(element.classList.contains('bg-accent/40')).toBe(highlightIds.has(current.contractId));

    for (const [column, field] of [
      ['company', 'company'], ['side', 'side'], ['targetCents', 'targetCents'], ['price', 'priceCents'],
      ['breakEvenCents', 'breakEvenCents'], ['costCents', 'costCents'], ['realCents', 'realCents'], ['hopeCents', 'hopeCents'],
    ] as const) {
      const header = grid.querySelector(`.ag-header-cell[col-id="${column}"]`)!;
      fireEvent.click(header.querySelector('.ag-header-cell-label')!);
      await waitFor(() => expect(header.getAttribute('aria-sort')).toBe('ascending'));
      const displayed = visibleRows();
      // Read each displayed position directly; recycled DOM creation order is not display order.
      for (let position = 1; position < displayed.length; position += 1) {
        const previous = displayed.find(({ element }) => element.getAttribute('row-index') === String(position - 1))?.row;
        const current = displayed.find(({ element }) => element.getAttribute('row-index') === String(position))?.row;
        if (previous === undefined || current === undefined || previous.dimmed || current.dimmed) continue;
        const left = previous[field]; const right = current[field];
        if (typeof left === 'number' && typeof right === 'number') expect(left).toBeLessThanOrEqual(right);
        else if (typeof left === 'string' && typeof right === 'string') expect(left <= right).toBe(true);
      }
    }

    fireEvent.change(slider, { target: { value: '0' } });
    await sample(23000); // The price path moves into the open market at pace three.
    expect((input as HTMLInputElement).value).toBe('50000');
    expect(comparisonStore.requested.get()).toEqual({ contractId: 0, spendCents: 5000000 });
    expect((view.getByRole('slider') as HTMLInputElement).value).toBe('0');
    expect(view.getByRole('grid', { name: 'Contracts' })).toBe(grid);

    const downChoices = view.getByRole('group', { name: 'DOWN ticket. Pays if the price ends below the target' });
    fireEvent.click(within(downChoices).getByRole('button', { name: /^Close/ }));
    const downId = comparisonStore.requested.get().contractId;
    expect(downId).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe('50000');
    expect(view.queryByRole('slider')).toBeNull();
    await waitFor(() => expect(outbound.at(-1)).toEqual({ t: 'draft', contractId: downId, spendCents: 5000000 }), { timeout: 2000 });
    const downFrame = await sample(1500);
    const downTicket = downFrame?.draft?.ticket;
    if (downTicket === undefined) throw new Error('missing DOWN answer');
    expect(downTicket.contractId).toBe(downId);
    const downZero = downTicket.whatIf.findIndex((stop) => stop.atCents === downTicket.breakEvenCents && stop.profitCents === 0);
    expect(downZero).toBeGreaterThanOrEqual(0);
    fireEvent.change(view.getByRole('slider'), { target: { value: '0' } });
    fireEvent.change(view.getByRole('slider'), { target: { value: String(downZero) } });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe(`${formatCents(downTicket.breakEvenCents)}. Profit or loss $0`);
    const tomorrow = await sample(40000);
    expect(tomorrow?.clock.day).toBe(2);
    expect(comparisonStore.requested.get()).toEqual({ contractId: null, spendCents: null });
    expect(comparisonStore.quote.get()).toBeNull();
    expect((view.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(view.queryByRole('slider')).toBeNull();
    const nextGrid = await view.findByRole('grid', { name: 'Contracts' });
    await waitFor(() => expect(nextGrid.querySelector('.ag-row[row-id="0"] [col-id="company"]')).not.toBeNull());
    const nextCell = nextGrid.querySelector('.ag-row[row-id="0"] [col-id="company"]');
    if (nextCell === null) throw new Error('missing next-day contract');
    fireEvent.keyDown(nextCell, { key: 'Enter' });
    await waitFor(() => expect(comparisonStore.requested.get()).toEqual({ contractId: 0, spendCents: null }));
    expect(view.queryByRole('slider')).toBeNull();
    expect(sockets).toBe(1);
    expect(makeFeed).toHaveBeenCalledTimes(1);
    expect(outbound.some((message) => message.t === 'buy' || message.t === 'cashOut')).toBe(false);
    expect(outbound.every((message) => message.t === 'start' || message.t === 'draft')).toBe(true);
    expect(view.queryByRole('button', { name: /Buy ticket|Cash out|Retry safely/ })).toBeNull();
  } finally {
    cleanup();
    unsubscribe();
    feed?.close();
    child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
  }
}, 45000);
