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
import { formatCents } from '@strike-desk/shared/money';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import type { Outbound } from '@strike-desk/shared/feed';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';

interface TestSocket extends SocketLike { ping(): void; once(event: 'pong', listener: () => void): void }
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as
  new (url: string, options: { origin: string }) => TestSocket;
const ABSENT_LEGACY_THEME_PROPERTIES = new Set([
  '--ag-grid-size', '--ag-active-color', '--ag-alpine-active-color', '--ag-balham-active-color',
  '--ag-material-primary-color', '--ag-header-foreground-color', '--ag-control-panel-background-color',
  '--ag-cell-horizontal-border', '--ag-header-column-separator-color',
]);
afterEach(() => { cleanup(); vi.doUnmock('../src/feed/wsFeed'); vi.restoreAllMocks(); window.sessionStorage.clear(); });

it.each([false, true])('keeps one chosen ticket while real rows and company filters change the view (keyboard=%s)', async (keyboard) => {
  vi.resetModules(); window.history.replaceState(null, '', '/');
  const computedStyle = globalThis.getComputedStyle;
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    return new Proxy(style, { get(target, key): unknown {
      if (key === 'getPropertyValue') return (name: string) => ABSENT_LEGACY_THEME_PROPERTIES.has(name) ? '' : target.getPropertyValue(name);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  const child = spawn('pnpm', ['--filter', '@strike-desk/server', 'exec', 'tsx', 'test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = ''; child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`service readiness timeout: ${errors}`)); }, 30000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'url' in message && typeof message.url === 'string') { clearTimeout(timer); resolve(message.url); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let socket: TestSocket | undefined;
  let heldTrade: Outbound | null = null;
  let holdTrades = false;
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  let disposeStores = () => {};
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        socket = new Socket(address, { origin: window.location.origin }); return socket;
      } });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send(message: Outbound) {
        outbound.push(message);
        if (holdTrades && (message.t === 'buy' || message.t === 'cashOut')) { heldTrade = message; return false; }
        return live.send(message);
      } };
    } }));
    const { default: App } = await import('../src/App');
    const boot = await import('../src/boot');
    disposeStores = () => { boot.buyFlow.dispose(); boot.deskFreshness.dispose(); boot.gameLoop.dispose(); };
    const view = render(createElement(App));
    async function sample(ms = 0): Promise<Frame> {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket!.once('pong', () => { clearTimeout(timer); resolve(); }); socket!.ping();
      });
      const before = messages.filter((message) => message.t === 'frame').length;
      await act(async () => { child.stdin.write(`${String(ms)}\n`); await waitFor(() => { expect(messages.filter((message) => message.t === 'frame')).toHaveLength(before + 1); }); });
      const frame = messages.at(-1); if (frame?.t !== 'frame') throw new Error('missing sample'); return frame;
    }

    fireEvent.click(await view.findByRole('button', { name: 'Start at normal speed' }));
    await view.findByRole('heading', { name: 'Day 1: before the bell' });
    fireEvent.click(view.getByRole('button', { name: 'Compare options' }));
    const grid = await view.findByRole('grid', { name: 'Contracts' });
    const first = await sample();
    const input = view.getByRole('textbox', { name: 'How much to spend' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1000.50' } });
    const companyFilter = view.getByRole('combobox', { name: 'Company' }) as HTMLSelectElement;
    const sideFilter = view.getByRole('combobox', { name: 'Ticket' }) as HTMLSelectElement;
    const affordable = view.getByRole('checkbox', { name: 'Affordable for me' }) as HTMLInputElement;
    fireEvent.change(sideFilter, { target: { value: 'up' } });
    fireEvent.click(affordable);
    const header = grid.querySelector('.ag-header-cell[col-id="company"]')!;
    fireEvent.click(header.querySelector('.ag-header-cell-label')!);
    await waitFor(() => { expect(header.getAttribute('aria-sort')).toBe('ascending'); });
    const rowCell = async (companyId?: number) => {
      let cell: HTMLElement | null = null;
      await waitFor(() => {
        if (companyId !== undefined) expect([...grid.querySelectorAll('.ag-row')].every((element) =>
          boot.store.currentRows().find((item) => item.id === element.getAttribute('row-id'))?.companyId === companyId)).toBe(true);
        const row = [...grid.querySelectorAll('.ag-row')].find((element) => companyId === undefined ||
          boot.store.currentRows().find((item) => item.id === element.getAttribute('row-id'))?.companyId === companyId);
        cell = row?.querySelector<HTMLElement>('[col-id="company"]') ?? null;
        expect(cell).not.toBeNull();
      });
      return cell!;
    };
    const pick = (cell: HTMLElement) => {
      if (keyboard) {
        fireEvent.pointerDown(cell, { pointerType: 'mouse' });
        act(() => { cell.focus(); });
        expect(cell.classList.contains('ag-cell-focus')).toBe(true);
        expect(document.activeElement).toBe(cell);
        fireEvent.keyDown(cell, { key: 'Enter', code: 'Enter' });
      }
      else fireEvent.click(cell);
    };
    const firstCell = await rowCell();
    pick(firstCell);
    const chosenId = Number(firstCell.closest('.ag-row')!.getAttribute('row-id'));
    const chosenCompany = boot.store.currentRows().find((row) => row.contractId === chosenId)!.companyId;
    const otherCompany = (chosenCompany + 1) % first.companies.length;
    await waitFor(() => { expect(boot.comparisonStore.requested.get()).toEqual({ contractId: chosenId, spendCents: 100050 }); });
    expect(companyFilter.value).toBe('');
    expect(sideFilter.value).toBe('up');
    expect(affordable.checked).toBe(true);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    if (keyboard) await waitFor(() => { expect(document.activeElement?.closest('.ag-row')?.getAttribute('row-id')).toBe(String(chosenId)); });
    expect(outbound.filter((message) => message.t === 'buy' || message.t === 'cashOut')).toEqual([]);

    // Explicit filtering follows the viewed company, but never replaces the draft.
    fireEvent.change(companyFilter, { target: { value: String(otherCompany) } });
    expect(view.getByRole('img', { name: first.companies[otherCompany]!.name })).toBeTruthy();
    expect(view.getByText(`Viewing ${first.companies[otherCompany]!.name}. Your draft is for ${first.companies[chosenCompany]!.name}.`)).toBeTruthy();
    expect(boot.comparisonStore.requested.get().contractId).toBe(chosenId);
    expect(view.getByRole('textbox', { name: 'How much to spend' })).toBe(input);
    expect(input.value).toBe('1000.50');
    expect(boot.comparisonStore.requested.get().contractId).toBe(chosenId);
    const otherCell = await rowCell(otherCompany);
    pick(otherCell);
    const otherId = Number(otherCell.closest('.ag-row')!.getAttribute('row-id'));
    await waitFor(() => { expect(boot.comparisonStore.requested.get().contractId).toBe(otherId); });
    expect(companyFilter.value).toBe(String(otherCompany));
    expect(view.queryByText(/^Viewing .*Your draft/)).toBeNull();
    if (keyboard) await waitFor(() => { expect(document.activeElement?.closest('.ag-row')?.getAttribute('row-id')).toBe(String(otherId)); });
    expect(input.value).toBe('1000.50');
    expect(sideFilter.value).toBe('up');
    expect(affordable.checked).toBe(true);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(outbound.filter((message) => message.t === 'buy' || message.t === 'cashOut')).toEqual([]);
    fireEvent.change(companyFilter, { target: { value: '' } });
    expect(view.getByRole('img', { name: first.companies[otherCompany]!.name })).toBeTruthy();
    expect(boot.comparisonStore.requested.get().contractId).toBe(otherId);
    // Simple choices share the same editor and preserve every table setting.
    const panel = view.getByRole('region', { name: 'Your ticket' });
    fireEvent.click(within(panel).getAllByRole('button', { name: /^Close/ })[0]!);
    const buyId = boot.comparisonStore.requested.get().contractId;
    expect(buyId).not.toBeNull();
    expect(input.value).toBe('1000.50');
    expect(companyFilter.value).toBe('');
    expect(sideFilter.value).toBe('up');
    expect(affordable.checked).toBe(true);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    await waitFor(() => { expect(outbound.at(-1)).toEqual({ t: 'draft', contractId: buyId, spendCents: 100050 }); }, { timeout: 2500 });
    await sample(200);
    holdTrades = true;
    fireEvent.click(within(panel).getByRole('button', { name: 'Buy ticket' }));
    expect(within(panel).getByRole('status').textContent).toBe('Checking...');
    const originalBuy = heldTrade;
    expect(originalBuy).toMatchObject({ t: 'buy', contractId: buyId });
    fireEvent.change(companyFilter, { target: { value: String(chosenCompany) } });
    pick(await rowCell(chosenCompany));
    await waitFor(() => { expect(view.getByRole('img', { name: first.companies[chosenCompany]!.name })).toBeTruthy(); });
    expect(boot.buyFlow.transaction.get()?.command).toEqual(originalBuy);
    expect(boot.comparisonStore.requested.get().contractId).toBe(buyId);
    holdTrades = false;
    act(() => { feed!.send(originalBuy!); });
    await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('Accepted. The ticket is yours.'); });
    const bought = boot.buyFlow.purchase.get()!;
    expect(bought.position.contractId).toBe(buyId);
    expect(view.getByRole('region', { name: 'Your ticket' })).toBe(panel);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('button', { name: 'Buy ticket' })).toBeNull();
    const backName = `Back to ${bought.companyName}`;
    fireEvent.click(view.getByRole('button', { name: backName }));
    expect(view.getByRole('img', { name: bought.companyName })).toBeTruthy();
    expect(companyFilter.value).toBe(String(chosenCompany));
    expect(sideFilter.value).toBe('up');
    expect(affordable.checked).toBe(true);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(view.queryByRole('button', { name: backName })).toBeNull();
    const purchasedBrowseCell = await rowCell(chosenCompany);
    const browsedId = purchasedBrowseCell.closest('.ag-row')!.getAttribute('row-id');
    pick(purchasedBrowseCell);
    await view.findByRole('button', { name: backName });
    if (keyboard) await waitFor(() => {
      expect(document.activeElement?.closest('.ag-row')?.getAttribute('row-id')).toBe(browsedId);
      expect(document.activeElement?.getAttribute('col-id')).toBe('company');
    });
    expect(boot.comparisonStore.requested.get().contractId).toBe(buyId);
    expect(boot.buyFlow.purchase.get()?.position.id).toBe(bought.position.id);
    holdTrades = true;
    fireEvent.click(within(panel).getByRole('button', { name: 'Cash out' }));
    const originalSale = heldTrade;
    expect(originalSale).toMatchObject({ t: 'cashOut', positionId: bought.position.id });
    fireEvent.click(view.getByRole('button', { name: backName }));
    expect(boot.buyFlow.transaction.get()?.command).toEqual(originalSale);
    expect(within(panel).getByRole('status').textContent).toBe('Checking...');
    holdTrades = false;
    act(() => { feed!.send(originalSale!); });
    await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('You cashed out'); });
    const sold = boot.buyFlow.purchase.get()!;
    fireEvent.change(companyFilter, { target: { value: '' } });
    fireEvent.click(within(view.getByRole('list', { name: 'Companies' })).getAllByRole('button')[chosenCompany]!);
    expect(companyFilter.value).toBe(String(chosenCompany));
    fireEvent.click(view.getByRole('button', { name: backName }));
    expect(companyFilter.value).toBe(String(chosenCompany));
    expect(within(panel).getByText('Money back in your pocket').nextElementSibling?.textContent).toBe(formatCents(sold.position.exit!.proceedsCents));
    expect(within(panel).getByText('If you had held on').nextElementSibling?.textContent).toContain(formatCents(sold.position.ifHeldCents!));
    pick(await rowCell(chosenCompany));
    await view.findByRole('button', { name: backName });
    expect(boot.comparisonStore.requested.get().contractId).toBe(buyId);
    expect(boot.buyFlow.purchase.get()).toEqual(sold);
    fireEvent.change(companyFilter, { target: { value: String(bought.position.companyId) } });
    const targetHeader = grid.querySelector('.ag-header-cell[col-id="targetCents"]')!;
    fireEvent.click(targetHeader.querySelector('.ag-header-cell-label')!);
    fireEvent.click(targetHeader.querySelector('.ag-header-cell-label')!);
    await waitFor(() => {
      expect(targetHeader.getAttribute('aria-sort')).toBe('descending');
      expect([...grid.querySelectorAll('.ag-row[aria-selected="true"]')].map((row) => row.getAttribute('row-id'))).toEqual([String(buyId)]);
    });
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('button', { name: 'Cash out' })).toBeNull();
    expect(outbound.filter((message) => message.t === 'buy')).toHaveLength(1);
    expect(outbound.filter((message) => message.t === 'cashOut')).toHaveLength(1);
    expect(messages.filter((message) => message.t === 'error')).toEqual([]);
  } finally {
    cleanup(); feed?.close(); disposeStores(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    lines.close();
  }
}, 45000);
