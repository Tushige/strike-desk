/**
 * The price chart: one company's share price through the day, with the lines
 * and markers that tell a trade's story. This file is its whole public face:
 * a series source outside React, the scale as plain numbers, and lines and
 * markers as plain data.
 *
 * The chart is SVG and measures its own box, so it takes no width and no
 * height. Turning cents into a pixel position is drawing; the chart derives
 * no amount that it shows as a number. The words on lines and markers arrive
 * already written. A marker the caller does not pass is not shown, so a
 * caller never passes a reveal marker before the frame says the headline is
 * revealed.
 *
 * What is deliberately absent, and why:
 * - A tooltip or a crosshair, zoom and pan, more than one series, candles,
 *   axis options: no screen of ours uses them.
 * - The lead-in before the open: it is not on the wire yet. `startIndex`
 *   leaves room for it.
 */

/** One company's share prices, oldest first. */
export interface Series {
  /**
   * The price index of `values[0]`: 0 for a day drawn from its open. It may be
   * negative, so that a lead-in before the open can arrive later without a
   * change here.
   */
  readonly startIndex: number;
  /** Share prices in whole cents, one per price index. May be empty before a game starts. */
  readonly values: readonly number[];
}

/**
 * Where the chart's prices come from. It lives outside React: the chart reads
 * it with `useSyncExternalStore` or from a ref, and draws at most once per
 * animation frame. Its two members are plain functions, not methods: each may
 * be handed on by itself.
 */
export interface SeriesSource {
  /**
   * The same object until a point arrives or the series starts again; then a
   * new object with a new `values` array. An object handed out is never
   * changed.
   */
  readonly series: () => Series;
  /** Told once each time `series()` would return another object. Returns the call that unsubscribes; calling it twice is harmless. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** A level drawn across the chart. */
export interface ChartLine {
  readonly id: string;
  /** A share price in cents. */
  readonly yCents: number;
  /** Already written, for example the target's price as text. */
  readonly label: string;
  readonly tone: 'target' | 'breakEven';
}

export type ChartMarkerKind = 'headline' | 'reveal' | 'entry' | 'exit' | 'bell';

/** A moment marked on the chart. */
export interface ChartMarker {
  readonly id: string;
  /** A price index. */
  readonly xIndex: number;
  /** Already written. */
  readonly label: string;
  readonly kind: ChartMarkerKind;
}

export interface PriceChartProps {
  readonly source: SeriesSource;
  /** Price indexes. The whole day is 0 and 500, so the line grows to the right and the bell has a place from the start. */
  readonly xMin: number;
  readonly xMax: number;
  /**
   * The scale, given by the caller from the day's board, its lowest and its
   * highest target; never from prices still to come. The chart may widen it to
   * hold a point it has already drawn, and never narrows it within a day.
   */
  readonly yMinCents: number;
  readonly yMaxCents: number;
  readonly lines: readonly ChartLine[];
  readonly markers: readonly ChartMarker[];
  /** The prices are no longer live: the chart looks stale. */
  readonly stale: boolean;
  /** The chart's accessible name. */
  readonly label: string;
}
