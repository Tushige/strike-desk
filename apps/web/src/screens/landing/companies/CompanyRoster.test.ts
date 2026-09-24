// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanyRoster } from './CompanyRoster';

const motion = vi.hoisted(() => ({
  timelines: [] as Array<{
    fromTo: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    shiftChildren: ReturnType<typeof vi.fn>;
    complete: () => void;
  }>,
  revert: vi.fn(),
}));
vi.mock('gsap', () => ({
  gsap: {
    timeline: vi.fn((options: { onComplete: () => void }) => {
      const timeline = {
        fromTo: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        shiftChildren: vi.fn().mockReturnThis(),
        complete: options.onComplete,
      };
      motion.timelines.push(timeline);
      return timeline;
    }),
    set: vi.fn(),
    context: vi.fn((work: () => void) => {
      work();
      return { revert: motion.revert };
    }),
  },
}));
vi.mock('../../../store/hooks', () => ({
  useCompanies: () =>
    Array.from({ length: 6 }, (_, index) => ({
      ticker: String(index),
      name: `Company ${String(index)}`,
      product: 'Robot pets',
    })),
}));
vi.mock('../../ui', () => ({ CompanyTile: () => createElement('span', null, 'Logo') }));

let desktop: boolean;
let listTop: number;
let listHeight: number;
let rowTops: number[];
let notify: () => void;
let observed: Element[];
let disconnect: ReturnType<typeof vi.fn>;
const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 100, width: 100 }) as DOMRect;
beforeEach(() => {
  motion.timelines.length = 0;
  motion.revert.mockClear();
  desktop = true;
  listTop = 700;
  listHeight = 150;
  rowTops = Array(6).fill(700) as number[];
  observed = [];
  disconnect = vi.fn();
  vi.stubGlobal('innerHeight', 800);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return desktop;
    },
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(node: Element) {
        observed.push(node);
      }
      disconnect = disconnect;
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'UL') return rect(listTop, listHeight);
    if (this.tagName === 'LI')
      return rect(rowTops[[...this.parentElement!.children].indexOf(this)]!, 40);
    return rect(0, 20);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('preserves the company start offsets in real GSAP, not just the mock calls', async () => {
  const actual = await vi.importActual<typeof import('gsap')>('gsap');
  const mocked = await import('gsap');
  for (let index = 0; index < 6; index++) {
    vi.mocked(mocked.gsap.timeline).mockImplementationOnce(actual.gsap.timeline);
  }
  vi.mocked(mocked.gsap.context).mockImplementationOnce(actual.gsap.context);
  listTop = 100;
  rowTops = Array(6).fill(100) as number[];
  const view = render(createElement(CompanyRoster));
  actual.gsap.ticker.sleep();
  const logos = [...view.container.querySelectorAll('li > span')];
  expect(logos).toHaveLength(6);
  logos.forEach((logo, index) => {
    expect(actual.gsap.getTweensOf(logo)[0]!.startTime()).toBeCloseTo(index * 0.1);
  });
  view.unmount();
});

it('waits for the full desktop list height, then starts immediately with overlapping items', () => {
  const view = render(createElement(CompanyRoster));
  expect(observed[0]).toBe(view.container.querySelector('ul'));
  act(() => {
    notify();
  });
  expect(motion.timelines.every((timeline) => timeline.play.mock.calls.length === 0)).toBe(true);
  listTop = 650;
  act(() => {
    notify();
  });
  motion.timelines.forEach((timeline, index) => {
    expect(timeline.play).toHaveBeenCalledTimes(1);
    expect(timeline.shiftChildren).toHaveBeenCalledWith(index * 0.1);
    const [logo, title, subtitle] = timeline.fromTo.mock.calls as [
      Element,
      unknown,
      { duration: number },
      number,
    ][];
    expect(title![3]).toBeGreaterThan(logo![3]);
    expect(subtitle![3]).toBeGreaterThan(title![3]);
    expect(subtitle![3]).toBeLessThan(logo![2].duration);
  });
  // Crossing below the full-list start threshold does not freeze an active reveal.
  listTop = 700;
  const pauses = motion.timelines.map((timeline) => timeline.pause.mock.calls.length);
  act(() => {
    notify();
  });
  expect(motion.timelines.map((timeline) => timeline.pause.mock.calls.length)).toEqual(pauses);
});

it('reveals mobile rows as they become visible without consuming lower rows offscreen', () => {
  desktop = false;
  listTop = 740;
  listHeight = 220;
  rowTops = [740, 740, 820, 820, 900, 900];
  render(createElement(CompanyRoster));
  expect(
    motion.timelines.slice(0, 2).every((timeline) => timeline.play.mock.calls.length === 1),
  ).toBe(true);
  expect(motion.timelines.slice(2).every((timeline) => timeline.play.mock.calls.length === 0)).toBe(
    true,
  );
  rowTops = [620, 620, 700, 700, 780, 780];
  act(() => {
    notify();
  });
  expect(motion.timelines[2]!.shiftChildren).toHaveBeenCalledWith(0);
  expect(motion.timelines[3]!.shiftChildren).toHaveBeenCalledWith(0.1);
  expect(motion.timelines[4]!.play).not.toHaveBeenCalled();
});

it('uses visible rows when desktop height cannot fit, and reevaluates a viewport resize', () => {
  listHeight = 1000;
  rowTops = [700, 700, 810, 810, 920, 920];
  render(createElement(CompanyRoster));
  expect(motion.timelines[0]!.play).toHaveBeenCalledTimes(1);
  expect(motion.timelines[2]!.play).not.toHaveBeenCalled();
  vi.stubGlobal('innerHeight', 900);
  fireEvent(window, new Event('resize'));
  expect(motion.timelines[2]!.play).toHaveBeenCalledTimes(1);
});

it('does not replay completed companies and disconnects its own animation on unmount', () => {
  listTop = 100;
  rowTops = Array(6).fill(100) as number[];
  const view = render(createElement(CompanyRoster));
  act(() => {
    motion.timelines.forEach((timeline) => {
      timeline.complete();
    });
  });
  act(() => {
    notify();
  });
  expect(motion.timelines.every((timeline) => timeline.play.mock.calls.length === 1)).toBe(true);
  expect(disconnect).toHaveBeenCalled();
  view.unmount();
  expect(motion.revert).toHaveBeenCalledTimes(1);
});

it('pauses in a hidden tab and remains usable without IntersectionObserver', () => {
  listTop = 100;
  rowTops = Array(6).fill(100) as number[];
  const view = render(createElement(CompanyRoster));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(motion.timelines.every((timeline) => timeline.pause.mock.calls.length > 0)).toBe(true);
  view.unmount();
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  render(createElement(CompanyRoster));
  expect(motion.timelines.slice(6).every((timeline) => timeline.play.mock.calls.length === 1)).toBe(
    true,
  );
});
