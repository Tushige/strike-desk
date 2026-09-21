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
  it('holds the seven blocks, in the order they claim, none of them built yet', () => {
    expect(LAB_ENTRIES.map((one) => one.id)).toEqual(IDS);
    expect(LAB_ENTRIES.map((one) => one.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(LAB_ENTRIES.map((one) => one.demo)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
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
    // Seven in the list, once more in the selected block's panel.
    expect(countOf(markup, 'not built yet')).toBe(8);
  });

  it('links nowhere but its own fragments', () => {
    const markup = markupOf(LAB_ENTRIES);

    const targets = [...markup.matchAll(/href="([^"]*)"/g)].map((found) => found[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target?.startsWith('#')).toBe(true);
    }
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
