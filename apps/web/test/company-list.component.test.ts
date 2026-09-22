// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanyList } from '../src/screens/desk/CompanyList';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('fades only edges with hidden content and updates when the list fits after resizing', () => {
  let resized = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe(): void {}
    disconnect(): void {}
  });
  render(createElement(CompanyList, { children: createElement('button', null, 'RoboPup') }));
  const viewport = screen.getByRole('region', { name: 'Company cards' });
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 600 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  act(resized);
  expect(viewport.dataset.fadeTop).toBe('false');
  expect(viewport.dataset.fadeBottom).toBe('true');
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  expect(viewport.dataset.fadeTop).toBe('true');
  expect(viewport.dataset.fadeBottom).toBe('true');
  viewport.scrollTop = 400;
  fireEvent.scroll(viewport);
  expect(viewport.dataset.fadeTop).toBe('true');
  expect(viewport.dataset.fadeBottom).toBe('false');
  viewport.scrollTop = 0;
  Object.defineProperty(viewport, 'scrollHeight', { value: 200 });
  act(resized);
  expect(viewport.dataset.fadeTop).toBe('false');
  expect(viewport.dataset.fadeBottom).toBe('false');
});
