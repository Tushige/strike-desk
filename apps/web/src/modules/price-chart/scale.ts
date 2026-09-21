import type { Series } from './ports';

/**
 * The chart's drawing maths, free of React and of the browser: where a price
 * index and a price land in a box of pixels, and the text of the line through
 * them.
 *
 * Turning cents into a position is drawing. Nothing here makes an amount that
 * is shown as a number.
 */

/** The scale and the size of the box the line is drawn in. */
export interface ChartBox {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMinCents: number;
  readonly yMaxCents: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One decimal is finer than a screen shows, and it keeps the text of a
 * 500-point line short.
 */
function toOneDecimal(position: number): number {
  return Math.round(position * 10) / 10;
}

/** How far along `from`..`to` a value sits: 0 at `from`, 1 at `to`. A scale with no length puts everything at its start. */
function shareOf(value: number, from: number, to: number): number {
  return to === from ? 0 : (value - from) / (to - from);
}

/** Pixels from the left edge for a price index. Outside `xMin`..`xMax` it lands outside the box, and is not pulled in. */
export function xOf(index: number, xMin: number, xMax: number, width: number): number {
  return toOneDecimal(shareOf(index, xMin, xMax) * width);
}

/** Pixels from the top edge for a price in cents: the highest price is the top. */
export function yOf(cents: number, yMinCents: number, yMaxCents: number, height: number): number {
  return toOneDecimal((1 - shareOf(cents, yMinCents, yMaxCents)) * height);
}

/**
 * The `d` of the price line: a move to the first point, then a line to each
 * one after it. Empty for an empty series.
 */
export function pathOf(series: Series, box: ChartBox): string {
  let text = '';
  series.values.forEach((cents, offset) => {
    const x = xOf(series.startIndex + offset, box.xMin, box.xMax, box.width);
    const y = yOf(cents, box.yMinCents, box.yMaxCents, box.height);
    text += `${offset === 0 ? 'M' : 'L'}${String(x)},${String(y)}`;
  });
  return text;
}
