import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { browserFrame, createFrameCoalescer } from './frameCoalescer';
import type { ChartLine, ChartMarker, ChartMarkerKind, PriceChartProps } from './ports';
import { followRange, pathOf, spreadApart, xOf, yOf } from './scale';
import type { FollowedRange } from './scale';

/**
 * The price chart: one company's price through the day, drawn in SVG, with
 * the levels and the moments that tell a trade's story.
 *
 * It fills whatever box it is put in and measures that box itself, so it
 * takes no width and no height. The prices come from a source outside React,
 * and however fast they arrive the chart draws at most once per animation
 * frame.
 *
 * It shows no number of its own. The words on a line or a marker arrive
 * already written; turning cents into a position is drawing. That is also why
 * there are no price labels down the side: they would be numbers the chart
 * had worked out.
 */

/** The one string that is the chart's own: shown over the drawing while the prices are not live. */
export const STALE_NOTE = 'Prices are old';

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The size drawn before the box has been measured, and the size drawn where
 * there is no browser to measure with.
 */
const UNMEASURED: Size = { width: 640, height: 280 };

/** Room above and below the line for the markers' words, and a little at the left, in pixels. */
const ROOM = { top: 26, bottom: 26, left: 8 };

/** Room at the right for the lines' words: this much, or less in a narrow box. */
const WORDS_AT_RIGHT = 132;
const WORDS_AT_RIGHT_SHARE = 0.3;

/** The least distance between two lines' words, so that one never sits on the other. */
const WORDS_GAP = 13;

/** The size of an element's box in whole pixels, kept in state and followed as the box changes. */
function useMeasuredSize(): [(element: HTMLDivElement | null) => void, Size] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>(UNMEASURED);

  useEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.contentRect;
      if (box === undefined) return;
      const next = { width: Math.round(box.width), height: Math.round(box.height) };
      // The same object when nothing changed, so a box that has not moved draws nothing.
      setSize((held) => (held.width === next.width && held.height === next.height ? held : next));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);

  return [setElement, size];
}

/**
 * How each kind of moment is drawn. No two kinds share both a rail and a
 * shape, so a kind is never told apart by its colour alone: news sits on the
 * top rail, the player's own moves on the bottom one, and the bell is a
 * heavier rule with no shape at all.
 */
const MARKER_LOOK: Record<ChartMarkerKind, { rail: 'top' | 'bottom'; rule: string; shape: string; dashes?: string }> = {
  headline: { rail: 'top', rule: 'stroke-ring/60', shape: 'fill-ring', dashes: '2 3' },
  reveal: { rail: 'top', rule: 'stroke-ring/60', shape: 'fill-ring', dashes: '2 3' },
  entry: { rail: 'bottom', rule: 'stroke-foreground/40', shape: 'fill-foreground' },
  exit: { rail: 'bottom', rule: 'stroke-foreground/40', shape: 'fill-none stroke-foreground' },
  bell: { rail: 'top', rule: 'stroke-muted-foreground stroke-[1.5]', shape: '' },
};

/** The small shape on a marker's rail, centred on (x, y). */
function MarkerShape({ kind, x, y, className }: { kind: ChartMarkerKind; x: number; y: number; className: string }): ReactElement | null {
  switch (kind) {
    case 'headline':
      // A diamond.
      return <path d={`M${String(x)},${String(y - 5)}l5,5l-5,5l-5,-5Z`} className={className} />;
    case 'reveal':
      return <circle cx={x} cy={y} r={4} className={className} />;
    case 'entry':
      // A triangle pointing into the chart.
      return <path d={`M${String(x)},${String(y - 5)}l5,9h-10Z`} className={className} />;
    case 'exit':
      // An open square.
      return <rect x={x - 4} y={y - 4} width={8} height={8} className={className} />;
    case 'bell':
      return null;
  }
}

/** Words near an edge grow inwards from their mark, so they are never cut off by the box. */
function anchorOf(x: number, width: number): 'start' | 'middle' | 'end' {
  if (x < width * 0.2) return 'start';
  if (x > width * 0.8) return 'end';
  return 'middle';
}

