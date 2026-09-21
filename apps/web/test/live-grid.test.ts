import { describe, expect, it } from 'vitest';
import labEntry from '../src/lab/modules/live-grid.lab';
import { createDelayProbe, createFrameProbe, createLongTaskProbe, percentile } from '../src/lab/modules/live-grid.probes';
import { createReadoutMeter } from '../src/modules/live-grid/readout';
import { createSortPause } from '../src/modules/live-grid/sortPause';
import labPage from '../lab/index.html?raw';

/**
 * The live grid's own tests: the pure rules behind it, and the two facts about
 * its lab page that nothing else would notice going wrong.
 */

describe("the lab page's document", () => {
  it('names the cascade layers in the order the table needs, before any stylesheet loads', () => {
    // The table writes its styles into `ag-grid`: after the reset, before the utilities.
    expect(labPage).toContain('<style>@layer theme, base, ag-grid, components, utilities;</style>');
    expect(labPage.indexOf('@layer theme, base, ag-grid, components, utilities;')).toBeLessThan(
      labPage.indexOf('<script'),
    );
  });
});

describe("the live grid's lab entry", () => {
  it('keeps its place in the list and loads a demo', () => {
    expect(labEntry.id).toBe('live-grid');
    expect(labEntry.order).toBe(1);
    expect(labEntry.title).toBe('Live grid');
    expect(typeof labEntry.demo).toBe('function');
  });
});

describe('when sorting is paused', () => {
  it('starts unpaused, with nothing to catch up on', () => {
    const pause = createSortPause();

    expect(pause.state()).toEqual({ paused: false, catchUp: false });
  });

  it('stays paused while either the pointer or the focus is still in the table', () => {
    const pause = createSortPause();

    expect(pause.on('pointerIn')).toEqual({ paused: true, catchUp: false });
    expect(pause.on('focusIn')).toEqual({ paused: true, catchUp: false });
    // The pointer has left, the focus has not.
    expect(pause.on('pointerOut')).toEqual({ paused: true, catchUp: false });
  });

  it('catches up exactly once, on the event after which both have left', () => {
    const pause = createSortPause();
    pause.on('pointerIn');
    pause.on('focusIn');
    pause.on('pointerOut');

    expect(pause.on('focusOut')).toEqual({ paused: false, catchUp: true });
    // A second goodbye is not a second catch-up.
    expect(pause.on('focusOut')).toEqual({ paused: false, catchUp: false });
    expect(pause.state()).toEqual({ paused: false, catchUp: false });
  });

  it('catches up when the pointer alone came and went', () => {
    const pause = createSortPause();
    pause.on('pointerIn');

    expect(pause.on('pointerOut')).toEqual({ paused: false, catchUp: true });
  });

  it('counts a touch that started inside the table as the pointer being in, until the touch ends', () => {
    const pause = createSortPause();

    expect(pause.on('touchStart')).toEqual({ paused: true, catchUp: false });
    // A browser that takes the touch for scrolling cancels its pointer, which
    // then "leaves" while the finger is still moving the rows.
    expect(pause.on('pointerOut')).toEqual({ paused: true, catchUp: false });
    expect(pause.on('touchEnd')).toEqual({ paused: false, catchUp: true });
  });
});

describe("the grid's readout meter", () => {
  /** Three batches inside the first second: 40, 60 and 25 rows, applied 4, 9 and 6 ms after being handed over. */
  function afterThreeBatches(): ReturnType<typeof createReadoutMeter> {
    const meter = createReadoutMeter();
    meter.handedOver(40, 100)(104);
    meter.handedOver(60, 400)(409);
    meter.handedOver(25, 900)(906);
    return meter;
  }

  it('reports the rows and batches of the last second, the last apply time and the worst', () => {
    const meter = afterThreeBatches();

    expect(meter.sample(1000, 252)).toEqual({
      rowCount: 252,
      rowsPerSecond: 125, // 40 + 60 + 25
      batchesPerSecond: 3,
      lastApplyMs: 6, // 906 - 900
      worstApplyMs: 9, // 409 - 400
    });
  });

  it('reports a quiet second as nothing handed over, and keeps the last and the worst apply times', () => {
    const meter = afterThreeBatches();
    meter.sample(1000, 252);

    expect(meter.sample(2000, 252)).toEqual({
      rowCount: 252,
      rowsPerSecond: 0,
      batchesPerSecond: 0,
      lastApplyMs: 6,
      worstApplyMs: 9,
    });
  });

  it('forgets the worst apply time when the row set is replaced', () => {
    const meter = afterThreeBatches();
    meter.sample(1000, 252);

    meter.reset();
    meter.handedOver(10, 1100)(1103);

    expect(meter.sample(2000, 2500)).toEqual({
      rowCount: 2500,
      rowsPerSecond: 10,
      batchesPerSecond: 1,
      lastApplyMs: 3, // 1103 - 1100
      worstApplyMs: 3,
    });
  });

  it('scales a sample that came late to a whole second', () => {
    const meter = createReadoutMeter();
    meter.sample(1000, 252);
    meter.handedOver(30, 1500)(1504);
    meter.handedOver(30, 2000)(2004);
    meter.handedOver(30, 2400)(2404);

    // 90 rows in 3 batches over 1,500 ms: 90 x 1000 / 1500 = 60 rows and 3 x 1000 / 1500 = 2 batches a second.
    expect(meter.sample(2500, 252)).toEqual({
      rowCount: 252,
      rowsPerSecond: 60,
      batchesPerSecond: 2,
      lastApplyMs: 4,
      worstApplyMs: 4,
    });
  });

  it('counts a batch in the second it was handed over, even if the grid has not applied it yet', () => {
    const meter = createReadoutMeter();
    meter.handedOver(7, 990);

    expect(meter.sample(1000, 12)).toEqual({
      rowCount: 12,
      rowsPerSecond: 7,
      batchesPerSecond: 1,
      lastApplyMs: 0,
      worstApplyMs: 0,
    });
  });
});

