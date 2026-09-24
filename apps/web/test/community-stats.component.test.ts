// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommunityStats } from '../src/screens/landing/CommunityStats';
import { usePublicStats } from '../src/screens/landing/usePublicStats';
import { Odometer } from '../src/screens/motion/Odometer';

const data = { completedGames: '12', pretendProfitsEarnedCents: '140000000', bestNetProfitCents: '140000000' };
const motion = vi.hoisted(() => ({ fromTo: vi.fn(), play: vi.fn(), kill: vi.fn(), set: vi.fn(), revert: vi.fn() }));
vi.mock('gsap', () => ({ gsap: {
  timeline: () => ({ fromTo: motion.fromTo, play: motion.play, kill: motion.kill }),
  set: motion.set,
  context: (work: () => void) => { work(); return { revert: motion.revert }; },
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('rolls only digits on first visibility, without replaying or rounding fresh totals', () => {
  Object.values(motion).forEach(spy => spy.mockClear());
  const callbacks: (() => void)[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { callbacks.push(() => { callback([{ isIntersecting: true }]); }); }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 20 } as DOMRect);
  const view = render(createElement(CommunityStats, { variant: 'ticket', state: { status: 'ready', data }, onRetry: () => {} }));
  expect(motion.fromTo.mock.calls.length).toBeGreaterThan(2);
  for (const [node, from, to] of motion.fromTo.mock.calls) {
    expect((node as HTMLElement).className).toBe('odometer-strip');
    expect(from).toEqual({ y: 0, yPercent: 0 });
    expect(to).toEqual({ y: -Number((node as HTMLElement).dataset.digit) * 20, yPercent: 0, duration: 1.5, ease: 'power2.out' });
  }
  expect(motion.play).not.toHaveBeenCalled();
  act(() => { callbacks.forEach(show => { show(); }); });
  expect(motion.play).toHaveBeenCalledTimes(3);
  const entrances = motion.fromTo.mock.calls.length;
  view.rerender(createElement(CommunityStats, { variant: 'ticket', state: { status: 'ready', data: { ...data, completedGames: '13' } }, onRetry: () => {} }));
  expect(motion.fromTo).toHaveBeenCalledTimes(entrances);
  expect(view.container.querySelector('.community-games [role="img"]')?.getAttribute('aria-label')).toBe('13');
  expect(motion.set).toHaveBeenCalled();
  view.unmount();
  expect(motion.kill).toHaveBeenCalledTimes(4);
});

it('keeps digit 5 inside its window and leaves no empty slot before a compact suffix', () => {
  Object.values(motion).forEach(spy => spy.mockClear());
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 20 } as DOMRect);
  const view = render(createElement(Odometer, { value: '+$2.25M' }));
  const five = motion.fromTo.mock.calls.find(([node]) => (node as HTMLElement).dataset.digit === '5');
  expect(five).toBeDefined();
  expect(five![1]).toEqual({ y: 0, yPercent: 0 });
  expect(five![2]).toMatchObject({ y: -100, yPercent: 0 });
  view.rerender(createElement(Odometer, { value: '+$1.19M' }));
  view.rerender(createElement(Odometer, { value: '+$2.2M' }));
  expect(view.container.querySelectorAll('.odometer-window')).toHaveLength(2);
  const suffix = view.container.querySelector('.odometer-drum')!.lastElementChild!;
  expect(suffix.textContent).toBe('M');
  expect(suffix.previousElementSibling?.querySelector('[data-digit]')?.getAttribute('data-digit')).toBe('2');
  expect(motion.set.mock.calls.every(([, vars]) => (vars as { yPercent: number }).yPercent === 0)).toBe(true);
});

it('shows an honest error then retries using real API values, without substituting sample figures', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: () => ({ ...data, currency: 'pretend-USD' }) });
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(usePublicStats);
  await waitFor(() => { expect(result.current.state.status).toBe('error'); });
  act(() => { result.current.retry(); });
  await waitFor(() => { expect(result.current.state).toEqual({ status: 'ready', data }); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('bounds a stalled request and aborts when the landing unmounts', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => {
    signals.push(options.signal);
    return new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { reject(new Error('aborted')); }); });
  }));
  const { result, unmount } = renderHook(usePublicStats);
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(result.current.state.status).toBe('error');
  expect(signals[0]?.aborted).toBe(true);
  act(() => { result.current.retry(); });
  unmount();
  expect(signals[1]?.aborted).toBe(true);
});
