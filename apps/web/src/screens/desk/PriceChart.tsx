import { useLayoutEffect, useRef, useState } from 'react';
import type { Frame, PositionView, Side } from '@strike-desk/shared/protocol';
import { OPEN_STEPS } from '@strike-desk/shared/time';
import { useSeries } from '../../store/hooks';
import { price } from '../format';
import { cx } from '../ui';

/**
 * The price chart: yesterday's tail, the opening bell, today's line so far,
 * and the lines that make a ticket make sense — the target and, a little
 * past it, the break-even. Every number drawn came from the server: the
 * prices from the frames, the target from the board, the break-even from the
 * quote. The chart works nothing out except where to put the pixels.
 *
 * The price scale is set from the board, whose targets reach two expected
 * moves either side of the opening price, so the axis cannot leak where the
 * price is heading. It only grows if a price or a line needs the room.
 */

export interface TargetLines {
  side: Side;
  targetCents: number;
  breakEvenCents: number;
}

/** The chart is drawn in real pixels, so it measures its own box and redraws on resize. */
function useSize(ref: { current: HTMLDivElement | null }): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}

const PAD_TOP = 56;
const PAD_BOTTOM = 44;
/** How much of the chart's width yesterday takes, left of the opening bell. */
const YESTERDAY_SHARE = 0.2;

