// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173"}
/// <reference types="node" />

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@strike-desk/shared/protocol';
import { createWsFeed } from '../src/feed/wsFeed';
import type { SocketLike, WsFeedOptions } from '../src/feed/wsFeed';

afterEach(() => {
  cleanup();
  vi.doUnmock('../src/feed/wsFeed');
  window.sessionStorage.clear();
});

// Reuse the service's installed transport: jsdom's undici transport mixes
// Node and DOM Event realms under the test runner. This is still a real socket.
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as
  new (url: string, options: { origin: string }) => SocketLike;

it.each([null, 2500])('boot delivers three actual headlines beside the mounted live table (board %s)', async (board) => {
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
  let feed: ReturnType<typeof createWsFeed> | undefined;
  let unsubscribe = () => {};
  let sockets = 0;
  try {
    const serviceUrl = await ready;
    // Replace only connection configuration. Boot, autostart, Feed, both
    // stores, the desk cards and the contract table are the production code.
    const makeFeed = vi.fn((options: WsFeedOptions) => {
      feed = createWsFeed({ ...options, url: serviceUrl, createSocket: (url) => {
        sockets += 1;
        return new Socket(url, { origin: window.location.origin });
      } });
      unsubscribe = feed.subscribe((event) => {
        if (event.type === 'message') messages.push(event.message);
      });
      return feed;
    });
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: makeFeed }));
    const { store, newsStore } = await import('../src/boot');
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    await waitFor(() => expect(messages[1]?.t).toBe('reply'), { timeout: 5000 });
    const lobby = messages[0];
    if (lobby?.t !== 'frame') throw new Error('missing lobby');
    expect(lobby.news).toEqual([]);
    const reply = messages[1];
    if (reply?.t !== 'reply') throw new Error('missing start reply');
    expect(reply.frame.news).toHaveLength(3);
    expect(reply.frame.news.map((news) => news.trust).sort()).toEqual([1, 2, 3]);
    expect(new Set(reply.frame.news.map((news) => news.companyId)).size).toBe(3);
    expect(reply.receipt).toMatchObject({ kind: 'start', outcome: 'accepted' });
    // $1,000,000 × 100 cents, with half available as the spending cap.
    expect(reply.frame.account).toEqual({ cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false });
    expect(newsStore.getSnapshot().news).toHaveLength(3);
    for (const news of reply.frame.news) {
      const button = await view.findByRole('button', { name: news.title });
      const article = button.closest('article');
      if (article === null) throw new Error('headline has no card');
      const card = within(article);
      expect(card.getByText(news.source)).toBeTruthy();
      expect(card.getByText(news.body)).toBeTruthy();
      expect(card.getByText(reply.frame.companies[news.companyId]?.name ?? '')).toBeTruthy();
      expect(card.getByText(reply.frame.companies[news.companyId]?.ticker ?? '')).toBeTruthy();
      expect(card.getByText(`Trust: ${news.trust} of 3`)).toBeTruthy();
      expect(card.getByText(news.direction === 'up' ? 'This news says UP' : 'This news says DOWN')).toBeTruthy();
      expect(article.querySelector('header svg')).not.toBeNull();
    }
    const grid = await view.findByRole('grid', { name: 'Contracts' });
    const before = store.price(0).get();
    const quotesBefore = store.currentRows();
    await act(async () => {
      child.stdin.write('23000\n'); // At pace 3: 69 game seconds, nine seconds into open.
      await waitFor(() => expect(messages).toHaveLength(3));
    });
    await waitFor(() => expect(messages).toHaveLength(3));
    expect(store.price(0).get()).not.toBe(before);
    expect(store.currentRows()).not.toEqual(quotesBefore);
    // Six companies × 21 (ordinary) or 209 (stress) targets × two sides.
    expect(store.currentRows()).toHaveLength(board === null ? 252 : 2508);
    expect(view.getByRole('grid', { name: 'Contracts' })).toBe(grid);
    expect(makeFeed).toHaveBeenCalledTimes(1);
    expect(makeFeed.mock.calls[0]?.[0].board).toBe(board);
    expect(sockets).toBe(1);
  } finally {
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
