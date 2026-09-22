// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173/?board=2500"}
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@strike-desk/shared/protocol';
import type { Feed, Outbound } from '@strike-desk/shared/feed';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';

afterEach(() => {
  cleanup(); vi.doUnmock('../src/feed/wsFeed'); vi.restoreAllMocks(); window.sessionStorage.clear();
});

it('measures real socket workload and a changing visible contract price through the actual controls', async () => {
  vi.resetModules();
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  // jsdom's window clock has a different origin from the Feed's global clock.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((run) => window.setTimeout(() => { run(performance.now()); }, 16));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { window.clearTimeout(id); });
  window.history.replaceState(null, '', '/?board=2500');
  interface BarrierSocket extends SocketLike { ping: () => void; once: (event: 'pong', listener: () => void) => void }
  const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as new (url: string, options: { origin: string }) => BarrierSocket;
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
  let feed: Feed | undefined;
  let socket: BarrierSocket | undefined;
  let socketCount = 0;
  const messages: ServerMessage[] = [];
  const outbound: Outbound[] = [];
  try {
    const url = await ready;
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: (options: WsFeedOptions) => {
      const live = createWsFeed({ ...options, url, createSocket: (address) => {
        socketCount += 1; socket = new Socket(address, { origin: window.location.origin }); return socket;
      } });
      feed = live;
      live.subscribe((event) => { if (event.type === 'message') messages.push(event.message); });
      return { ...live, send: (message: Outbound) => { outbound.push(message); return live.send(message); } };
    } }));
    const { store, stressMeasurements } = await import('../src/boot');
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    fireEvent.click(await view.findByRole('button', { name: 'Start fast (3x)' }));
    await waitFor(() => expect(store.currentRows()).toHaveLength(2508));
    fireEvent.click(view.getByRole('button', { name: 'Compare options' }));
    const grid = await view.findByRole('grid', { name: 'Contracts' });
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"] [col-id="price"]')).not.toBeNull());
    expect(view.getByText('Records/s')).toBeDefined();
    const before = grid.querySelector('.ag-row[row-id="0"] [col-id="price"]')!.textContent;
    async function sample(ms: number) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('socket barrier timeout')); }, 3000);
        socket?.once('pong', () => { clearTimeout(timer); resolve(); }); socket?.ping();
      });
      await act(async () => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { stop?.(); reject(new Error('sample timeout')); }, 5000);
          const stop = feed?.subscribe((event) => {
            if (event.type !== 'message') return;
            clearTimeout(timer); stop?.(); resolve();
          });
          child.stdin.write(`${String(ms)}\n`);
        });
      });
    }
    await sample(1500);
    await sample(23000);
    await waitFor(() => expect(grid.querySelector('.ag-row[row-id="0"] [col-id="price"]')!.textContent).not.toBe(before));
    await waitFor(() => expect(typeof stressMeasurements.get().clientDelay).toBe('object'), { timeout: 3000 });
    expect(stressMeasurements.get().records).toBeGreaterThan(0);
    expect(stressMeasurements.get().changes).toBeGreaterThan(0);
    await sample(200);
    expect(messages.some((message) => message.t === 'quotes' && message.changes.length > 0)).toBe(true);
    expect(socketCount).toBe(1);
    expect(outbound.every((message) => message.t === 'start' || message.t === 'draft')).toBe(true);
    expect(view.queryByRole('button', { name: /Buy ticket|Cash out|Retry/ })).toBeNull();
  } finally {
    cleanup(); feed?.close(); child.stdin.end('close\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
  }
}, 45000);
