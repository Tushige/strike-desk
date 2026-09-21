import { describe, expect, it } from 'vitest';
import { createFrameCoalescer } from '../src/modules/price-chart/frameCoalescer';
import { followRange, pathOf, spreadApart, widenRange, xOf, yOf } from '../src/modules/price-chart/scale';

/**
 * The chart's drawing maths: where a price index and a price land in a box of
 * pixels, and the text of the line through them; the scale that only widens;
 * and the rule of one draw per animation frame. Every expected value is typed
 * in, with its arithmetic beside it.
 */

/**
 * A stand-in for the browser's animation frame, driven by hand: it holds what
 * was asked for until the test says a frame has come.
 */
function handDrivenFrames(): { requestFrame: (run: () => void) => () => void; asked: () => number; runFrame: () => void } {
  let waiting: (() => void)[] = [];
  let asked = 0;
  return {
    requestFrame(run) {
      asked += 1;
      waiting.push(run);
      return () => {
        waiting = waiting.filter((one) => one !== run);
      };
    },
    asked: () => asked,
    runFrame() {
      const due = waiting;
      waiting = [];
      for (const run of due) run();
    },
  };
}

describe('one draw per animation frame', () => {
  it('asks for one frame and draws once, however many notifications arrive before it', () => {
    const frames = handDrivenFrames();
    let draws = 0;
    const coalescer = createFrameCoalescer(frames.requestFrame, () => {
      draws += 1;
    });

    coalescer.notify();
    coalescer.notify();
    coalescer.notify();

    // Three notifications, one frame asked for, nothing drawn until it comes.
    expect(frames.asked()).toBe(1);
    expect(draws).toBe(0);

    frames.runFrame();

    expect(draws).toBe(1);
  });

  it('asks for another frame for a notification after the frame has run', () => {
    const frames = handDrivenFrames();
    let draws = 0;
    const coalescer = createFrameCoalescer(frames.requestFrame, () => {
      draws += 1;
    });

    coalescer.notify();
    frames.runFrame();
    coalescer.notify();

    // One frame for the first notification, a second for the one after it.
    expect(frames.asked()).toBe(2);

    frames.runFrame();

    expect(draws).toBe(2);
  });

  it('draws nothing for a frame that was asked for and then cancelled', () => {
    const frames = handDrivenFrames();
    let draws = 0;
    const coalescer = createFrameCoalescer(frames.requestFrame, () => {
      draws += 1;
    });

    coalescer.notify();
    coalescer.cancel();
    frames.runFrame();

    expect(draws).toBe(0);
  });

  it('draws again for a notification after a cancel', () => {
    const frames = handDrivenFrames();
    let draws = 0;
    const coalescer = createFrameCoalescer(frames.requestFrame, () => {
      draws += 1;
    });

    coalescer.notify();
    coalescer.cancel();
    coalescer.notify();
    frames.runFrame();

    // The cancelled frame never draws; the one asked for after it does.
    expect(frames.asked()).toBe(2);
    expect(draws).toBe(1);
  });
});

describe('the scale that only widens', () => {
  it('widens to hold a price above it', () => {
    // 9,100 is above 9,000, so the top moves up to it; 8,400 is inside, so the bottom stays.
    expect(widenRange({ min: 8000, max: 9000 }, [8400, 9100])).toEqual({ min: 8000, max: 9100 });
  });

  it('never narrows again within a day', () => {
    const widened = widenRange({ min: 8000, max: 9000 }, [8400, 9100]);

    // Both prices are inside 8,000 to 9,100, so nothing moves: the top stays at 9,100.
    expect(widenRange(widened, [8400, 8500])).toEqual({ min: 8000, max: 9100 });
  });

  it('widens to hold a price below it', () => {
    expect(widenRange({ min: 8000, max: 9000 }, [7950])).toEqual({ min: 7950, max: 9000 });
  });

  it('hands back the same range when nothing had to move', () => {
    const range = { min: 8000, max: 9000 };

    expect(widenRange(range, [8400, 8500])).toBe(range);
    expect(widenRange(range, [])).toBe(range);
  });
});

