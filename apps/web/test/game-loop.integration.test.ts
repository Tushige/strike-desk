// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import type { Outbound } from '@strike-desk/shared/feed';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';

const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as
  new (url: string, options: { origin: string }) => SocketLike;

afterEach(() => {
  cleanup();
  vi.doUnmock('../src/feed/wsFeed');
  window.sessionStorage.clear();
});

it.each([
  [1, 'Start at normal speed'], [3, 'Start fast (3x)'], [7.5, 'Start turbo (7.5x)'],
] as const)('waits for an explicit start at pace %s and opens the server bell', async (pace, label) => {
  vi.resetModules();
  window.history.replaceState(null, '', '/');
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
        clearTimeout(timer); resolve(message.url);
      }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`service exited: ${errors}`)); });
  });
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let sockets = 0;
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        sockets += 1; return new Socket(address, { origin: window.location.origin });
      } });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send: (message: Outbound) => { outbound.push(message); return live.send(message); } };
    } }));
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    await waitFor(() => expect(messages[0]?.t).toBe('frame'));
    expect(outbound).toEqual([]);
    expect(view.getByText('Five trading days. Read the news, follow prices, and explore tickets.')).toBeTruthy();
    expect(view.getByText('Ticket preview only. Buying and cashing out are not available.')).toBeTruthy();
    async function sample(ms: number): Promise<Frame> {
      const count = messages.length;
      await act(async () => {
        child.stdin.write(`${String(ms)}\n`);
        await waitFor(() => expect(messages.length).toBe(count + 1));
      });
      const newest = messages.at(-1);
      if (newest?.t !== 'frame') throw new Error('missing sampled frame');
      return newest;
    }
    expect((await sample(1000000)).clock.phase).toBe('lobby');
    expect(outbound).toEqual([]);
    fireEvent.click(view.getByRole('button', { name: label }));
    expect(view.getByText('Checking...')).toBeTruthy();
    await view.findByRole('heading', { name: 'Day 1: before the bell' });
    expect(outbound.filter((message) => message.t !== 'draft')).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ t: 'start', pace });
    const reply = messages.at(-1);
    if (reply?.t !== 'reply') throw new Error('missing start reply');
    // $1,000,000 in cents; half is available as the cap. Preview spends nothing.
    expect(reply.frame.account).toEqual({ cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false });
    expect(view.getAllByText('$1,000,000').length).toBeGreaterThanOrEqual(2);
    const beforeBell = await sample(200);
    expect(beforeBell.prices).toEqual(reply.frame.prices);
    fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
    await view.findByRole('heading', { name: 'Day 1: the market is open' });
    expect(outbound.at(-1)).toMatchObject({ t: 'openBell', day: 1 });
    expect(view.getByText('Prices are moving. Compare tickets and explore what they could pay.')).toBeTruthy();
    expect(view.queryByText('Market number')).toBeNull();
    expect(view.queryByRole('button', { name: /Buy ticket|Cash out/ })).toBeNull();
    expect(sockets).toBe(1);
    expect(outbound.every((message) => message.t === 'start' || message.t === 'openBell' || message.t === 'draft')).toBe(true);
    for (const day of [1, 2, 3, 4, 5]) {
      // Let the server's input budget refill between deliberate day controls.
      // Even at turbo this stays within the pre-bell/open phase.
      await sample(2000);
      if (day !== 1) {
        fireEvent.click(view.getByRole('button', { name: 'Ring the opening bell' }));
        await view.findByRole('heading', { name: `Day ${String(day)}: the market is open` });
      }
      fireEvent.click(view.getByRole('button', { name: 'Skip to the closing bell' }));
      await view.findByRole('heading', { name: `Day ${String(day)}: closing bell` });
      expect(view.getByText('A quiet day.')).toBeTruthy();
      expect(view.getByText('Change today').nextElementSibling?.textContent).toBe('$0');
      expect(view.getByText('Ended the day with').nextElementSibling?.textContent).toBe('$1,000,000');
      expect(view.queryByText('Market number')).toBeNull();
      fireEvent.click(view.getByRole('button', { name: day === 5 ? 'See your final result' : `Go to day ${String(day + 1)}` }));
      await view.findByRole('heading', { name: day === 5 ? 'That was the final bell!' : `Day ${String(day + 1)}: before the bell` });
    }
    expect(view.getByText('You finished with').nextElementSibling?.textContent).toBe('$1,000,000');
    expect(view.getByText('Since the start').nextElementSibling?.textContent).toBe('$0');
    expect(view.getByText('Market number').nextElementSibling?.textContent).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/);
    expect(view.getByRole('table', { name: 'Day by day' }).querySelectorAll('tbody tr')).toHaveLength(5);
    const oldSession = reply.frame.session;
    const reload = vi.fn();
    const realWindow = window;
    vi.stubGlobal('window', new Proxy(realWindow, { get(target, key): unknown {
      return key === 'location' ? { ...target.location, reload } : Reflect.get(target, key);
    } }));
    fireEvent.click(view.getByRole('button', { name: 'Play again' }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    view.unmount(); feed?.close();
    // Recreate the page after the requested navigation. Feed's final frame
    // already forgot the old session; unrelated tab storage stays untouched.
    window.sessionStorage.setItem('unrelated', 'keep');
    vi.resetModules();
    const { default: FreshApp } = await import('../src/App');
    const freshView = render(createElement(FreshApp));
    await freshView.findByRole('button', { name: label });
    const fresh = messages.at(-1);
    if (fresh?.t !== 'frame') throw new Error('missing fresh lobby');
    expect(fresh.clock.phase).toBe('lobby');
    expect(fresh.session).not.toBe(oldSession);
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
  } finally {
    vi.unstubAllGlobals();
    cleanup(); feed?.close(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
  }
}, 45000);