export function PriceChart({
  frame,
  companyId,
  target,
  ticket,
  twist,
  compact = false,
}: {
  frame: Frame;
  companyId: number;
  target: TargetLines | null;
  /** Today's ticket on this company, for the entry and exit marks. */
  ticket: PositionView | null;
  /** Show the "Plot twist!" banner. */
  twist: boolean;
  compact?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const series = useSeries(companyId);
  const [inspect, setInspect] = useState<number | null>(null);

  const lead = series.leadIn;
  const today = series.today;
  const picking = frame.clock.phase === 'preBell';
  const opening = today[0] ?? lead[lead.length - 1] ?? frame.prices[companyId] ?? 0;
  const now = today[today.length - 1] ?? opening;
  const up = now >= opening;

  // Points are indexed from -lead.length (yesterday) through 0 (the opening
  // bell) to OPEN_STEPS (the closing bell).
  const points: [number, number][] = [];
  lead.forEach((cents, i) => points.push([i - lead.length, cents]));
  today.forEach((cents, i) => points.push([i, cents]));

  const targets = frame.board?.companies[companyId]?.targets;
  let lo = targets?.[0] ?? opening * 0.95;
  let hi = targets?.[targets.length - 1] ?? opening * 1.05;
  for (const [, cents] of points) {
    lo = Math.min(lo, cents * 0.996);
    hi = Math.max(hi, cents * 1.004);
  }
  if (target !== null) {
    lo = Math.min(lo, target.targetCents * 0.996, target.breakEvenCents * 0.996);
    hi = Math.max(hi, target.targetCents * 1.004, target.breakEvenCents * 1.004);
  }
  if (hi <= lo) hi = lo + 1;

  const padTop = compact ? 26 : PAD_TOP;
  const padBottom = compact ? 30 : PAD_BOTTOM;
  // Keep prices outside the drawing, and leave compact charts actual plot
  // height instead of spending most of their box on full-size annotations.
  const rightMargin = compact ? 152 : 76;
  const plotRight = Math.max(16, w - rightMargin);
  const plotBottom = Math.max(padTop + 1, h - padBottom);
  // Yesterday's tail gets a fixed fifth of the width whatever its point
  // count, so the opening bell always stands in the same place.
  const plotWidth = plotRight - 4;
  const bellX = 4 + plotWidth * YESTERDAY_SHARE;
  const x = (k: number): number =>
    k < 0 ? bellX + (k / Math.max(1, lead.length)) * plotWidth * YESTERDAY_SHARE : bellX + (k / OPEN_STEPS) * plotWidth * (1 - YESTERDAY_SHARE);
  const y = (cents: number): number => padTop + ((hi - cents) / (hi - lo)) * (plotBottom - padTop);
  const path = (from: number, to: number): string =>
    points
      .filter(([k]) => k >= from && k <= to)
      .map(([k, cents]) => `${x(k).toFixed(1)},${y(cents).toFixed(1)}`)
      .join(' ');

  const grid = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const openX = x(0);
  const dotX = x(today.length > 0 ? today.length - 1 : 0);
  const dotY = y(now);
  const clampY = (cents: number): number => Math.max(padTop, Math.min(plotBottom, y(cents)));
  const targetY = target === null ? 0 : clampY(target.targetCents);
  const breakEvenY = target === null ? 0 : clampY(target.breakEvenCents);
  const lineTone = picking ? 'stroke-cloud fill-cloud' : up ? 'stroke-mint fill-mint' : 'stroke-coral fill-coral';
  const entry = ticket !== null && ticket.companyId === companyId ? ticket : null;
  const entryPoint = entry === null ? null : points.find(([k]) => k === entry.entryPriceIndex) ?? null;
  const exitPoint = entry?.exit === undefined || entry.exit.kind !== 'cashOut' ? null : points.find(([k]) => k === entry.exit?.priceIndex) ?? null;
  const labelSide = dotX < (openX + plotRight) / 2 ? { right: rightMargin + 8 } : { left: openX + 8 };
  const reveal = frame.news.find((item) => item.companyId === companyId && item.day === frame.clock.day && item.revealed);
  const revealX = reveal?.revealIndex === undefined ? null : x(reveal.revealIndex);

  const inspected = inspect === null ? null : points[Math.min(inspect, points.length - 1)] ?? null;
  // Only server-provided prices in the compact rail, like the donor chart.
  // Separate close levels without moving their actual lines or price points.
  const levels = [
    ...(target === null ? [] : [
      { label: 'Target', cents: target.targetCents, tone: 'text-sun' },
      { label: 'Break-even', cents: target.breakEvenCents, tone: 'text-cloud' },
    ]),
  ].map((level) => ({ ...level, at: y(level.cents), labelY: y(level.cents) })).sort((a, b) => a.at - b.at);
  levels.forEach((level, i) => { level.labelY = Math.max(level.at, i === 0 ? padTop : (levels[i - 1]?.labelY ?? padTop) + 24); });
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    const level = levels[i];
    if (level !== undefined) level.labelY = Math.min(level.labelY, i === levels.length - 1 ? plotBottom : (levels[i + 1]?.labelY ?? plotBottom) - 24);
  }

  return (
    <div ref={box} className={cx('price-chart relative overflow-hidden rounded-[18px] bg-well', compact ? 'chart-compact h-[224px] shrink-0' : 'h-[380px] lg:h-auto lg:min-h-[180px] lg:flex-1')}
      tabIndex={0} role="group" aria-label="Observed price chart. Use left and right arrows to inspect received prices."
      onPointerLeave={() => { setInspect(null); }}
      onPointerMove={(event) => {
        const at = event.clientX - event.currentTarget.getBoundingClientRect().left;
        let nearest = 0;
        points.forEach(([k], i) => { if (Math.abs(x(k) - at) < Math.abs(x(points[nearest]?.[0] ?? 0) - at)) nearest = i; });
        setInspect(nearest);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setInspect(null);
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        setInspect(Math.max(0, Math.min(points.length - 1, (inspect ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
      }}>
      {w > 0 && h > 0 && (
        <>
          <svg width={w} height={h} className="absolute inset-0" role="img" aria-label={`Price chart, now ${price(now)}`}>
            {grid.map((cents) => (
              <line key={cents} x1="0" x2={plotRight} y1={y(cents)} y2={y(cents)} className="stroke-rule" strokeWidth="1" />
            ))}
            {target !== null && (
              <>
                <rect
                  x={openX}
                  width={Math.max(0, plotRight - openX)}
                  y={target.side === 'up' ? padTop : targetY}
                  height={target.side === 'up' ? targetY - padTop : plotBottom - targetY}
                  className={target.side === 'up' ? 'fill-mint/15' : 'fill-coral/15'}
                />
                <line x1={openX} x2={plotRight} y1={targetY} y2={targetY} className={target.side === 'up' ? 'stroke-mint' : 'stroke-coral'} strokeWidth="2" strokeDasharray="7 6" />
                <line x1={openX} x2={plotRight} y1={breakEvenY} y2={breakEvenY} className={target.side === 'up' ? 'stroke-mint/60' : 'stroke-coral/60'} strokeWidth="1.5" strokeDasharray="3 5" />
              </>
            )}
            {revealX !== null && <line x1={revealX} x2={revealX} y1={padTop - 16} y2={plotBottom + 12} className="stroke-sun/70" strokeWidth="2" strokeDasharray="2 4" />}
            <line x1={openX} x2={openX} y1="0" y2={h} className="stroke-dusk" strokeWidth="2" strokeDasharray="2 5" />
            {lead.length > 0 && (
              <polyline points={path(-lead.length, 0)} className="fill-none stroke-haze" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {today.length > 1 && (
              <polyline points={path(0, OPEN_STEPS)} className={cx('fill-none', lineTone)} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {entryPoint !== null && (
              <circle cx={x(entryPoint[0])} cy={y(entryPoint[1])} r="6" className="fill-sun" stroke="var(--color-well)" strokeWidth="2.5" />
            )}
            {exitPoint !== null && (
              <circle cx={x(exitPoint[0])} cy={y(exitPoint[1])} r="6" className="fill-cloud" stroke="var(--color-well)" strokeWidth="2.5" />
            )}
            <circle cx={dotX} cy={dotY} r="7" className={lineTone} stroke="var(--color-well)" strokeWidth="3" />
            {inspected !== null && <><line x1={x(inspected[0])} x2={x(inspected[0])} y1={padTop} y2={plotBottom} className="stroke-cloud/60" strokeDasharray="3 3" /><circle cx={x(inspected[0])} cy={y(inspected[1])} r={4} className="fill-cloud" /></>}
            {compact && levels.map((level) => <path key={level.label} d={`M${String(plotRight)},${String(level.at)} L${String(plotRight + 8)},${String(level.labelY)}`} className="fill-none stroke-dusk" />)}
          </svg>

          {!compact && grid.map((cents) => (
            <span key={cents} className="absolute right-2.5 text-xs text-muted tabular-nums" style={{ top: y(cents) - 8 }}>
              {price(cents)}
            </span>
          ))}

          {target !== null && !compact && (
            <>
              {/* Both labels sit on the half of the day away from the price bubble that rides the newest point. */}
              <span
                className={cx('absolute rounded-[10px] px-2.5 py-1 text-[13px] font-bold text-ink', target.side === 'up' ? 'bg-mint' : 'bg-coral')}
                style={{ ...labelSide, top: target.side === 'up' ? targetY + 6 : targetY - 32 }}
              >
                Target {price(target.targetCents)}
              </span>
              <span
                className={cx('absolute text-[12px] font-semibold', target.side === 'up' ? 'text-mint/80' : 'text-coral/80')}
                style={{ ...labelSide, top: target.side === 'up' ? breakEvenY - 22 : breakEvenY + 6 }}
              >
                Break-even {price(target.breakEvenCents)}
              </span>
            </>
          )}

          <span
            className="absolute w-[88px] rounded-lg bg-cloud px-2 py-1 text-center text-[13px] font-bold whitespace-nowrap text-ink tabular-nums"
            style={{ left: Math.max(8, dotX > plotRight - 102 ? dotX - 102 : dotX + 14), top: Math.max(8, dotY - 34) }}
          >
            {price(now)}
          </span>
          {compact && levels.map((level) => <span key={level.label}
            className={cx('chart-level-label absolute right-2 flex justify-between gap-2 rounded px-1 py-0.5 text-xs whitespace-nowrap', level.tone)}
            style={{ left: plotRight + 10, top: level.labelY - 10 }}>
            <span>{level.label}</span><span className="tabular-nums">{price(level.cents)}</span>
          </span>)}
          {inspected !== null && <output className="pointer-events-none absolute bottom-8 left-2 rounded bg-panel px-2 py-1 text-xs text-cloud tabular-nums" aria-live="polite">
            {inspected[0] < 0 ? 'Yesterday' : `Observed step ${String(inspected[0])}`} / {price(inspected[1])}
          </output>}

          {entryPoint !== null && (
            <span className="absolute text-[11px] font-semibold text-sun" style={{ left: Math.min(plotRight - 60, x(entryPoint[0]) - 18), top: y(entryPoint[1]) + 10 }}>
              Bought
            </span>
          )}
          {exitPoint !== null && (
            <span className="absolute text-[11px] font-semibold text-cloud" style={{ left: Math.min(plotRight - 70, x(exitPoint[0]) - 24), top: y(exitPoint[1]) + 10 }}>
              Cashed out
            </span>
          )}

          {twist && !compact && (
            <span className="absolute top-4 left-1/2 w-[184px] -translate-x-1/2">
              <span className="block rounded-xl bg-sun py-2 text-center font-display text-[13px] font-bold text-ink motion-safe:animate-nudge" role="status">
                Plot twist!
              </span>
            </span>
          )}

          <span className="absolute bottom-2.5 left-2.5 hidden text-xs text-muted sm:block">Yesterday</span>
          <span className="absolute bottom-2.5 text-xs text-muted" style={{ left: openX + 8 }}>
            Opening bell
          </span>
          {revealX !== null && !twist && (
            <span className="absolute bottom-2.5 text-xs font-semibold text-sun/80" style={{ left: Math.min(plotRight - 80, revealX + 6) }}>
              Plot twist
            </span>
          )}
          <span className="absolute bottom-2.5 text-xs text-muted" style={{ right: rightMargin }}>Closing bell</span>
        </>
      )}
    </div>
  );
}
