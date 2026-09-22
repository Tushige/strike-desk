// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StressReadout } from '../src/board/StressReadout';
import { createStressMeasurements } from '../src/board/stressMeasurements';
import { testFrame } from './fakeSocket';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const meter = createStressMeasurements({ now: () => performance.now(), schedule: (run, ms) => {
    const timer = setTimeout(run, ms); return () => { clearTimeout(timer); };
  } });
  meter.setSupport({ delay: true, frames: true, longTasks: false });
  meter.setActive(true);
  meter.observe(testFrame({ stress: true }), { accepted: true, kind: 'frame', session: 's', day: 1, phase: 'open', stress: true, boardReplaced: false, quoteChanges: [] }, 0);
  return { meter, view: render(createElement(StressReadout, { measurements: meter })) };
}

it('explains each measurement on focus and hover with a dismissible linked description', () => {
  const { view, meter } = setup();
  const button = view.queryByRole('button', { name: 'Client delay (ms)' });
  expect(button).not.toBeNull();
  fireEvent.focus(button!);
  const description = view.getByRole('tooltip');
  expect(button!.getAttribute('aria-describedby')).toBe(description.id);
  expect(description.textContent).toMatch(/excludes network latency/i);
  expect(description.textContent).toMatch(/nearest.rank/i);
  expect(description.textContent).toContain('95%');
  fireEvent.keyDown(button!, { key: 'Escape' });
  expect(view.queryByRole('tooltip')).toBeNull();
  fireEvent.blur(button!);
  const records = view.getByRole('button', { name: 'Records/s' });
  fireEvent.mouseEnter(records);
  expect(view.getByRole('tooltip').textContent).toMatch(/received.*records/i);
  fireEvent.mouseLeave(records);
  expect(view.queryByRole('tooltip')).toBeNull();
  act(() => { meter.setActive(false); });
});

it('distinguishes warm-up, unsupported, measured zero and pause without live announcements', () => {
  const { view, meter } = setup();
  expect(view.getByText('Long tasks >50 ms').parentElement?.textContent).toContain('Unsupported');
  expect(view.getByText('Records/s').parentElement?.textContent).toContain('Collecting…');
  act(() => { vi.advanceTimersByTime(1000); });
  expect(view.getByText('Records/s').parentElement?.textContent).toContain('0.0');
  expect(view.getByText('Client delay (ms)').parentElement?.textContent).toContain('Collecting…');
  expect(view.container.querySelector('[aria-live], [role="status"]')).toBeNull();
  act(() => { meter.setSupport({ delay: true, frames: true, longTasks: true }); vi.advanceTimersByTime(1000); });
  expect(view.getByText('Long tasks >50 ms').parentElement?.textContent).toContain('0');
  act(() => { meter.setActive(false); });
  expect(view.getByText('Client delay (ms)').parentElement?.textContent).toContain('Paused');
  expect(view.getByText('Frame interval (ms)').parentElement?.textContent).toContain('Paused');
});

it('keeps every definition linked to its own stable focus target across readout updates', () => {
  const { view, meter } = setup();
  for (const button of view.getAllByRole('button')) {
    act(() => { button.focus(); });
    const id = button.getAttribute('aria-describedby');
    expect(document.getElementById(id!)?.hidden).toBe(false);
    expect(button.className).toContain('focus-visible:outline-ring');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-describedby')).toBe(id);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(view.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(button);
  }
  act(() => { meter.setActive(false); });
});
