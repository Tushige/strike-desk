import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NewsEngineDemo, { NewsSheetView, readSheet } from '../src/lab/modules/news-engine.demo';
import type { NewsSheet } from '../src/lab/modules/news-engine.demo';

/**
 * The lab's news page, rendered to static markup from a small sheet typed in
 * here: what the page says is the same as in a browser, and these tests run
 * under node beside every other test.
 */

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
