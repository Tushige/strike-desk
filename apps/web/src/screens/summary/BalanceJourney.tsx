import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import type { DayResult } from '@strike-desk/shared/protocol';
import { money } from '../format';

gsap.registerPlugin(DrawSVGPlugin);
interface BalancePoint {
  day: number;
  cents: number;
  start: boolean;
}

/** Use recorded balances, not reconstructed profits. Missing days break the trace. */
export function balancePoints(days: readonly DayResult[]): BalancePoint[] {
  const points: BalancePoint[] = [];
  let previousDay = -1;
  for (const day of [...days].sort((a, b) => a.day - b.day)) {
    if (day.day !== previousDay + 1)
      points.push({ day: day.day - 1, cents: day.startCents, start: true });
    points.push({ day: day.day, cents: day.endCents, start: false });
    previousDay = day.day;
  }
  return points;
}

export function journeyGeometry(points: readonly BalancePoint[], width: number, height: number) {
  const low = Math.min(...points.map((point) => point.cents));
  const high = Math.max(...points.map((point) => point.cents));
  const padding = Math.max(1, (high - low) * 0.15);
  const coordinates = points.map((point) => ({
    x: (point.day === 0 ? 0.01 : (point.day - 0.5) / 5) * width,
    y: (0.88 - ((point.cents - low + padding) / (high - low + padding * 2)) * 0.76) * height,
  }));
  const segments: { path: string; length: number; start: number }[] = [];
  const distances: number[] = [];
  let total = 0;
  points.forEach((point, index) => {
    const current = coordinates[index]!;
    if (point.start)
      segments.push({
        path: `M${String(current.x)},${String(current.y)}`,
        length: 0,
        start: total,
      });
    else {
      const previous = coordinates[index - 1]!;
      const length = Math.hypot(current.x - previous.x, current.y - previous.y);
      const segment = segments[segments.length - 1]!;
      segment.path += ` L${String(current.x)},${String(current.y)}`;
      segment.length += length;
      total += length;
    }
    distances.push(total);
  });
  return { coordinates, segments, distances, total };
}

export function BalanceJourney({
  days,
  selected,
}: {
  days: readonly DayResult[];
  selected: number;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const points = balancePoints(days);
  const signature = points
    .map((point) => `${String(point.day)}:${String(point.cents)}:${String(point.start)}`)
    .join('|');
  useLayoutEffect(() => {
    const element = plot.current;
    if (!element || !points.length || typeof ResizeObserver === 'undefined') return;
    const svg = element.querySelector('svg')!;
    const paths = [...element.querySelectorAll<SVGPathElement>('.summary-chart-trace')];
    const dots = [...element.querySelectorAll<SVGCircleElement>('.summary-chart-dot')];
    const baseline = element.querySelector('line')!;
    let width = 0,
      height = 0;
    const layout = () => {
      width = element.clientWidth;
      height = element.clientHeight;
      const geometry = journeyGeometry(points, width, height);
      // One SVG unit is one rendered pixel: avoids nonuniform-scale cutoff.
      svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
      paths.forEach((path, index) => {
        path.setAttribute('d', geometry.segments[index]!.path);
      });
      dots.forEach((dot, index) => {
        dot.setAttribute('cx', String(geometry.coordinates[index]!.x));
        dot.setAttribute('cy', String(geometry.coordinates[index]!.y));
      });
      baseline.setAttribute('x1', String(width * 0.01));
      baseline.setAttribute('x2', String(width * 0.99));
      baseline.setAttribute('y1', String(geometry.coordinates[0]!.y));
      baseline.setAttribute('y2', String(geometry.coordinates[0]!.y));
      return geometry;
    };
    if (!element.clientWidth || !element.clientHeight) return;
    const geometry = layout();
    const timeline = gsap.timeline({ delay: 0.2 });
    const context = gsap.context(() => {
      // Split at missing records, while retaining one shared power2.out curve.
      geometry.segments.forEach((segment, index) => {
        const start = segment.start / geometry.total;
        const end = (segment.start + segment.length) / geometry.total;
        const startTime = 1 - Math.cbrt(1 - start);
        const endTime = 1 - Math.cbrt(1 - end);
        timeline.fromTo(
          paths[index]!,
          { drawSVG: '0%' },
          {
            drawSVG: '100%',
            duration: (endTime - startTime) * 1.5,
            ease: (progress: number) =>
              (1 - (1 - (startTime + progress * (endTime - startTime))) ** 3 - start) /
              (end - start),
          },
          startTime * 1.5,
        );
      });
      dots.forEach((dot, index) => {
        const fraction = geometry.total ? geometry.distances[index]! / geometry.total : 0;
        const arrival = 1.5 * (1 - Math.cbrt(1 - fraction));
        timeline.fromTo(
          dot,
          { opacity: 0, scale: 0.25, transformOrigin: '50% 50%' },
          { opacity: 1, scale: 1, duration: 0.24, ease: 'back.out(1.3)' },
          arrival,
        );
      });
      timeline.set(paths, { strokeDasharray: 'none', strokeDashoffset: 0 }, 1.5);
    }, element);
    const resize = new ResizeObserver(() => {
      if (element.clientWidth === width && element.clientHeight === height) return;
      if (!element.clientWidth || !element.clientHeight) return;
      timeline.progress(1).pause();
      layout();
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      timeline.kill();
      context.revert();
    };
    // Selection and equivalent server snapshots must not replay a completed journey.
  }, [signature]);
  const first = points[0],
    last = points[points.length - 1];
  if (!first || !last)
    return (
      <p className="summary-chart-empty">Daily balance records are not available for this run.</p>
    );
  const geometry = journeyGeometry(points, 1000, 200);
  const startLabel = first.day === 0 ? 'Start' : `Before day ${String(first.day + 1)}`;
  return (
    <div className="summary-chart">
      <div className="summary-chart-caption">
        <span>
          {startLabel} {money(first.cents)}
        </span>
        <span>
          End of day {last.day} · {money(last.cents)}
        </span>
      </div>
      <div
        ref={plot}
        className="summary-plot"
        role="img"
        aria-label={`Recorded balance: ${points.map((point) => `${point.start ? (point.day === 0 ? 'Start' : `Before day ${String(point.day + 1)}`) : `Day ${String(point.day)}`}, ${money(point.cents)}`).join('; ')}`}
      >
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
          <line
            className="summary-chart-baseline"
            x1="10"
            x2="990"
            y1={geometry.coordinates[0]!.y}
            y2={geometry.coordinates[0]!.y}
          />
          {geometry.segments.map((segment, index) => (
            <path key={index} className="summary-chart-trace" d={segment.path} />
          ))}
          {points.map((point, index) => (
            <circle
              key={`${String(point.day)}:${String(index)}`}
              r="4"
              className={`summary-chart-dot ${!point.start && point.day === selected ? 'is-selected' : ''}`}
              cx={geometry.coordinates[index]!.x}
              cy={geometry.coordinates[index]!.y}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
