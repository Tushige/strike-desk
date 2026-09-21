import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LabPage } from '../src/lab/LabPage';
import { LAB_ENTRIES, orderEntries } from '../src/lab/registry';
import type { LabEntry } from '../src/lab/types';

/**
 * The page is rendered to static markup rather than into a document: these
 * tests run in the node environment beside every other test in the repository,
 * and what they are about is what the page says, which is the same either way.
 */

/** How many times `needle` appears in `text`. */
function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** A stand-in block, so a test can say only the part it is about. */
function block(over: Partial<LabEntry> & Pick<LabEntry, 'id' | 'order'>): LabEntry {
  return {
    title: 'A block',
    summary: 'What this block does.',
    builtAgainst: 'its port',
    ...over,
  };
}

function markupOf(entries: readonly LabEntry[]): string {
  return renderToStaticMarkup(createElement(LabPage, { entries }));
}

/** Every block the lab lists, in the order it lists them. */
const IDS = ['live-grid', 'price-chart', 'order-ticket', 'command-path', 'connection', 'news-engine', 'desk'];

/** Their names, as the list and the panel head show them. */
const TITLES = [
  'Live grid',
  'Price chart',
  'Order ticket',
  'Server command path',
  'Connection and reconnect',
  'News engine',
  'Desk pieces',
];

describe('the register of blocks', () => {
  /**
   * Whether a block is built yet is its own file's business: a block turns
   * itself from a placeholder into a built one by setting `demo` in its own
   * `*.lab.ts`, and nothing here says how many have. Anything that counted
   * them would make every block's branch edit this same file.
   */
  it('holds the seven blocks, in the order they claim, each one well formed', () => {
    expect(LAB_ENTRIES.map((one) => one.id)).toEqual(IDS);
    expect(LAB_ENTRIES.map((one) => one.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(LAB_ENTRIES.map((one) => one.id)).size).toBe(IDS.length);
    expect(new Set(LAB_ENTRIES.map((one) => one.order)).size).toBe(IDS.length);

    for (const entry of LAB_ENTRIES) {
      expect(entry.title, `${entry.id} has a name`).toBeTruthy();
      expect(entry.summary, `${entry.id} says what it does`).toBeTruthy();
      expect(entry.builtAgainst, `${entry.id} names the port it is built against`).toBeTruthy();
      // Either it is not built yet, or it loads the demo that shows it.
      expect(['undefined', 'function'], `${entry.id} either has no demo or loads one`).toContain(typeof entry.demo);
    }
  });

  it('puts the blocks in the order each file claims, whatever order they arrive in', () => {
    const sorted = orderEntries([block({ id: 'second', order: 2 }), block({ id: 'first', order: 1 })]);

    expect(sorted.map((one) => one.id)).toEqual(['first', 'second']);
  });

  it('refuses two files that claim the same id, and names it', () => {
    expect(() => orderEntries([block({ id: 'live-grid', order: 1 }), block({ id: 'live-grid', order: 2 })])).toThrow(
      'two lab files claim the id live-grid',
    );
  });

  it('refuses two files that claim the same place in the list, and names both', () => {
    expect(() => orderEntries([block({ id: 'live-grid', order: 1 }), block({ id: 'price-chart', order: 1 })])).toThrow(
      'lab files live-grid and price-chart claim the same place in the list',
    );
  });
});

describe('the lab page', () => {
  it('names itself, every block, the port the selected one is built against and its state', () => {
    const markup = markupOf(LAB_ENTRIES);

    expect(markup).toContain('Module lab');
    for (const title of TITLES) {
      expect(markup).toContain(title);
    }
    expect(markup).toContain('Built against');
    // The selected block's panel says where that block stands, whichever of
    // the two states it is in. Which blocks are built is not this test's
    // business: the two states are pinned on stand-in blocks below.
    expect(markup).toMatch(/not built yet|Loading…/);
  });

  it('links nowhere but its own fragments', () => {
    const markup = markupOf(LAB_ENTRIES);

    const targets = [...markup.matchAll(/href="([^"]*)"/g)].map((found) => found[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target?.startsWith('#')).toBe(true);
    }
  });

  it('shows a block that is not built as not built yet, in the list and in its panel', () => {
    const waiting = block({ id: 'a-waiting-block', order: 1 });

    const markup = markupOf([waiting]);

    // Once in the list, once more in the selected block's panel.
    expect(countOf(markup, 'not built yet')).toBe(2);
    expect(markup).not.toContain('Loading…');
  });

  it('shows a block that is built loading its demo, and not the not-built state', () => {
    const built = block({
      id: 'a-built-block',
      order: 1,
      demo: () => Promise.resolve({ default: () => createElement('p', null, 'the block itself') }),
    });

    const markup = markupOf([built]);

    expect(markup).toContain('Loading…');
    expect(markup).not.toContain('not built yet');
  });
});
