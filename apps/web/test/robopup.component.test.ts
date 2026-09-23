// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { RoboPup } from '../src/screens/mascot/RoboPup';

const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
afterAll(() => {
  if (original) Object.defineProperty(Element.prototype, 'animate', original);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('waits for both the artwork and confirmed state, then does not repeat for identical updates', () => {
  const view = render(createElement(RoboPup, { pose: 'stamp', active: false }));
  fireEvent.load(view.container.querySelector('img')!);
  expect(animate).not.toHaveBeenCalled();
  expect(view.container.querySelector('.robopup-filed')).toBeNull();
  view.rerender(createElement(RoboPup, { pose: 'stamp', active: true }));
  expect(animate).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('.robopup-filed')).not.toBeNull();
  view.rerender(createElement(RoboPup, { pose: 'stamp', active: true }));
  expect(animate).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('waits for loaded art before ringing and cleans up the finite reactions', () => {
  const view = render(createElement(RoboPup, { pose: 'bell' }));
  expect(animate).not.toHaveBeenCalled();
  fireEvent.load(view.container.querySelector('img')!);
  expect(animate).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(cancel).toHaveBeenCalledTimes(3);
});

it('keeps hidden-page reactions still and decorative content outside accessible text', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const view = render(createElement(RoboPup, { pose: 'receipt' }));
  fireEvent.load(view.container.querySelector('img')!);
  expect(animate).not.toHaveBeenCalled();
  expect(view.container.querySelector('.robopup')?.getAttribute('aria-hidden')).toBe('true');
});
