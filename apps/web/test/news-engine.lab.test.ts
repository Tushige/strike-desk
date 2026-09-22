// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewsEngineDemo, { NewsSheetView, readSheet } from '../src/lab/modules/news-engine.demo';
import type { NewsSheet } from '../src/lab/modules/news-engine.demo';

/**
 * The lab's news page, rendered to static markup from a small sheet typed in
 * here, plus DOM interaction tests for its native game buttons and list identity.
 */

afterEach(cleanup);

const SMALL_SHEET: NewsSheet = {
  pool: {
    sources: { 3: ['The head office says'], 2: ['A shop keeper says'], 1: ['A stranger says'] },
    situations: [
      { direction: 'up', title: '{name} has a great week', body: 'Everybody wants {product} this week.' },
      { direction: 'down', title: '{name} has a poor week', body: 'Nobody wants {product} this week.' },
    ],
  },
  games: [
    {
      label: 'Game A',
      headlines: [
        { day: 1, company: 'Kiteworks', trust: 3, direction: 'up', source: 'The head office says', title: 'Kiteworks has a great week', body: 'Everybody wants kites this week.' },
        { day: 1, company: 'Juicery', trust: 2, direction: 'down', source: 'A shop keeper says', title: 'Juicery has a poor week', body: 'Nobody wants juice this week.' },
        { day: 1, company: 'Snackbox', trust: 1, direction: 'up', source: 'A stranger says', title: 'Snackbox has a great week', body: 'Everybody wants snacks this week.' },
        { day: 2, company: 'Juicery', trust: 3, direction: 'up', source: 'The head office says', title: 'Juicery has a great week', body: 'Everybody wants juice this week.' },
      ],
    },
    {
      label: 'Game B',
      headlines: [{ day: 1, company: 'Snackbox', trust: 3, direction: 'down', source: 'The head office says', title: 'Snackbox has a poor week', body: 'Nobody wants snacks this week.' }],
    },
    {
      label: 'Game C',
      headlines: [{ day: 1, company: 'Kiteworks', trust: 1, direction: 'down', source: 'A stranger says', title: 'Kiteworks delivery delay', body: 'The delivery is late.' }],
    },
  ],
};

function markupOf(sheet: NewsSheet | null, initialGame?: number): string {
  return renderToStaticMarkup(createElement(NewsSheetView, { sheet, initialGame }));
}

/** Where `needle` first appears in `text`; the test fails on -1 before any order is compared. */
function placeOf(text: string, needle: string): number {
  const place = text.indexOf(needle);
  expect(place, `"${needle}" is on the page`).toBeGreaterThanOrEqual(0);
  return place;
}