export const PriceChart = memo(function PriceChart(props: PriceChartProps): ReactElement {
  const { source, xMin, xMax, yMinCents, yMaxCents, lines, markers, stale, label } = props;
  const [measure, size] = useMeasuredSize();
  const clipId = useId();

  // The source's notifications reach React through the coalescer: many points
  // in, one draw per animation frame out.
  const subscribe = useCallback(
    (draw: () => void) => {
      const coalescer = createFrameCoalescer(browserFrame, draw);
      const unsubscribe = source.subscribe(coalescer.notify);
      return () => {
        unsubscribe();
        coalescer.cancel();
      };
    },
    [source],
  );
  // The third argument is what is read where there is no browser: the same series.
  const series = useSyncExternalStore(subscribe, source.series, source.series);

  // The range the chart has drawn in so far this day. It is worked out from
  // the range before it, so it is kept between renders; and the same inputs
  // always give the same answer, so working it out twice in a row is harmless.
  const heldRange = useRef<FollowedRange | null>(null);
  const range = followRange(heldRange.current, { min: yMinCents, max: yMaxCents }, series);
  heldRange.current = range;

  const wordsAtRight = Math.min(WORDS_AT_RIGHT, Math.round(size.width * WORDS_AT_RIGHT_SHARE));
  const width = Math.max(0, size.width - ROOM.left - wordsAtRight);
  const height = Math.max(0, size.height - ROOM.top - ROOM.bottom);

  const line = useMemo(
    () => pathOf(series, { xMin, xMax, yMinCents: range.min, yMaxCents: range.max, width, height }),
    [series, xMin, xMax, range.min, range.max, width, height],
  );

  // The newest price gets a dot, so that a day of one point is still something to see.
  const lastCents = series.values.at(-1);
  const lastIndex = series.startIndex + series.values.length - 1;
  const newest =
    lastCents !== undefined && lastIndex >= xMin && lastIndex <= xMax
      ? { x: xOf(lastIndex, xMin, xMax, width), y: yOf(lastCents, range.min, range.max, height) }
      : null;

  // A line or a marker off the scale is not drawn. It stays in the list below.
  const drawnLines = lines.filter((one) => one.yCents >= range.min && one.yCents <= range.max);
  const drawnMarkers = markers.filter((one) => one.xIndex >= xMin && one.xIndex <= xMax);
  const levelOf = (one: ChartLine): number => yOf(one.yCents, range.min, range.max, height);
  const momentOf = (one: ChartMarker): number => xOf(one.xIndex, xMin, xMax, width);
  const wordsAt = spreadApart(drawnLines.map(levelOf), WORDS_GAP);

  return (
    <div ref={measure} className="relative h-full w-full overflow-hidden">
      {/*
        The dimming is on this wrapper rather than on the SVG element, where a
        browser can fade it cheaply. The SVG is out of the flow, so its size
        can never push its own box wider or taller.
      */}
      <div
        className={`absolute inset-0 motion-safe:transition-opacity motion-safe:duration-300 ${stale ? 'opacity-45 grayscale' : ''}`}
      >
        <svg
          role="img"
          aria-label={label}
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
          className="block text-[11px] tabular-nums"
        >
          <defs>
            {/* A little taller than the box, so a line running along its top or bottom edge keeps its full thickness. */}
            <clipPath id={clipId}>
              <rect x={0} y={-2} width={width} height={height + 4} />
            </clipPath>
          </defs>
          <g transform={`translate(${String(ROOM.left)},${String(ROOM.top)})`}>
            <rect width={width} height={height} className="fill-none stroke-border" />

            {drawnMarkers.map((one) => {
              const look = MARKER_LOOK[one.kind];
              const x = momentOf(one);
              const onTop = look.rail === 'top';
              return (
                <g key={one.id}>
                  <line
                    data-kind={one.kind}
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={height}
                    className={look.rule}
                    strokeDasharray={look.dashes}
                  />
                  <MarkerShape kind={one.kind} x={x} y={onTop ? 0 : height} className={look.shape} />
                  <text
                    x={x}
                    y={onTop ? -11 : height + 19}
                    textAnchor={anchorOf(x, width)}
                    className="fill-muted-foreground"
                  >
                    {one.label}
                  </text>
                </g>
              );
            })}

            {drawnLines.map((one, place) => {
              const y = levelOf(one);
              const isTarget = one.tone === 'target';
              return (
                <g key={one.id}>
                  <line
                    data-tone={one.tone}
                    x1={0}
                    x2={width}
                    y1={y}
                    y2={y}
                    className={isTarget ? 'stroke-gold' : 'stroke-muted-foreground/70'}
                    strokeDasharray={isTarget ? undefined : '5 4'}
                  />
                  <text
                    x={width + 8}
                    y={wordsAt[place] ?? y}
                    dominantBaseline="middle"
                    className={isTarget ? 'fill-gold' : 'fill-muted-foreground'}
                  >
                    {one.label}
                  </text>
                </g>
              );
            })}

            <g clipPath={`url(#${clipId})`}>
              <path
                d={line}
                className="fill-none stroke-foreground stroke-[1.5]"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
            {newest === null ? null : <circle cx={newest.x} cy={newest.y} r={3} className="fill-foreground" />}
          </g>
        </svg>
      </div>

      {/*
        What the image holds, in words, for someone who cannot see it: the
        lines and the moments. The prices themselves are never read out.
      */}
      <ul className="sr-only">
        {lines.map((one) => (
          <li key={`line-${one.id}`}>{one.label}</li>
        ))}
        {markers.map((one) => (
          <li key={`marker-${one.id}`}>{one.label}</li>
        ))}
      </ul>

      {stale ? (
        <p className="absolute left-4 top-9 m-0 rounded-sm border border-border bg-muted px-2 py-0.5 text-xs text-foreground">
          {STALE_NOTE}
        </p>
      ) : null}
    </div>
  );
});
