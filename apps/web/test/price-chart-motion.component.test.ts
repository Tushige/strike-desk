// @vitest-environment jsdom
import { createElement, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { pointAt, usePriceChartMotion } from '../src/screens/desk/usePriceChartMotion';

const points = [
  { x: 10, y: 20 },
  { x: 20, y: 40 },
  { x: 30, y: 10 },
];
const initial = {
  identity: 'session:1:0',
  geometry: '400:200',
  points,
  reveal: null as number | null,
  live: true,
};
function Harness({
  snapshot = initial,
  reference = 'up:100',
}: {
  snapshot?: typeof initial;
  reference?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  usePriceChartMotion(root, snapshot, reference, true);
  return createElement(
    'div',
    { ref: root },
    createElement(
      'svg',
      null,
      createElement('rect', { 'data-price-clip': '', width: 400 }),
      createElement('circle', {
        'data-price-dot': '',
        cx: snapshot.points.at(-1)!.x,
        cy: snapshot.points.at(-1)!.y,
      }),
      createElement('line', { 'data-price-event': '', strokeWidth: 2 }),
      createElement('g', { 'data-price-reference': '' }),
    ),
    createElement('span', { 'data-price-bubble': '' }, '$123.45'),
  );
}
const motion = () =>
  gsap.globalTimeline.getChildren().find((tween) => typeof tween.vars.at === 'number')!;
const coords = (container: HTMLElement) => {
  const dot = container.querySelector('[data-price-dot]')!;
  return [Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))];
};
beforeEach(() => {
  gsap.globalTimeline.pause();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  gsap.globalTimeline.clear().resume();
  vi.restoreAllMocks();
});

it('interpolates received segments and clamps at their endpoints', () => {
  expect(pointAt(points, 1.5)).toEqual({ x: 25, y: 25 });
  expect(pointAt(points, -1)).toEqual(points[0]);
  expect(pointAt(points, 50)).toEqual(points[2]);
});

it('enters once, then extends from the displayed point without replaying on unrelated renders', () => {
  const { container, rerender } = render(createElement(Harness));
  const entrance = motion();
  expect(entrance.duration()).toBe(0.5);
  act(() => {
    entrance.progress(0.4);
  });
  const during = coords(container);
  rerender(createElement(Harness, { snapshot: { ...initial } }));
  expect(motion()).toBe(entrance);
  expect(coords(container)).toEqual(during);
  act(() => {
    entrance.progress(1);
  });
  expect(coords(container)).toEqual([30, 10]);

  const next = { ...initial, points: [...points, { x: 40, y: 30 }] };
  rerender(createElement(Harness, { snapshot: next }));
  const tick = motion();
  expect(tick.duration()).toBe(0.16);
  act(() => {
    tick.progress(0.5);
  });
  expect(coords(container)).toEqual([35, 20]);
  expect(container.querySelector('[data-price-clip]')?.getAttribute('width')).toBe('35');
  expect(container.textContent).toBe('$123.45');

  // A faster next tick continues along every received segment, from the
  // current visual point; it neither snaps backward nor skips the corner.
  rerender(
    createElement(Harness, { snapshot: { ...next, points: [...next.points, { x: 50, y: 20 }] } }),
  );
  expect(coords(container)).toEqual([35, 20]);
  act(() => {
    motion().progress(1 / 3);
  });
  expect(coords(container)).toEqual([40, 30]);
  act(() => {
    motion().progress(1);
  });
  expect(coords(container)).toEqual([50, 20]);
  expect(container.querySelector('[data-price-clip]')?.getAttribute('width')).toBe('58');
});

it('settles on scale changes and starts fresh for another company or day', () => {
  const { container, rerender } = render(createElement(Harness));
  act(() => {
    motion().progress(1);
  });
  const resized = {
    ...initial,
    geometry: '800:200',
    points: points.map((p) => ({ ...p, x: p.x * 2 })),
  };
  rerender(createElement(Harness, { snapshot: resized }));
  expect(motion()).toBeUndefined();
  expect(coords(container)).toEqual([60, 10]);
  rerender(createElement(Harness, { snapshot: { ...resized, identity: 'session:2:1' } }));
  expect(motion().duration()).toBe(0.5);
  expect(coords(container)).toEqual([20, 20]);
});

it('emphasizes new events when the trace arrives, without replaying historical events', () => {
  const { container, rerender } = render(createElement(Harness));
  act(() => {
    motion().progress(1);
  });
  const animate = vi.spyOn(gsap, 'fromTo');
  const next = { ...initial, reveal: 3, points: [...points, { x: 40, y: 30 }] };
  rerender(createElement(Harness, { snapshot: next }));
  act(() => {
    motion().progress(0.5);
  });
  expect(animate).not.toHaveBeenCalled();
  act(() => {
    motion().progress(1);
  });
  expect(animate).toHaveBeenCalledTimes(1);
  const pulse = animate.mock.results[0]!.value as gsap.core.Tween;
  act(() => {
    pulse.progress(1);
  });
  expect(container.querySelector('[data-price-event]')?.getAttribute('stroke-width')).toBe('2');
  rerender(createElement(Harness, { snapshot: { ...next } }));
  rerender(createElement(Harness, { snapshot: { ...next, identity: 'another-company' } }));
  act(() => {
    motion().progress(1);
  });
  expect(animate).toHaveBeenCalledTimes(1);
});

it('animates reference selection once and settles motion when the tab is hidden', () => {
  const animate = vi.spyOn(gsap, 'fromTo');
  const { container, rerender, unmount } = render(createElement(Harness));
  expect(animate).toHaveBeenCalledTimes(1);
  rerender(createElement(Harness, { snapshot: { ...initial } }));
  expect(animate).toHaveBeenCalledTimes(1);
  rerender(createElement(Harness, { reference: 'down:110' }));
  expect(animate).toHaveBeenCalledTimes(2);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(coords(container)).toEqual([30, 10]);
  expect(container.querySelector<HTMLElement>('[data-price-bubble]')?.style.visibility).toBe('');
  expect(motion()).toBeUndefined();
  unmount();
  expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
});
