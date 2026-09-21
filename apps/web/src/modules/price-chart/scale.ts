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

/** The lowest and the highest price the chart has room for, in cents. */
export interface PriceRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The range moved out just far enough to hold these prices, and never moved
 * in. It sees only the prices it is handed, so handing it only what the series
 * already holds is what keeps the scale from giving away a price still to
 * come. The same object comes back when nothing had to move.
 */
export function widenRange(range: PriceRange, values: readonly number[]): PriceRange {
  let { min, max } = range;
  for (const cents of values) {
    if (cents < min) min = cents;
    if (cents > max) max = cents;
  }
  return min === range.min && max === range.max ? range : { min, max };
}

/** The chart's range as a day goes on, with what it needs to know when to start again. */
export interface FollowedRange extends PriceRange {
  /** The caller's scale this range started from. */
  readonly from: PriceRange;
  /** How many prices the series held when this range was worked out. */
  readonly count: number;
}

/**
 * The range to draw this series in, given the range drawn in before.
 *
 * It starts from the caller's scale and only widens while the day goes on.
 * It starts again from the caller's scale when the series starts again (it
 * holds fewer prices than before), and when the caller's scale itself changes,
 * as it does when the chart is pointed at another company: what one company's
 * prices widened must not carry over to the next.
 */
export function followRange(held: FollowedRange | null, caller: PriceRange, series: Series): FollowedRange {
  const startsAgain =
    held === null ||
    series.values.length < held.count ||
    held.from.min !== caller.min ||
    held.from.max !== caller.max;
  const widened = widenRange(startsAgain ? caller : held, series.values);
  return { min: widened.min, max: widened.max, from: caller, count: series.values.length };
}

/**
 * Positions down the box for labels that should not sit on top of each other:
 * taken from the top, any label closer than `gap` to the one above it moves
 * down to the gap. Each answer stays at its label's place in the list.
 */
export function spreadApart(positions: readonly number[], gap: number): number[] {
  const topFirst = positions.map((position, place) => ({ position, place })).sort((a, b) => a.position - b.position);
  const spread = [...positions];
  let floor = Number.NEGATIVE_INFINITY;
  for (const { position, place } of topFirst) {
    const settled = Math.max(position, floor);
    spread[place] = settled;
    floor = settled + gap;
  }
  return spread;
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