describe("the chart's range through a day", () => {
  const caller = { min: 8000, max: 9000 };

  it("starts from the caller's scale", () => {
    const range = followRange(null, caller, { startIndex: 0, values: [8400] });

    expect(range.min).toBe(8000);
    expect(range.max).toBe(9000);
  });

  it('is never widened by a price the series does not hold yet', () => {
    // A day that will reach 9,500 at its fourth point. With three points held, the top is still the caller's.
    const day = [8400, 8450, 8500, 9500];
    const early = followRange(null, caller, { startIndex: 0, values: day.slice(0, 3) });

    expect(early.max).toBe(9000);

    // Only once the fourth point has arrived does the top move, to that point.
    const later = followRange(early, caller, { startIndex: 0, values: day });

    expect(later.max).toBe(9500);
  });

  it('keeps what it widened to as the day goes on', () => {
    const high = followRange(null, caller, { startIndex: 0, values: [8400, 9100] });
    const after = followRange(high, caller, { startIndex: 0, values: [8400, 9100, 8500] });

    expect(after.min).toBe(8000);
    expect(after.max).toBe(9100);
  });

  it("starts again from the caller's scale when the series starts again", () => {
    const high = followRange(null, caller, { startIndex: 0, values: [8400, 9100, 9200] });

    expect(high.max).toBe(9200);

    // A new day: one value where there were three.
    const nextDay = followRange(high, caller, { startIndex: 0, values: [8450] });

    expect(nextDay.min).toBe(8000);
    expect(nextDay.max).toBe(9000);
  });

  it("starts again when the caller's scale changes, as it does for another company", () => {
    const high = followRange(null, caller, { startIndex: 0, values: [8400, 9100] });
    const other = followRange(high, { min: 5000, max: 6000 }, { startIndex: 0, values: [5400, 5500] });

    expect(other.min).toBe(5000);
    expect(other.max).toBe(6000);
  });
});

describe('labels that would sit on top of each other', () => {
  it('are left alone when they are far enough apart', () => {
    expect(spreadApart([40, 100], 13)).toEqual([40, 100]);
  });

  it('are moved apart to the gap, the lower one down, each keeping its place in the list', () => {
    // 104 is 4 below 100 and the gap is 13, so it moves down to 100 + 13 = 113.
    expect(spreadApart([100, 104], 13)).toEqual([100, 113]);
    // The same two the other way round in the list: the first is the lower one, and it is the one that moves.
    expect(spreadApart([104, 100], 13)).toEqual([113, 100]);
  });
});


describe('where a price index lands across the box', () => {
  it('is half of the way along for the middle index', () => {
    // 250 is half of the way from 0 to 500; half of 600 is 300.
    expect(xOf(250, 0, 500, 600)).toBe(300);
  });

  it('is the left edge for the first index and the right edge for the last', () => {
    expect(xOf(0, 0, 500, 600)).toBe(0);
    expect(xOf(500, 0, 500, 600)).toBe(600);
  });

  it('is left of the box for an index before the first', () => {
    // Two steps before 0, at 600 / 500 = 1.2 pixels a step: -2.4.
    expect(xOf(-2, 0, 500, 600)).toBe(-2.4);
  });

  it('keeps one decimal and no more', () => {
    // 1 of 3 steps across 100 pixels is 33.333...; one decimal is 33.3.
    expect(xOf(1, 0, 3, 100)).toBe(33.3);
  });
});

describe('where a price lands down the box', () => {
  it('is the middle for the middle price', () => {
    // 9,000 is half of the way from 8,000 to 10,000; half of 200 is 100.
    expect(yOf(9000, 8000, 10000, 200)).toBe(100);
  });

  it('is the top for the highest price', () => {
    expect(yOf(10000, 8000, 10000, 200)).toBe(0);
  });

  it('is the bottom for the lowest price', () => {
    expect(yOf(8000, 8000, 10000, 200)).toBe(200);
  });
});

describe('the text of the price line', () => {
  const box = { xMin: 0, xMax: 500, yMinCents: 8000, yMaxCents: 9000, width: 500, height: 100 };

  it('moves to the first point and draws a line to each one after it', () => {
    // One pixel a step across. Down the box, each price is 100 times one minus
    // its share of the way from 8,000 to 9,000:
    //   8,400 is 0.40 of the way: 60.  8,450 is 0.45: 55.  8,300 is 0.30: 70.
    expect(pathOf({ startIndex: 0, values: [8400, 8450, 8300] }, box)).toBe('M0,60L1,55L2,70');
  });

  it('is empty for an empty series', () => {
    expect(pathOf({ startIndex: 0, values: [] }, box)).toBe('');
  });

  it('starts left of the box when the series starts before the first index', () => {
    // The first value sits at index -2, one pixel a step: x is -2, then -1, then 0.
    expect(pathOf({ startIndex: -2, values: [8400, 8450, 8300] }, box)).toBe('M-2,60L-1,55L0,70');
  });

  it('never writes a position with more than one decimal', () => {
    // 3 steps across 100 pixels and 7 price steps down 100 pixels: thirds and sevenths.
    const text = pathOf(
      { startIndex: 0, values: [1, 2, 3, 5] },
      { xMin: 0, xMax: 3, yMinCents: 0, yMaxCents: 7, width: 100, height: 100 },
    );

    // x: 0, 33.333, 66.666, 100. y: 100 * (1 - 1/7) = 85.714, (1 - 2/7) = 71.428, (1 - 3/7) = 57.142, (1 - 5/7) = 28.571.
    expect(text).toBe('M0,85.7L33.3,71.4L66.7,57.1L100,28.6');
  });
});
