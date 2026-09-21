import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PriceChart } from '../src/modules/price-chart/index';
import type { PriceChartProps, Series, SeriesSource } from '../src/modules/price-chart/index';
import { STALE_NOTE } from '../src/modules/price-chart/PriceChart';
import { FAKE_LINES, FAKE_MARKERS, FAKE_RANGE } from '../src/modules/price-chart/fake';

/**
 * What the chart says, read off its markup. It is rendered to static markup
 * rather than into a document: these tests run without a browser, and the
 * chart draws at a size of its own until it has a box to measure.
 */

/** A series that stands still: three points of a day. */
function heldStill(series: Series): SeriesSource {
  return { series: () => series, subscribe: () => () => undefined };
}

const THREE_POINTS: Series = { startIndex: 0, values: [8_400, 8_450, 8_300] };

function markupOf(over: Partial<PriceChartProps>): string {
  return renderToStaticMarkup(
    createElement(PriceChart, {
      source: heldStill(THREE_POINTS),
      ...FAKE_RANGE,
      lines: FAKE_LINES,
      markers: FAKE_MARKERS,
      stale: false,
      label: 'The price of a company today',
      ...over,
    }),
  );
}

/** The opening tag of the level drawn for one line, picked out by the tone it says it has. */
function levelTag(markup: string, tone: string): string {
  const found = [...markup.matchAll(/<line\b[^>]*>/g)].map((one) => one[0]).find((tag) => tag.includes(`data-tone="${tone}"`));
  if (found === undefined) throw new Error(`no level is drawn for the ${tone} line`);
  return found;
}

const MARKER_WORDS = ['Headline', 'Bought', 'News out', 'Cashed out', 'Closing bell'];

describe('the price chart, as markup', () => {
  it('is one image with the name it was given', () => {
    const markup = markupOf({});

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="The price of a company today"');
  });

  it('draws the price line through the points it holds', () => {
    // A path that moves to a first point and draws on to two more.
    expect(markupOf({})).toMatch(/<path\b[^>]*\bd="M[^"L]+L[^"L]+L[^"L]+"/);
  });

  it('draws no price line for an empty series, and still renders', () => {
    // No markers either: some of their shapes are paths too, and this is about the price line.
    const markup = markupOf({ source: heldStill({ startIndex: 0, values: [] }), markers: [] });

    expect(markup).toContain('role="img"');
    expect(markup).not.toMatch(/<path\b[^>]*\bd="M/);
  });

  it('shows the words of each line and each marker', () => {
    const markup = markupOf({});

    expect(markup).toContain('Target $85.00');
    expect(markup).toContain('Break-even $86.18');
    for (const words of MARKER_WORDS) {
      expect(markup).toContain(words);
    }
  });

  it('draws the break-even line dashed and the target line solid', () => {
    const markup = markupOf({});

    expect(levelTag(markup, 'breakEven')).toContain('stroke-dasharray');
    expect(levelTag(markup, 'target')).not.toContain('stroke-dasharray');
  });

  it('shows no marker that it was not given', () => {
    const markup = markupOf({ markers: [] });

    for (const words of MARKER_WORDS) {
      expect(markup).not.toContain(words);
    }
    // The lines are still there.
    expect(markup).toContain('Target $85.00');
  });

  it('lists the lines and markers for a screen reader, outside the image', () => {
    const markup = markupOf({});
    const afterTheImage = markup.slice(markup.indexOf('</svg>'));

    expect(afterTheImage).toContain('<li>Target $85.00</li>');
    expect(afterTheImage).toContain('<li>Closing bell</li>');
  });

  it('keeps a line and a marker that are off the scale in that list, though they are not drawn', () => {
    const markup = markupOf({
      lines: [{ id: 'far', yCents: 20_000, label: 'A target far above', tone: 'target' }],
      markers: [{ id: 'late', xIndex: 900, label: 'After the bell', kind: 'exit' }],
    });
    const image = markup.slice(0, markup.indexOf('</svg>'));
    const afterTheImage = markup.slice(markup.indexOf('</svg>'));

    expect(image).not.toContain('A target far above');
    expect(image).not.toContain('After the bell');
    expect(afterTheImage).toContain('<li>A target far above</li>');
    expect(afterTheImage).toContain('<li>After the bell</li>');
  });

  it('says in words when the prices are stale, and not otherwise', () => {
    expect(STALE_NOTE.length).toBeGreaterThan(0);
    expect(markupOf({ stale: true })).toContain(STALE_NOTE);
    expect(markupOf({ stale: false })).not.toContain(STALE_NOTE);
  });

  it('writes no colour as a value', () => {
    const markup = markupOf({ stale: true });

    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
  });
});
