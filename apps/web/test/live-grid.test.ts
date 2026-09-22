import { describe, expect, it } from 'vitest';
import { createReadoutMeter } from '../src/modules/live-grid/readout';
import { createSortPause } from '../src/modules/live-grid/sortPause';

/**
 * The live grid's own tests: the pure rules behind it.
 */

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
