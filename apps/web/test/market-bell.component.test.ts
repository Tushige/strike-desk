// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MarketBell } from '../src/screens/desk/MarketBell';

const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
afterAll(() => {
  if (original) Object.defineProperty(Element.prototype, 'animate', original);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('rings once for the server opening transition, not subsequent open frames', () => {
  const view = render(createElement(MarketBell, { phase: 'preBell' }));
  expect(animate).not.toHaveBeenCalled();
  view.rerender(createElement(MarketBell, { phase: 'open' }));
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(createElement(MarketBell, { phase: 'open' }));
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(createElement(MarketBell, { phase: 'debrief' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('does not ring when restoring an already-open market', () => {
  render(createElement(MarketBell, { phase: 'open' }));
  expect(animate).not.toHaveBeenCalled();
});

it('does not stage an opening animation in a hidden document', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const view = render(createElement(MarketBell, { phase: 'preBell' }));
  view.rerender(createElement(MarketBell, { phase: 'open' }));
  expect(animate).not.toHaveBeenCalled();
});
