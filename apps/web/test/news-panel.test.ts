// @vitest-environment jsdom

import { createElement, Profiler } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame } from '@strike-desk/shared/protocol';
import { Strip } from '../src/board/Strip';
import { newsStore as pageNews, store as gameStore } from '../src/boot';
import App from '../src/App';
import { NewsPanel } from '../src/news/NewsPanel';
import { createNewsStore } from '../src/news/newsStore';

vi.mock('../src/boot', async () => {
  const { createGameStore } = await import('../src/store/gameStore');
  const { createNewsStore } = await import('../src/news/newsStore');
  const { createComparisonStore } = await import('../src/comparison/comparisonStore');
  return { store: createGameStore(), newsStore: createNewsStore(), comparisonStore: createComparisonStore(() => true) };
});

afterEach(cleanup);

it('keeps the neutral reveal in its original live region without redrawing on prices', () => {
  const store = createNewsStore();
  const current = frame();
  store.ingest(current);
  const rendered = vi.fn();
  const view = render(createElement(Profiler, { id: 'news', onRender: rendered }, createElement(NewsPanel, { store })));
  const region = view.getByRole('status');
  expect(region.getAttribute('aria-live')).toBe('polite');
  expect(region.textContent).toBe('');
  const revealed: Frame = { ...current, step: 550, clock: { ...current.clock, priceIndex: 250 },
    news: current.news.map((news) => ({ ...news, revealed: news.companyId === 2, ...(news.companyId === 2 ? { revealIndex: 240 } : {}) })) };
  act(() => store.ingest(revealed));
  expect(view.getByRole('status')).toBe(region);
  expect(region.textContent).toContain('Plot twist!');
  expect(region.textContent).toContain('Third company');
  expect(view.getAllByText('The news is out')).toHaveLength(1);
  expect(region.querySelector('p')?.className).toContain('motion-reduce:transition-none');
  const snapshot = store.getSnapshot();
  const count = rendered.mock.calls.length;
  act(() => {
    store.ingest(revealed);
    store.ingest({ ...revealed, step: 551, prices: [10100], clock: { ...revealed.clock, priceIndex: 251 } });
    store.ingest({ t: 'quotes', session: current.session, rev: 1, step: 552, day: 1, priceIndex: 252, prices: [10100], changes: [] });
  });
  expect(store.getSnapshot()).toBe(snapshot);
  expect(rendered.mock.calls.length).toBe(count);
  expect(view.getByRole('status')).toBe(region);
  expect(region.textContent).not.toMatch(/turned out true|did not come true/i);
});

it('selects the latest passed reveal deterministically and ignores unrevealed or future entries', () => {
  const store = createNewsStore();
  const current = frame();
  const revealed: Frame = { ...current, step: 550, clock: { ...current.clock, priceIndex: 250 },
    news: current.news.map((news) => ({ ...news, revealed: true, revealIndex: news.companyId === 0 ? 200 : 240 })) };
  store.ingest({ ...revealed, news: [...revealed.news].reverse() });
  expect(store.getSnapshot().bannerCompanyName).toBe('Third company');
  store.ingest({ ...revealed, step: 551, news: revealed.news.map((news) => news.companyId === 4 ? { ...news, revealIndex: 250 } : news) });
  expect(store.getSnapshot().bannerCompanyName).toBe('Fifth company');
  store.ingest({ ...revealed, step: 552, news: revealed.news.map((news) => ({ ...news, revealed: news.companyId !== 4, revealIndex: news.companyId === 2 ? 251 : 200 })) });
  expect(store.getSnapshot().bannerCompanyName).toBe('First company');
});

it.each(['preBell', 'lobby', 'debrief', 'final'] as const)('clears the banner outside open, including %s with unchanged news', (phase) => {
  const store = createNewsStore();
  const current = frame();
  const revealed: Frame = { ...current, clock: { ...current.clock, priceIndex: 250 },
    news: current.news.map((news) => ({ ...news, revealed: true, revealIndex: 200 })) };
  store.ingest(revealed);
  expect(store.getSnapshot().bannerCompanyName).toBe('First company');
  store.ingest({ ...revealed, step: 600, clock: { ...revealed.clock, phase } });
  expect(store.getSnapshot().bannerCompanyName).toBeNull();
});

