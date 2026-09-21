import { describe, expect, it } from 'vitest';
import labEntry from '../src/lab/modules/live-grid.lab';
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
