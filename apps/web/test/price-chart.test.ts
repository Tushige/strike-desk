import { describe, expect, it } from 'vitest';
import { pathOf, xOf, yOf } from '../src/modules/price-chart/scale';

/**
 * The chart's drawing maths: where a price index and a price land in a box of
 * pixels, and the text of the line through them. Every expected value is typed
 * in, with its arithmetic beside it.
 */

describe('where a price index lands across the box', () => {
  it('is half of the way along for the middle index', () => {
    // 250 is half of the way from 0 to 500; half of 600 is 300.
    expect(xOf(250, 0, 500, 600)).toBe(300);
  });

  it('is the left edge for the first index and the right edge for the last', () => {
    expect(xOf(0, 0, 500, 600)).toBe(0);
    expect(xOf(500, 0, 500, 600)).toBe(600);
  });

  it('is left of the box for an index before the first', () => {
    // Two steps before 0, at 600 / 500 = 1.2 pixels a step: -2.4.
    expect(xOf(-2, 0, 500, 600)).toBe(-2.4);
  });

  it('keeps one decimal and no more', () => {
    // 1 of 3 steps across 100 pixels is 33.333...; one decimal is 33.3.
    expect(xOf(1, 0, 3, 100)).toBe(33.3);
  });
});

describe('where a price lands down the box', () => {
  it('is the middle for the middle price', () => {
    // 9,000 is half of the way from 8,000 to 10,000; half of 200 is 100.
    expect(yOf(9000, 8000, 10000, 200)).toBe(100);
  });

  it('is the top for the highest price', () => {
    expect(yOf(10000, 8000, 10000, 200)).toBe(0);
  });

  it('is the bottom for the lowest price', () => {
    expect(yOf(8000, 8000, 10000, 200)).toBe(200);
  });
});

describe('the text of the price line', () => {
  const box = { xMin: 0, xMax: 500, yMinCents: 8000, yMaxCents: 9000, width: 500, height: 100 };

  it('moves to the first point and draws a line to each one after it', () => {
    // One pixel a step across. Down the box, each price is 100 times one minus
    // its share of the way from 8,000 to 9,000:
    //   8,400 is 0.40 of the way: 60.  8,450 is 0.45: 55.  8,300 is 0.30: 70.
    expect(pathOf({ startIndex: 0, values: [8400, 8450, 8300] }, box)).toBe('M0,60L1,55L2,70');
  });

  it('is empty for an empty series', () => {
    expect(pathOf({ startIndex: 0, values: [] }, box)).toBe('');
  });

  it('starts left of the box when the series starts before the first index', () => {
    // The first value sits at index -2, one pixel a step: x is -2, then -1, then 0.
    expect(pathOf({ startIndex: -2, values: [8400, 8450, 8300] }, box)).toBe('M-2,60L-1,55L0,70');
  });

  it('never writes a position with more than one decimal', () => {
    // 3 steps across 100 pixels and 7 price steps down 100 pixels: thirds and sevenths.
    const text = pathOf(
      { startIndex: 0, values: [1, 2, 3, 5] },
      { xMin: 0, xMax: 3, yMinCents: 0, yMaxCents: 7, width: 100, height: 100 },
    );

    // x: 0, 33.333, 66.666, 100. y: 100 * (1 - 1/7) = 85.714, (1 - 2/7) = 71.428, (1 - 3/7) = 57.142, (1 - 5/7) = 28.571.
    expect(text).toBe('M0,85.7L33.3,71.4L66.7,57.1L100,28.6');
  });
});
