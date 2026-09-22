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
import { createNewsStore } from '../src/news/newsStore';
import { NewsPanel } from '../src/news/NewsPanel';
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
  let activeSocket: SocketLike | undefined;
  const continuous = createNewsStore();
  let skipped: Frame | undefined;
  try {
    const serviceUrl = await ready;
    // Replace only connection configuration. Boot, explicit start, Feed, both
    // stores, the desk cards and the contract table are the production code.
    const makeFeed = vi.fn((options: WsFeedOptions) => {
      feed = createWsFeed({ ...options, url: serviceUrl, createSocket: (url) => {
        sockets += 1;
        activeSocket = new Socket(url, { origin: window.location.origin });
        return activeSocket;
      } });
      unsubscribe = feed.subscribe((event) => {
        if (event.type === 'message') {
          messages.push(event.message);
          continuous.ingest(event.message);
        }
      });
      const connectedFeed = feed;
      return { ...connectedFeed, subscribe: (listener: Parameters<typeof connectedFeed.subscribe>[0]) =>
        connectedFeed.subscribe((event) => {
          if (event.type === 'message' && event.message.t === 'frame' && skipped === undefined &&
            event.message.news.some((news) => news.revealed)) {
            skipped = event.message;
            return;
          }
          listener(event);
        }) };
    });
    vi.doMock('../src/feed/wsFeed', () => ({ createWsFeed: makeFeed }));
    const { store, newsStore } = await import('../src/boot');
    const { default: App } = await import('../src/App');
    const view = render(createElement(App));
    fireEvent.click(await view.findByRole('button', { name: 'Start fast (3x)' }));
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
    fireEvent.click(view.getByRole('button', { name: 'Compare options' }));
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

    const region = view.getAllByRole('status').find((element) => element.getAttribute('aria-live') === 'polite');
    expect(region?.textContent).toBe('');
    let beforeReveal: Frame | undefined;
    // From 23 seconds, each pass advances 4.5 game seconds. Every pass is
    // also a whole-frame deadline on the large board's 1.5-second cadence.
    for (let pass = 0; pass < 15 && skipped === undefined; pass += 1) {
      const prior = messages.at(-1);
      if (prior?.t === 'frame') beforeReveal = prior;
      const count = messages.length;
      await act(async () => {
        child.stdin.write('1500\n');
        await waitFor(() => expect(messages.length).toBe(count + 1));
      });
    }
    if (skipped === undefined || beforeReveal === undefined) throw new Error('no reveal in the bounded window');
    expect(region?.textContent).toBe('');
    expect(newsStore.getSnapshot().bannerCompanyName).toBeNull();
    const revealed = skipped.news.filter((news) => news.revealed);
    expect(revealed.length).toBeGreaterThan(0);
    const targets = skipped.board?.targetsPerCompany ?? 0;
    const eligible = skipped.quoteHopes.some((hope, id) => {
      const companyId = Math.floor(id / (targets * 2));
      return revealed.some((news) => news.companyId === companyId) &&
        Number.isInteger(hope) && hope < (beforeReveal.quoteHopes[id] ?? 0);
    });
    expect(eligible).toBe(true);
    const missedCount = messages.length;
    await act(async () => {
      child.stdin.write('1500\n');
      await waitFor(() => expect(messages.length).toBe(missedCount + 1));
    });
    const recovered = messages.at(-1);
    if (recovered?.t !== 'frame') throw new Error('whole frame did not recover news');
    expect(newsStore.getSnapshot()).toEqual(continuous.getSnapshot());
    const winner = [...recovered.news].filter((news) => news.revealed).sort((a, b) =>
      (b.revealIndex ?? -1) - (a.revealIndex ?? -1) || a.companyId - b.companyId || a.id - b.id)[0];
    if (winner === undefined) throw new Error('missing revealed headline');
    const companyName = recovered.companies[winner.companyId]?.name;
    expect(region?.textContent).toBe(`Plot twist!The news is out for ${companyName}. Watch the price.`);
    expect(view.getAllByText('The news is out')).toHaveLength(recovered.news.filter((news) => news.revealed).length);
    expect(view.container.textContent).not.toMatch(/turned out true|did not come true/i);
    expect(recovered.news).toHaveLength(3); // The other three companies stay quiet.
    const stable = newsStore.getSnapshot();
    const recoveredCount = messages.length;
    await act(async () => {
      child.stdin.write('200\n');
      await waitFor(() => expect(messages.length).toBe(recoveredCount + 1));
    });
    expect(messages.at(-1)?.t).toBe(board === null ? 'frame' : 'quotes');
    expect(newsStore.getSnapshot()).toBe(stable);

    // Attach before reconnect: a new store must recover from hello alone.
    const fresh = createNewsStore();
    const stopFresh = feed?.subscribe((event) => { if (event.type === 'message') fresh.ingest(event.message); });
    const reconnectCount = messages.length;
    await act(async () => {
      activeSocket?.close();
      await waitFor(() => expect(messages.length).toBe(reconnectCount + 1), { timeout: 5000 });
    });
    const resumed = messages.at(-1);
    expect(resumed?.t).toBe('frame');
    expect(fresh.getSnapshot()).toEqual(newsStore.getSnapshot());
    expect(fresh.getSnapshot().session).toBe(reply.frame.session);
    const freshView = render(createElement(NewsPanel, { store: fresh }));
    expect(freshView.container.querySelector('[role="status"]')?.textContent).toBe(region?.textContent);
    expect(messages.filter((message) => message.t === 'reply')).toHaveLength(1);
    expect(makeFeed).toHaveBeenCalledTimes(1);
    expect(sockets).toBe(2);
    stopFresh?.();
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
