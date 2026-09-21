import { describe, expect, it } from 'vitest';
import labEntry from '../src/lab/modules/live-grid.lab';
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
