// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LessonConveyor } from '../src/screens/summary/LessonConveyor';

let intersection: IntersectionObserverCallback;
const disconnect = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() { /* Tests explicitly control visibility. */ }
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function visible(isIntersecting: boolean) {
  act(() => { intersection([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver); });
}
function tick(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); }
function selected(index: number) { expect(screen.getByRole('button', { name: new RegExp(`Show lesson ${String(index)}:`) }).getAttribute('aria-pressed')).toBe('true'); }

it('shows the first lesson immediately and rotates only while in view', () => {
  const view = render(createElement(LessonConveyor));
  expect(view.container.querySelector('details')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Reading the news' })).toBeTruthy();
  tick(16000); selected(1);
  visible(true); tick(7999); selected(1); tick(1); selected(2);
  tick(8000); selected(3); tick(8000); selected(1);
  expect(screen.getByRole('status').textContent).toBe('');
});

it('preserves the reading time across hover and offscreen pauses', () => {
  const view = render(createElement(LessonConveyor)); visible(true); tick(3000);
  const band = view.container.querySelector('section')!;
  fireEvent.mouseEnter(band); tick(20000); selected(1);
  fireEvent.mouseLeave(band); tick(2000); selected(1);
  visible(false); tick(20000); selected(1);
  visible(true); tick(2999); selected(1); tick(1); selected(2);
});

it('supports pause, manual wraparound and keyboard focus without autoplay interruptions', () => {
  render(createElement(LessonConveyor)); visible(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pause rotation' })); tick(20000); selected(1);
  fireEvent.click(screen.getByRole('button', { name: 'Previous lesson' })); selected(3);
  fireEvent.click(screen.getByRole('button', { name: 'Next lesson' })); selected(1);
  expect(screen.getByRole('status').textContent).toContain('Lesson 1 of 3. News can be wrong.');
  const next = screen.getByRole('button', { name: 'Next lesson' });
  fireEvent.focus(next);
  fireEvent.click(screen.getByRole('button', { name: 'Resume rotation' })); tick(16000); selected(1);
  fireEvent.blur(next, { relatedTarget: null }); tick(8000); selected(2);
});

it('suspends hidden tabs and clears timers and observers on unmount', () => {
  const view = render(createElement(LessonConveyor)); visible(true); tick(2000);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange')); tick(20000); selected(1);
  hidden.mockReturnValue(false); fireEvent(document, new Event('visibilitychange'));
  tick(6000); selected(2);
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