describe('the news page of the lab', () => {
  it('keeps same-title variants distinct without duplicate list identities', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const sheet: NewsSheet = { ...SMALL_SHEET, pool: { ...SMALL_SHEET.pool, situations: [
        { direction: 'up', title: '{name} order', body: 'First batch.' },
        { direction: 'up', title: '{name} order', body: 'Second batch.' },
      ] } };
      const { rerender } = render(createElement(NewsSheetView, { sheet }));
      expect(screen.getByText('First batch.').closest('li')).not.toBe(screen.getByText('Second batch.').closest('li'));
      rerender(createElement(NewsSheetView, { sheet: { ...sheet, pool: { ...sheet.pool, situations: sheet.pool.situations.slice(1) } } }));
      expect(screen.queryByText('First batch.')).toBeNull();
      expect(screen.getAllByText('Second batch.')).toHaveLength(1);
      expect(errors.mock.calls).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('switches all three games through real button clicks and updates the pressed state', () => {
    render(createElement(NewsSheetView, { sheet: SMALL_SHEET }));
    const titles = ['Kiteworks has a great week', 'Snackbox has a poor week', 'Kiteworks delivery delay'];
    for (const index of [1, 2, 0]) {
      const label = ['Game A', 'Game B', 'Game C'][index];
      if (label === undefined) throw new Error('missing label');
      fireEvent.click(screen.getByRole('button', { name: label }));
      for (const [i, title] of titles.entries()) {
        expect(screen.queryByText(title) !== null).toBe(i === index);
      }
      for (const button of screen.getAllByRole('button')) {
        expect(button.getAttribute('aria-pressed')).toBe(button.textContent === label ? 'true' : 'false');
      }
    }
  });

  it('renders candidate-like markup only as text', () => {
    const sheet: NewsSheet = { ...SMALL_SHEET, pool: { ...SMALL_SHEET.pool, situations: [
      { direction: 'up', title: '<b>Title</b>', body: '<img src=x onerror=alert(1)>' },
    ] } };
    const { container } = render(createElement(NewsSheetView, { sheet }));
    expect(screen.getByText('<b>Title</b>')).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img, b')).toBeNull();
  });
  it('carries the id the built page is found by, and says in plain words that it runs no game code', () => {
    const markup = markupOf(SMALL_SHEET);

    expect(markup).toContain('id="lab-demo-news-engine"');
    expect(markup).toContain('This page runs no game code');
  });

  it('shows every source phrase under its trust level, in the game\'s words, most trusted first', () => {
    const page = markupOf(SMALL_SHEET);
    // Only the pool's own section: the games further down name the same phrases, and must not stand in for it.
    const markup = page.slice(placeOf(page, 'Who is speaking'), placeOf(page, 'What is said to have happened'));

    const solid = placeOf(markup, 'Solid news');
    const headOffice = placeOf(markup, 'The head office says');
    const couldBe = placeOf(markup, 'Could be true');
    const shopKeeper = placeOf(markup, 'A shop keeper says');
    const rumor = placeOf(markup, 'Wild rumor');
    const stranger = placeOf(markup, 'A stranger says');

    expect(solid < headOffice && headOffice < couldBe && couldBe < shopKeeper && shopKeeper < rumor && rumor < stranger).toBe(true);
  });

  it('shows every situation as written in the pool, title and body, good news before bad', () => {
    const markup = markupOf(SMALL_SHEET);

    const good = placeOf(markup, 'Claims good news');
    const greatWeek = placeOf(markup, '{name} has a great week');
    const bad = placeOf(markup, 'Claims bad news');
    const poorWeek = placeOf(markup, '{name} has a poor week');

    expect(markup).toContain('Everybody wants {product} this week.');
    expect(markup).toContain('Nobody wants {product} this week.');
    expect(good < greatWeek && greatWeek < bad && bad < poorWeek).toBe(true);
  });

  it('shows the first game by day: the trust level in words, the company, the source, the title and the body', () => {
    const markup = markupOf(SMALL_SHEET);

    const dayOne = placeOf(markup, 'Day 1');
    const kiteworks = placeOf(markup, 'Kiteworks has a great week');
    const dayTwo = placeOf(markup, 'Day 2');
    const juicery = placeOf(markup, 'Juicery has a great week');

    expect(dayOne < kiteworks && kiteworks < dayTwo && dayTwo < juicery).toBe(true);
    expect(markup).toContain('Everybody wants kites this week.');
    expect(markup).toContain('Kiteworks');
    // The other game is behind its button, not on the page.
    expect(markup).not.toContain('Snackbox has a poor week');
  });

  it('offers a button for each game and marks the one on show', () => {
    const first = markupOf(SMALL_SHEET);
    const second = markupOf(SMALL_SHEET, 1);

    expect(first).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Game A<\/button>/);
    expect(first).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Game B<\/button>/);
    expect(second).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Game B<\/button>/);
    expect(second).toContain('Snackbox has a poor week');
    expect(second).not.toContain('Kiteworks has a great week');
  });

  it('shows a plain message and no headline when the sheet is not a sheet', () => {
    expect(readSheet('not json at all')).toBeNull();
    expect(readSheet('{"games": 5}')).toBeNull();
    expect(readSheet('{"pool": {"sources": {}, "situations": []}, "games": []}')).toBeNull();

    const markup = markupOf(null);

    expect(markup).toContain('id="lab-demo-news-engine"');
    expect(markup).toContain('The news sheet could not be read.');
    expect(markup).not.toContain('<li');
    expect(markup).not.toContain('<button');
  });

  it('reads a sheet of the right shape back as it was written', () => {
    expect(readSheet(JSON.stringify(SMALL_SHEET))).toEqual(SMALL_SHEET);
  });

  it('reads the committed sheet: three games, and no failure message', () => {
    const markup = renderToStaticMarkup(createElement(NewsEngineDemo));

    expect(markup).not.toContain('The news sheet could not be read.');
    for (const label of ['Game A', 'Game B', 'Game C']) expect(markup).toContain(`>${label}</button>`);
  });
});
