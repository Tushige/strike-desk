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
}: {
  frame: Frame;
  companyId: number;
  target: TargetLines | null;
  /** Today's ticket on this company, for the entry and exit marks. */
  ticket: PositionView | null;
  /** Show the "Plot twist!" banner. */
  twist: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const series = useSeries(companyId);

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

  // Yesterday's tail gets a fixed fifth of the width whatever its point
  // count, so the opening bell always stands in the same place.
  const plotWidth = w - 16;
  const bellX = 4 + plotWidth * YESTERDAY_SHARE;
  const x = (k: number): number =>
    k < 0 ? bellX + (k / Math.max(1, lead.length)) * plotWidth * YESTERDAY_SHARE : bellX + (k / OPEN_STEPS) * plotWidth * (1 - YESTERDAY_SHARE);
  const y = (cents: number): number => PAD_TOP + ((hi - cents) / (hi - lo)) * (h - PAD_TOP - PAD_BOTTOM);
  const path = (from: number, to: number): string =>
    points
      .filter(([k]) => k >= from && k <= to)
      .map(([k, cents]) => `${x(k).toFixed(1)},${y(cents).toFixed(1)}`)
      .join(' ');

  const grid = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const openX = x(0);
  const dotX = x(today.length > 0 ? today.length - 1 : 0);
  const dotY = y(now);
  const clampY = (cents: number): number => Math.max(0, Math.min(h, y(cents)));
  const targetY = target === null ? 0 : clampY(target.targetCents);
  const breakEvenY = target === null ? 0 : clampY(target.breakEvenCents);
  const lineTone = picking ? 'stroke-cloud fill-cloud' : up ? 'stroke-mint fill-mint' : 'stroke-coral fill-coral';
  const entry = ticket !== null && ticket.companyId === companyId ? ticket : null;
  const entryPoint = entry === null ? null : points.find(([k]) => k === entry.entryPriceIndex) ?? null;
  const exitPoint = entry?.exit === undefined || entry.exit.kind !== 'cashOut' ? null : points.find(([k]) => k === entry.exit?.priceIndex) ?? null;
  const reveal = frame.news.find((item) => item.companyId === companyId && item.day === frame.clock.day && item.revealed);
  const revealX = reveal?.revealIndex === undefined ? null : x(reveal.revealIndex);

  return (
    <div ref={box} className="relative h-[380px] overflow-hidden rounded-[18px] bg-well lg:h-auto lg:min-h-0 lg:flex-1">
      {w > 0 && h > 0 && (
        <>
          <svg width={w} height={h} className="absolute inset-0" role="img" aria-label={`Price chart, now ${price(now)}`}>
            {grid.map((cents) => (
              <line key={cents} x1="0" x2={w} y1={y(cents)} y2={y(cents)} className="stroke-rule" strokeWidth="1" />
            ))}
            {target !== null && (
              <>
                <rect
                  x={openX}
                  width={Math.max(0, w - openX)}
                  y={target.side === 'up' ? 0 : targetY}
                  height={target.side === 'up' ? targetY : h - targetY}
                  className={target.side === 'up' ? 'fill-mint/15' : 'fill-coral/15'}
                />
                <line x1={openX} x2={w} y1={targetY} y2={targetY} className={target.side === 'up' ? 'stroke-mint' : 'stroke-coral'} strokeWidth="2" strokeDasharray="7 6" />
                <line x1={openX} x2={w} y1={breakEvenY} y2={breakEvenY} className={target.side === 'up' ? 'stroke-mint/60' : 'stroke-coral/60'} strokeWidth="1.5" strokeDasharray="3 5" />
              </>
            )}
            {revealX !== null && <line x1={revealX} x2={revealX} y1={PAD_TOP - 20} y2={h - PAD_BOTTOM + 12} className="stroke-sun/70" strokeWidth="2" strokeDasharray="2 4" />}
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
          </svg>

          {grid.map((cents) => (
            <span key={cents} className="absolute left-2.5 text-xs text-muted tabular-nums" style={{ top: y(cents) - 18 }}>
              {price(cents)}
            </span>
          ))}

          {target !== null && (
            <>
              <span
                className={cx('absolute right-3 rounded-[10px] px-2.5 py-1 text-[13px] font-bold text-ink', target.side === 'up' ? 'bg-mint' : 'bg-coral')}
                style={{ top: target.side === 'up' ? targetY - 32 : targetY + 8 }}
              >
                Target {price(target.targetCents)}
              </span>
              <span
                className={cx('absolute right-3 text-[12px] font-semibold', target.side === 'up' ? 'text-mint/80' : 'text-coral/80')}
                style={{ top: target.side === 'up' ? breakEvenY - 24 : breakEvenY + 8 }}
              >
                Break-even {price(target.breakEvenCents)}
              </span>
            </>
          )}

          <span
            className="absolute rounded-lg bg-cloud px-2 py-1 text-[13px] font-bold text-ink tabular-nums"
            style={{ left: dotX > w - 100 ? dotX - 82 : dotX + 14, top: dotY - 34 }}
          >
            {price(now)}
          </span>

          {entryPoint !== null && (
            <span className="absolute text-[11px] font-semibold text-sun" style={{ left: Math.min(w - 60, x(entryPoint[0]) - 18), top: y(entryPoint[1]) + 10 }}>
              Bought
            </span>
          )}
          {exitPoint !== null && (
            <span className="absolute text-[11px] font-semibold text-cloud" style={{ left: Math.min(w - 70, x(exitPoint[0]) - 24), top: y(exitPoint[1]) + 10 }}>
              Cashed out
            </span>
          )}

          {twist && (
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
            <span className="absolute bottom-2.5 text-xs font-semibold text-sun/80" style={{ left: Math.min(w - 80, revealX + 6) }}>
              Plot twist
            </span>
          )}
          <span className="absolute right-2.5 bottom-2.5 text-xs text-muted">Closing bell</span>
        </>
      )}
    </div>
  );
}
