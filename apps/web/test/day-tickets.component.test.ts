// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { DayTickets } from '../src/screens/DayTickets';
import { testFrame } from './fakeSocket';

const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
afterAll(() => {
  if (original) Object.defineProperty(Element.prototype, 'animate', original);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});
const dayResult = (day: number, changeCents: number) => ({ day, changeCents, startCents: 100_000, endCents: 100_000 + changeCents });
const frame = testFrame({ clock: { phase: 'open', day: 4, stepsLeft: 20, priceIndex: 50, pace: 1 },
  days: [dayResult(1, -100), dayResult(2, 0), dayResult(3, 200)] });

it('shows settled outcomes, today and future days with accessible descriptions', () => {
  render(createElement(DayTickets, { frame }));
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
  expect(screen.getByRole('listitem', { name: /Day 1, loss/ }).getAttribute('data-outcome')).toBe('loss');
  expect(screen.getByRole('listitem', { name: 'Day 2, no change' }).getAttribute('data-outcome')).toBe('flat');
  expect(screen.getByRole('listitem', { name: /Day 3, profit/ }).getAttribute('data-outcome')).toBe('profit');
  expect(screen.getByRole('listitem', { name: 'Day 4, today' }).getAttribute('aria-current')).toBe('step');
  expect(screen.getByRole('listitem', { name: 'Day 5, upcoming' }).getAttribute('aria-current')).toBeNull();
  expect(animate).not.toHaveBeenCalled();
});

it('stamps only a newly settled day, never quote updates, and clears today at the closing bell', () => {
  const view = render(createElement(DayTickets, { frame }));
  const settled = { ...frame, clock: { ...frame.clock, phase: 'debrief' as const }, days: [...frame.days, dayResult(4, 0)] };
  view.rerender(createElement(DayTickets, { frame: settled }));
  expect(animate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('listitem', { name: 'Day 4, no change' }).getAttribute('aria-current')).toBeNull();
  view.rerender(createElement(DayTickets, { frame: { ...settled, step: 99 } }));
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(createElement(DayTickets, { frame: { ...settled, session: 'restored-session' } }));
  expect(animate).toHaveBeenCalledTimes(1);
});

it('does not stamp historical results after connecting or animate while hidden', () => {
  const view = render(createElement(DayTickets, { frame: null }));
  view.rerender(createElement(DayTickets, { frame }));
  expect(animate).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  view.rerender(createElement(DayTickets, { frame: { ...frame, days: [...frame.days, dayResult(4, 100)] } }));
  expect(animate).not.toHaveBeenCalled();
});

it('shows five completed tickets and no active day in the final screen', () => {
  render(createElement(DayTickets, { frame: { ...frame, clock: { ...frame.clock, phase: 'final', day: 5 },
    days: [...frame.days, dayResult(4, 0), dayResult(5, -200)] } }));
  expect(screen.getAllByRole('listitem').every(item => item.getAttribute('data-state') === 'done')).toBe(true);
  expect(screen.getAllByRole('listitem').every(item => !item.hasAttribute('aria-current'))).toBe(true);
});