it('clears the banner across day and session changes without relying on a transition', () => {
  const store = createNewsStore();
  const current = frame();
  const revealed: Frame = { ...current, clock: { ...current.clock, priceIndex: 250 },
    news: current.news.map((news) => ({ ...news, revealed: true, revealIndex: 200 })) };
  store.ingest(revealed);
  store.ingest({ ...revealed, step: 1200, clock: { ...revealed.clock, day: 2 } });
  expect(store.getSnapshot().bannerCompanyName).toBeNull();
  store.ingest({ ...revealed, session: 'resumed-session' });
  expect(store.getSnapshot().bannerCompanyName).toBe('First company');
  store.ingest({ ...current, session: 'fresh-session' });
  expect(store.getSnapshot().bannerCompanyName).toBeNull();
});

function frame(): Frame {
  return {
    t: 'frame', session: 'card-session', rev: 1, step: 300,
    clock: { phase: 'open', day: 1, stepsLeft: 500, priceIndex: 0, pace: 1 },
    companies: [
      { name: 'First company', ticker: 'ONE' }, { name: 'Second company', ticker: 'TWO' },
      { name: 'Third company', ticker: 'THREE' }, { name: 'Fourth company', ticker: 'FOUR' },
      { name: 'Fifth company', ticker: 'FIVE' }, { name: 'Sixth company', ticker: 'SIX' },
    ],
    prices: [10000, 20000, 30000, 40000, 50000, 60000],
    minTicketCents: 500, board: null, quotes: [], quoteReals: [], quoteHopes: [], quoteBreakEvens: [],
    account: { cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false },
    positions: [], receipts: [], days: [], stress: false,
    news: [
      { id: 0, day: 1, companyId: 0, trust: 1, source: 'Source one', title: 'First headline', body: 'First body', direction: 'up', revealed: false },
      { id: 1, day: 1, companyId: 2, trust: 2, source: 'Source two', title: 'Second headline', body: 'Second body', direction: 'down', revealed: false },
      { id: 2, day: 1, companyId: 4, trust: 3, source: 'Source three', title: 'Third headline', body: 'Third body', direction: 'up', revealed: false },
    ],
  };
}

it('shows six distinct company marks in the strip, including companies without news', () => {
  const current = frame();
  gameStore.ingest(current);
  const view = render(createElement(Strip));
  const cards = view.getAllByRole('listitem');
  expect(cards).toHaveLength(6);
  expect(view.container.querySelectorAll('svg')).toHaveLength(6);
  expect(new Set([...view.container.querySelectorAll('svg')].map((svg) => svg.innerHTML)).size).toBe(6);
  cards.forEach((card, id) => {
    expect(within(card).getByText(current.companies[id]?.name ?? '')).toBeTruthy();
    expect(within(card).getByText(current.companies[id]?.ticker ?? '')).toBeTruthy();
    expect(card.querySelector(`.text-company-${id} svg`)).not.toBeNull();
  });
  expect(view.container.querySelectorAll('article')).toHaveLength(0);
});