describe("the page's probes", () => {
  const GAPS = [16, 16, 17, 16, 16, 16, 17, 16, 16, 100];

  it('takes the typical value as the median and the worst 5% as the 95th percentile, nearest rank', () => {
    // Sorted: 16 x7, 17 x2, 100. Median: rank ceil(0.5 x 10) = 5, the fifth value, 16.
    expect(percentile(GAPS, 50)).toBe(16);
    // 95th: rank ceil(0.95 x 10) = 10, the tenth value, 100.
    expect(percentile(GAPS, 95)).toBe(100);
  });

  it('has no percentile of nothing', () => {
    expect(percentile([], 95)).toBeNull();
  });

  it('measures the gaps between animation frames', () => {
    const probe = createFrameProbe();
    // Frames at 0, 16, 32, 49, 65, 81, 97, 114, 130, 146 and 246: the ten gaps above.
    let at = 0;
    probe.frame(at);
    for (const gap of GAPS) {
      at += gap;
      probe.frame(at);
    }

    expect(probe.sample(246)).toEqual({ count: 10, typicalMs: 16, worstMs: 100 });
  });

  it('does not count the gap across a hidden tab as a frame interval', () => {
    const probe = createFrameProbe();
    probe.frame(0);
    probe.frame(16);
    probe.hidden();
    // Three seconds later the tab is back: the first frame starts a new run, and 16 to 3,016 is no gap.
    probe.frame(3_016);
    probe.frame(3_033);

    expect(probe.sample(3_033)).toEqual({ count: 2, typicalMs: 16, worstMs: 17 });
  });

  it('forgets frames older than its ten-second window', () => {
    const probe = createFrameProbe();
    probe.frame(0);
    probe.frame(100); // a slow frame, long ago
    probe.frame(20_000);
    probe.frame(20_016);

    // The gap from 100 to 20,000 is inside the window and is a real stall; the 100 ms one has aged out.
    expect(probe.sample(20_016)).toEqual({ count: 2, typicalMs: 16, worstMs: 19_900 });
  });

  it('times a change from the moment it was made to the first frame after it was written to the page', () => {
    const probe = createDelayProbe();
    probe.changed(1000);
    probe.frame(1010); // a frame before anything was written does not count
    probe.written();
    probe.frame(1058);
    probe.changed(1200);
    probe.written();
    probe.written(); // a second write of the same change changes nothing
    probe.frame(1262);

    // 1058 - 1000 = 58 and 1262 - 1200 = 62; the median of two, nearest rank, is the first.
    expect(probe.sample(1300)).toEqual({ count: 2, typicalMs: 58, worstMs: 62 });
  });

  it('drops a change that never reached the page, and one made while the tab was hidden', () => {
    const probe = createDelayProbe();
    probe.changed(1000); // touched no row on screen: nothing is written
    probe.changed(1200);
    probe.written();
    probe.hidden();
    probe.frame(9000);

    expect(probe.sample(9000)).toEqual({ count: 0, typicalMs: null, worstMs: null });
  });

  it('counts the tasks of 50 ms and over, and says whether the browser can report them at all', () => {
    const probe = createLongTaskProbe(true);
    probe.task(1000, 49); // under the line
    probe.task(2000, 50);
    probe.task(3000, 120);

    expect(probe.sample(4000)).toEqual({ supported: true, count: 2, longestMs: 120 });
    expect(createLongTaskProbe(false).sample(4000)).toEqual({ supported: false, count: 0, longestMs: 0 });
  });
});
