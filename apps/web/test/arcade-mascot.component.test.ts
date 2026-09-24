// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArcadeMascot } from '../src/screens/landing/ArcadeMascot';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('waits for artwork, pauses while hidden or offscreen, resumes when visible, and cleans up', () => {
  let visibility: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof visibility) {
        visibility = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const remove = vi.spyOn(document, 'removeEventListener');
  const view = render(createElement(ArcadeMascot));
  const root = view.container.querySelector('.arcade-mascot')!;
  expect(root.getAttribute('data-running')).toBe('false');
  fireEvent.load(screen.getByRole('img'));
  expect(root.getAttribute('data-running')).toBe('true');
  act(() => {
    visibility?.([{ isIntersecting: false }]);
  });
  expect(root.getAttribute('data-running')).toBe('false');
  act(() => {
    visibility?.([{ isIntersecting: true }]);
  });
  expect(root.getAttribute('data-running')).toBe('true');
  hidden.mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(root.getAttribute('data-running')).toBe('false');
  hidden.mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
  expect(root.getAttribute('data-running')).toBe('true');
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
});
