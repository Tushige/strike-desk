import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { PriceChartProps } from './ports';
import { pathOf } from './scale';

/**
 * The price chart: one company's price through the day, drawn in SVG.
 *
 * It fills whatever box it is put in and measures that box itself, so it
 * takes no width and no height. The prices come from a source outside React.
 */

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The size drawn before the box has been measured, and the size drawn where
 * there is no browser to measure with.
 */
const UNMEASURED: Size = { width: 640, height: 280 };

/** Room around the line, in pixels: words go above, below and to the right of it. */
const ROOM = { top: 24, right: 8, bottom: 24, left: 8 };

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

export const PriceChart = memo(function PriceChart(props: PriceChartProps): ReactElement {
  const { source, xMin, xMax, yMinCents, yMaxCents, label } = props;
  const [measure, size] = useMeasuredSize();
  // The third argument is what is read where there is no browser: the same series.
  const series = useSyncExternalStore(source.subscribe, source.series, source.series);

  const inner = {
    width: Math.max(0, size.width - ROOM.left - ROOM.right),
    height: Math.max(0, size.height - ROOM.top - ROOM.bottom),
  };

  const line = useMemo(
    () => pathOf(series, { xMin, xMax, yMinCents, yMaxCents, width: inner.width, height: inner.height }),
    [series, xMin, xMax, yMinCents, yMaxCents, inner.width, inner.height],
  );

  return (
    <div ref={measure} className="relative h-full w-full overflow-hidden">
      {/* Out of the flow, so the drawing's size can never push its own box wider or taller. */}
      <svg
        role="img"
        aria-label={label}
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
        className="absolute inset-0 block"
      >
        <g transform={`translate(${String(ROOM.left)},${String(ROOM.top)})`}>
          <rect width={inner.width} height={inner.height} className="fill-none stroke-border" />
          <path
            d={line}
            className="fill-none stroke-foreground stroke-[1.5]"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </div>
  );
});
