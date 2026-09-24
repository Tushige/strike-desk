import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';

export interface ChartPoint {
  x: number;
  y: number;
}

/** Interpolate only along received segments; never invent a future price. */
export function pointAt(points: readonly ChartPoint[], cursor: number): ChartPoint {
  const at = Math.max(0, Math.min(points.length - 1, cursor));
  const a = points[Math.floor(at)] ?? { x: 0, y: 0 };
  const b = points[Math.ceil(at)] ?? a;
  const fraction = at - Math.floor(at);
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

interface Snapshot {
  identity: string;
  geometry: string;
  points: readonly ChartPoint[];
  reveal: number | null;
  live: boolean;
}

export function usePriceChartMotion(
  root: RefObject<HTMLDivElement | null>,
  snapshot: Snapshot,
  referenceKey: string | null,
  ready: boolean,
) {
  const previous = useRef<Snapshot | null>(null);
  const cursor = useRef({ at: 0 });
  const tween = useRef<gsap.core.Tween | null>(null);
  const eventTween = useRef<gsap.core.Tween | null>(null);
  const pendingEvent = useRef<number | null>(null);
  const paint = useRef<(() => void) | null>(null);
  const entering = useRef(false);

  useLayoutEffect(() => {
    if (!ready || root.current === null || snapshot.points.length === 0) return;
    const el = root.current;
    const clip = el.querySelector<SVGRectElement>('[data-price-clip]');
    const dot = el.querySelector<SVGCircleElement>('[data-price-dot]');
    const bubble = el.querySelector<HTMLElement>('[data-price-bubble]');
    const last = snapshot.points.length - 1;
    const old = previous.current;
    const fresh = old === null || old.identity !== snapshot.identity;
    const geometryChanged = old?.geometry !== snapshot.geometry;
    const appended = !fresh && snapshot.points.length > old.points.length;
    const prefixMatches =
      !fresh &&
      old.points.every((point, i) => {
        const next = snapshot.points[i];
        return next?.x === point.x && next.y === point.y;
      });

    if (fresh) {
      pendingEvent.current = null;
      eventTween.current?.progress(1).kill();
    } else if (snapshot.reveal !== null && snapshot.reveal !== old.reveal)
      pendingEvent.current = snapshot.reveal;

    paint.current = () => {
      const point = pointAt(snapshot.points, cursor.current.at);
      const end = snapshot.points[last]!;
      // The full received polyline stays intact. Only its right-hand clipping
      // edge and endpoint move, so already drawn history never morphs.
      clip?.setAttribute('width', String(point.x + (cursor.current.at >= last ? 8 : 0)));
      dot?.setAttribute('cx', String(point.x));
      dot?.setAttribute('cy', String(point.y));
      if (bubble) {
        bubble.style.visibility = entering.current ? 'hidden' : '';
        bubble.style.transform = `translate(${point.x - end.x}px, ${point.y - end.y}px)`;
      }
      if (pendingEvent.current !== null && cursor.current.at >= pendingEvent.current) {
        pendingEvent.current = null;
        const marker = el.querySelector('[data-price-event]');
        eventTween.current?.kill();
        if (marker && !document.hidden) {
          eventTween.current = gsap.fromTo(
            marker,
            { opacity: 1, attr: { 'stroke-width': 4 } },
            {
              opacity: 1,
              attr: { 'stroke-width': 2 },
              duration: 0.65,
              ease: 'power2.out',
            },
          );
        }
      }
    };

    const changed = fresh || geometryChanged || appended || !prefixMatches;
    if (changed || (old?.live === true && !snapshot.live) || document.hidden) {
      tween.current?.kill();
      const entrance = fresh && !document.hidden;
      const extend =
        appended && prefixMatches && !geometryChanged && snapshot.live && !document.hidden;
      if (entrance || extend) {
        if (entrance) {
          cursor.current.at = 0;
          entering.current = true;
        }
        paint.current();
        tween.current = gsap.to(cursor.current, {
          at: last,
          duration: entrance ? 0.5 : 0.16,
          ease: entrance ? 'power2.out' : 'none',
          onUpdate: () => paint.current?.(),
          onComplete: () => {
            entering.current = false;
            paint.current?.();
          },
        });
      } else {
        entering.current = false;
        cursor.current.at = last;
        paint.current();
      }
    } else {
      // React may have updated cx/cy; restore the current animation position
      // before paint without restarting it on pointer inspection or quotes.
      paint.current();
    }
    previous.current = snapshot;
  });

  useLayoutEffect(() => {
    if (!ready || referenceKey === null || root.current === null || document.hidden) return;
    const nodes = root.current.querySelectorAll('[data-price-reference]');
    const entrance = gsap.fromTo(
      nodes,
      { opacity: 0 },
      { opacity: 1, duration: 0.28, ease: 'power2.out' },
    );
    return () => {
      entrance.progress(1).kill();
    };
  }, [root, ready, referenceKey]);

  useLayoutEffect(() => {
    const settle = () => {
      if (!document.hidden) return;
      tween.current?.kill();
      eventTween.current?.progress(1).kill();
      pendingEvent.current = null;
      entering.current = false;
      cursor.current.at = Math.max(0, (previous.current?.points.length ?? 1) - 1);
      paint.current?.();
    };
    document.addEventListener('visibilitychange', settle);
    return () => {
      document.removeEventListener('visibilitychange', settle);
      tween.current?.kill();
      eventTween.current?.kill();
      previous.current = null;
    };
  }, []);
}
