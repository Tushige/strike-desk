// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LessonConveyor } from '../src/screens/summary/LessonConveyor';

let visibility: (visible: boolean) => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      visibility = visible => { callback([{ isIntersecting: visible }]); };
    }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function advance(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); }
function current(index: number) {
  expect(screen.getByRole('button', { name: new RegExp(`^Show lesson ${String(index)}:`) }).getAttribute('aria-pressed')).toBe('true');
}
function open() {
  const view = render(createElement(LessonConveyor));
  act(() => { visibility(true); });
  return view.container.querySelector('section')!;
}

it('resumes the remaining reading time while the pointer and focus stay on Resume', () => {
  const carousel = open();
  advance(3000);
  fireEvent.mouseEnter(carousel);
  const toggle = screen.getByRole('button', { name: 'Pause rotation' });
  act(() => { toggle.focus(); });
  fireEvent.click(toggle);
  advance(16000);
  current(1);
  fireEvent.click(screen.getByRole('button', { name: 'Resume rotation' }));
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByText('Auto · 8s')).toBeTruthy();
  advance(4999);
  current(1);
  advance(1);
  current(2);
  advance(8000);
  current(3);
});

it('supports keyboard-only resume and pauses again on a fresh reading interaction', () => {
  const carousel = open();
  const toggle = screen.getByRole('button', { name: 'Pause rotation' });
  act(() => { toggle.focus(); });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Resume rotation' }));
  advance(8000);
  current(2);
  fireEvent.mouseEnter(carousel);
  advance(16000);
  current(2);
  fireEvent.mouseLeave(carousel);
  advance(8000);
  current(3);
  act(() => { screen.getByRole('button', { name: 'Next lesson' }).focus(); });
  advance(16000);
  current(3);
});

it('still suspends a resumed carousel offscreen and while its tab is hidden', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Pause rotation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Resume rotation' }));
  act(() => { visibility(false); });
  advance(16000);
  current(1);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  act(() => { visibility(true); });
  advance(16000);
  current(1);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
  advance(8000);
  current(2);
});
