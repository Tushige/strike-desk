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

it.each([null, 2500])('uses a persistent simple panel over one connection with server trading permission (board %s)', async (board) => {
  vi.resetModules(); window.history.replaceState(null, '', board === null ? '/' : '/?board=2500');
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
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
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
  let sockets = 0;
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  let disposeStores = () => {};
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        sockets += 1; socket = new Socket(address, { origin: window.location.origin }); return socket;
      } });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send(message: Outbound) { outbound.push(message); return live.send(message); } };
    } }));
    const { default: App } = await import('../src/App');
    const boot = await import('../src/boot');
    disposeStores = () => { boot.buyFlow.dispose(); boot.deskFreshness.dispose(); boot.gameLoop.dispose(); };
    const view = render(createElement(App));
    fireEvent.click(await view.findByRole('button', { name: 'Start at normal speed' }));
    await view.findByRole('heading', { name: 'Day 1: before the bell' });
    const panel = view.queryByRole('region', { name: 'Your ticket' });
    expect(panel).not.toBeNull();
    if (panel === null) throw new Error('persistent ticket is missing');
    expect(view.queryByRole('grid', { name: 'Contracts' })).toBeNull();
    expect(within(panel).getAllByRole('button', { pressed: false })).toHaveLength(6);
    expect(boot.comparisonStore.requested.get().contractId).toBeNull();
    expect(outbound.filter((message) => message.t === 'buy')).toEqual([]);
    if (board !== null) {
      expect(boot.buyFlow.availability.get().stress).toBe(true);
      expect(boot.comparisonStore.account.get().canBuy).toBe(false);
      fireEvent.click(within(panel).getAllByRole('button', { name: /^Close/ })[0]!);
      fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '1000' } });
      const action = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Buy ticket' });
      expect(action.disabled).toBe(true); fireEvent.click(action);
      expect(outbound.filter((message) => message.t === 'buy')).toEqual([]);
      expect(sockets).toBe(1);
      return;
    }
    async function sample(ms: number): Promise<Frame> {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket?.once('pong', () => { clearTimeout(timer); resolve(); }); socket?.ping();
      });
      const before = messages.filter((message) => message.t === 'frame').length;
      await act(async () => {
        child.stdin.write(`${String(ms)}\n`);
        await waitFor(() => { expect(messages.filter((message) => message.t === 'frame')).toHaveLength(before + 1); });
      });
      const newest = messages.at(-1);
      if (newest?.t !== 'frame') throw new Error('sample missing'); return newest;
    }
    const spend = within(panel).getByRole<HTMLInputElement>('textbox', { name: 'How much to spend' });
    fireEvent.click(within(panel).getAllByRole('button', { name: /^Close/ })[0]!);
    const selected = boot.comparisonStore.requested.get().contractId;
    expect(selected).not.toBeNull();
    fireEvent.change(spend, { target: { value: '1000.50' } });
    await waitFor(() => { expect(outbound).toContainEqual({ t: 'draft', contractId: selected, spendCents: 100050 }); }, { timeout: 2500 });
    const beforeBuy = await sample(200);
    const firstQuote = beforeBuy.draft?.ticket;
    expect(firstQuote).toBeDefined();
    expect((within(panel).getByRole<HTMLButtonElement>('button', { name: 'Buy ticket' })).disabled).toBe(false);
    fireEvent.change(within(panel).getByRole('slider'), { target: { value: '0' } });
    const chosenStop = within(panel).getByRole('slider').getAttribute('aria-valuetext');
    const disclosure = view.getByRole('button', { name: 'Compare options' });
    fireEvent.click(disclosure);
    await view.findByRole('grid', { name: 'Contracts' });
    fireEvent.change(view.getByRole('combobox', { name: 'Company' }), { target: { value: '1' } });
    fireEvent.click(within(view.getByRole('list', { name: 'Companies' })).getByRole('button', { name: /Fizzly/ }));
    await sample(200);
    fireEvent.click(disclosure);
    expect(view.getByRole('textbox', { name: 'How much to spend' })).toBe(spend);
    expect(spend.value).toBe('1000.50');
    expect(boot.comparisonStore.requested.get().contractId).toBe(selected);
    expect(within(panel).getByRole('slider').getAttribute('aria-valuetext')).toBe(chosenStop);
    expect(outbound.filter((message) => message.t === 'buy')).toHaveLength(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Buy ticket' }));
    expect(within(panel).getByRole('status').textContent).toBe('Pending...');
    await waitFor(() => { expect(within(panel).getByRole('status').textContent).toBe('Accepted. The ticket is yours.'); });
    const first = messages.find((message) => message.t === 'reply' && message.receipt.kind === 'buy');
    if (first?.t !== 'reply') throw new Error('missing real buy reply');
    expect(first.receipt.outcome).toBe('accepted');
    expect(first.frame.positions[0]).toMatchObject({ contractId: selected, entryPriceCents: firstQuote!.priceCents, costCents: firstQuote!.costCents });
    expect(first.frame.account.cashCents).toBeLessThan(100000000);
    expect(first.frame.account.canBuy).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
    await view.findByRole('heading', { name: 'Day 1: the market is open' });
    await sample(2000);
    fireEvent.click(view.getByRole('button', { name: 'Skip to the closing bell' }));
    await view.findByRole('heading', { name: 'Day 1: closing bell' });
    fireEvent.click(view.getByRole('button', { name: 'Go to day 2' }));
    await view.findByRole('heading', { name: 'Day 2: before the bell' });
    expect((view.getByRole('textbox', { name: 'How much to spend' }) as HTMLInputElement).value).toBe('');
    expect(boot.comparisonStore.requested.get().contractId).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
    await view.findByRole('heading', { name: 'Day 2: the market is open' });
    const secondPanel = view.getByRole('region', { name: 'Your ticket' });
    fireEvent.click(within(secondPanel).getAllByRole('button', { name: /^Close/ })[0]!);
    fireEvent.change(within(secondPanel).getByRole('textbox'), { target: { value: '1000' } });
    await waitFor(() => { expect(outbound.at(-1)).toMatchObject({ t: 'draft', spendCents: 100000 }); }, { timeout: 2500 });
    await sample(2000);
    fireEvent.click(within(secondPanel).getByRole('button', { name: 'Buy ticket' }));
    await waitFor(() => { expect(messages.filter((message) => message.t === 'reply' && message.receipt.kind === 'buy')).toHaveLength(2); });
    expect(messages.at(-1)).toMatchObject({ t: 'reply', receipt: { outcome: 'accepted' }, frame: { clock: { phase: 'open', day: 2 } } });
    expect(outbound.filter((message) => message.t === 'buy')).toHaveLength(2);
    expect(sockets).toBe(1);
    expect((view.getByRole('button', { name: 'Cash out' }) as HTMLButtonElement).disabled).toBe(false);
    expect(outbound.filter((message) => message.t === 'cashOut')).toEqual([]);
  } finally {
    cleanup(); feed?.close(); disposeStores(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    }); lines.close();
  }
}, 45000);