it('selects the focused headline on a keyboard-generated click and resets on day and session changes', () => {
  const store = createNewsStore();
  const current = frame();
  store.ingest(current);
  const view = render(createElement(NewsPanel, { store }));
  const first = view.getByRole('button', { name: 'First headline' });
  first.focus();
  expect(document.activeElement).toBe(first);
  // Native button keyboard activation dispatches a click with detail zero.
  // Real Enter/Space handling and the focus ring are also checked in a browser.
  fireEvent.click(first, { detail: 0 });
  expect(first.getAttribute('aria-pressed')).toBe('true');
  const second = view.getByRole('button', { name: 'Second headline' });
  fireEvent.click(second, { detail: 0 });
  expect(first.getAttribute('aria-pressed')).toBe('false');
  expect(second.getAttribute('aria-pressed')).toBe('true');

  const tomorrow: Frame = { ...current, step: 900, clock: { ...current.clock, day: 2, phase: 'preBell' }, news: current.news.map((news) => ({ ...news, day: 2 })) };
  act(() => store.ingest(tomorrow));
  expect(view.getAllByRole('button').map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
  fireEvent.click(view.getByRole('button', { name: 'Second headline' }), { detail: 0 });
  act(() => store.ingest({ ...current, session: 'new-session', rev: 0, step: 0 }));
  expect(view.getAllByRole('button').map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
});

it.each([true, false])('escapes supplied text and never forwards an injected outcome (%s)', (wasTrue) => {
  const store = createNewsStore();
  const current = frame();
  store.ingest({ ...current, clock: { ...current.clock, phase: 'debrief', priceIndex: 500 }, news: current.news.map((news) => ({ ...news, revealed: true, wasTrue })) });
  // Deliberately bypass the store's allow-list too: the component must still
  // pick its public props instead of spreading an input into NewsCard.
  const snapshot = {
    ...store.getSnapshot(),
    news: store.getSnapshot().news.map((news) => ({
      ...news, wasTrue, outcome: wasTrue ? 'true' : 'false',
      title: `<img src=x onerror=alert(1)> ${news.id}`,
      body: '<script>alert(1)</script>',
    })),
  };
  const view = render(createElement(NewsPanel, { store: { ...store, getSnapshot: () => snapshot } }));
  expect(view.container.querySelectorAll('img, script')).toHaveLength(0);
  expect(view.container.textContent).toContain('<script>alert(1)</script>');
  expect(view.getByRole('button', { name: '<img src=x onerror=alert(1)> 0' })).toBeTruthy();
  expect(view.container.querySelector('[data-outcome]')).toBeNull();
  expect(view.container.textContent).not.toMatch(/turned out true|did not come true/i);
  expect(view.getAllByText('The news is out')).toHaveLength(3);
});

it('leaves an empty card region when news or its companies are absent', () => {
  const store = createNewsStore();
  const view = render(createElement(NewsPanel, { store }));
  expect(view.container.textContent).toBe('');
  act(() => store.ingest({ ...frame(), companies: [] }));
  expect(view.queryAllByRole('article')).toHaveLength(0);
  expect(view.container.textContent).toBe('');
  act(() => store.ingest({ ...frame(), news: [] }));
  expect(view.container.textContent).toBe('');
});

it('does not redraw the news panel or the application root while the price slice updates', () => {
  const current = { ...frame(), session: 'render-session' };
  gameStore.ingest(current);
  pageNews.ingest(current);
  const root = vi.fn(App);
  const panelRendered = vi.fn();
  const view = render(createElement(root));
  render(createElement(Profiler, { id: 'news', onRender: panelRendered }, createElement(NewsPanel, { store: pageNews })));
  const beforeRoot = root.mock.calls.length;
  const beforePanel = panelRendered.mock.calls.length;
  const snapshot = pageNews.getSnapshot();
  act(() => {
    const moving: Frame = { ...current, step: 310, prices: [10100, 20000, 30000, 40000, 50000, 60000], clock: { ...current.clock, priceIndex: 10, stepsLeft: 490 } };
    gameStore.ingest(moving);
    pageNews.ingest(moving);
  });
  expect(view.container.querySelector('.strip-price')?.textContent).toBe('$101'); // 10,100 cents / 100.
  expect(pageNews.getSnapshot()).toBe(snapshot);
  expect(root.mock.calls.length).toBe(beforeRoot);
  expect(panelRendered.mock.calls.length).toBe(beforePanel);
  expect(beforeRoot).toBeGreaterThan(0);
  expect(beforePanel).toBeGreaterThan(0);
});
