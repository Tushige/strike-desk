// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveMoney, digitDestination } from '../src/screens/motion/LiveMoney';
import { ResultCount } from '../src/screens/motion/ResultCount';

const motion = vi.hoisted(() => {
  type Call = {
    model: Record<string, number>;
    vars: Record<string, unknown>;
    kill: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
  };
  const calls: Call[] = [];
  return {
    calls,
    to: (model: Call['model'], vars: Call['vars']) => {
      const call = { model, vars, kill: vi.fn(), play: vi.fn() };
      calls.push(call);
      return call;
    },
  };
});
vi.mock('gsap', () => ({ gsap: { to: motion.to } }));
beforeEach(() => {
  motion.calls.length = 0;
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('starts at the authoritative value and rolls only a changed digit', () => {
  const view = render(createElement(LiveMoney, { cents: 1_234_500 }));
  expect(screen.getByRole('img', { name: '$12,345' })).toBeTruthy();
  expect(motion.calls).toHaveLength(0);
  view.rerender(createElement(LiveMoney, { cents: 1_234_600 }));
  expect(motion.calls).toHaveLength(1);
  expect(motion.calls[0]!.vars).toMatchObject({ position: 16, duration: 0.28, ease: 'power2.out' });
  view.rerender(createElement(LiveMoney, { cents: 1_234_601 }));
  expect(motion.calls).toHaveLength(1);
  expect(motion.calls[0]!.kill).not.toHaveBeenCalled();
});

it('interrupts an active roll at its displayed position instead of queuing or jumping to the old target', () => {
  const view = render(createElement(LiveMoney, { cents: 100 }));
  view.rerender(createElement(LiveMoney, { cents: 900 }));
  const first = motion.calls[0]!;
  first.model.position = 14.25;
  act(() => {
    (first.vars.onUpdate as () => void)();
  });
  const before = view.container.querySelector<HTMLElement>('.live-money-strip')!.style.transform;
  view.rerender(createElement(LiveMoney, { cents: 800 }));
  expect(first.kill).toHaveBeenCalledOnce();
  expect(motion.calls).toHaveLength(2);
  expect(motion.calls[1]!.model.position).toBe(14.25);
  expect(view.container.querySelector<HTMLElement>('.live-money-strip')!.style.transform).toBe(
    before,
  );
  expect(motion.calls[1]!.vars.position).toBe(8);
  expect(screen.getByRole('img', { name: '$8' })).toBeTruthy();
});

it('keeps decimal places attached to their reels through carries and borrows', () => {
  const view = render(createElement(LiveMoney, { cents: 99_900 }));
  const units = [...view.container.querySelectorAll('.live-money-strip')].at(-1);
  view.rerender(createElement(LiveMoney, { cents: 100_000 }));
  expect([...view.container.querySelectorAll('.live-money-strip')].at(-1)).toBe(units);
  expect(motion.calls).toHaveLength(3);
  expect(motion.calls.every((call) => call.vars.position === 20)).toBe(true);
  expect(screen.getByRole('img', { name: '$1,000' })).toBeTruthy();
  view.rerender(createElement(LiveMoney, { cents: 99_900 }));
  expect([...view.container.querySelectorAll('.live-money-strip')].at(-1)).toBe(units);
  expect(screen.getByRole('img', { name: '$999' })).toBeTruthy();
  expect(digitDestination(19.7, 9, -1)).toEqual({ start: 19.7, end: 19 });
  expect(digitDestination(20, 1, 1)).toEqual({ start: 10, end: 11 });
});

it('uses a slower cash roll and settles immediately when the connection is not live', () => {
  const view = render(createElement(LiveMoney, { cents: 100, pace: 'cash' }));
  view.rerender(createElement(LiveMoney, { cents: 200, pace: 'cash' }));
  expect(motion.calls[0]!.vars.duration).toBe(0.55);
  view.rerender(createElement(LiveMoney, { cents: 200, pace: 'cash', animate: false }));
  expect(motion.calls[0]!.kill).toHaveBeenCalledOnce();
  expect(motion.calls[0]!.model.position).toBe(12);
  view.unmount();
  expect(motion.calls[0]!.kill).toHaveBeenCalledTimes(2);
});

it('finishes an interrupted roll when the tab becomes hidden', () => {
  const view = render(createElement(LiveMoney, { cents: 100 }));
  view.rerender(createElement(LiveMoney, { cents: 200 }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(motion.calls[0]!.kill).toHaveBeenCalledOnce();
  expect(motion.calls[0]!.model.position).toBe(12);
});

it('counts a signed day result once on visibility, without replaying on unrelated renders', () => {
  let show: () => void = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        show = () => {
          callback([{ isIntersecting: true }]);
        };
      }
      observe() {}
      disconnect() {}
    },
  );
  const view = render(createElement(ResultCount, { cents: -25_000 }));
  expect(screen.getByRole('img', { name: '−$250' })).toBeTruthy();
  expect(view.container.querySelector('.result-count-value')!.textContent).toBe('−$0');
  expect(motion.calls[0]!.play).not.toHaveBeenCalled();
  act(() => {
    show();
  });
  expect(motion.calls[0]!.play).toHaveBeenCalledOnce();
  motion.calls[0]!.model.cents = -25_000;
  act(() => {
    (motion.calls[0]!.vars.onUpdate as () => void)();
  });
  expect(view.container.querySelector('.result-count-value')!.textContent).toBe('−$250');
  view.rerender(createElement(ResultCount, { cents: -25_000 }));
  expect(motion.calls).toHaveLength(1);
  view.unmount();
  expect(motion.calls[0]!.kill).toHaveBeenCalledOnce();
});
