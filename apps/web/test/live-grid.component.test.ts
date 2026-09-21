// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { LiveGridInner } from '../src/modules/live-grid/LiveGrid';
import { createFakeRowSource } from '../src/modules/live-grid/fake';
import type { FakeRow } from '../src/modules/live-grid/fake';

/**
 * The table itself, mounted in a made-up document: a filter arrives while
 * values are streaming in, and the row the caller selected is still the
 * selected row when it comes back into view.
 *
 * A made-up document lays nothing out, so every row has no height and the
 * grid, which draws only the rows on screen, would draw none. The test asks
 * the component to draw every row, which is the one thing about it that is
 * different here from the page.
 */

const WHOLE_NUMBER = new Intl.NumberFormat('en-US');

const COLUMNS: ColDef<FakeRow>[] = [
  { headerName: 'Row', field: 'label' },
  { headerName: 'Group', field: 'group' },
  {
    headerName: 'Value',
    field: 'value',
    valueFormatter: (params: ValueFormatterParams<FakeRow, number>): string =>
      params.value == null ? '' : WHOLE_NUMBER.format(params.value),
    sortable: true,
  },
];

const onlyG1 = (row: FakeRow): boolean => row.group === 'G1';

/** The ids of the rows the table is showing, in document order, each once. */
function shownIds(container: HTMLElement): string[] {
  const ids = [...container.querySelectorAll('.ag-row')].map((row) => row.getAttribute('row-id') ?? '');
  return [...new Set(ids)].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}

function rowOf(container: HTMLElement, id: string): Element | null {
  return container.querySelector(`.ag-row[row-id="${id}"]`);
}

function valueOf(container: HTMLElement, id: string): string | null {
  return rowOf(container, id)?.querySelector('[col-id="value"]')?.textContent ?? null;
}

afterEach(cleanup);

describe('the live grid, filtered while its values stream', () => {
  it('keeps the selected row selected through a filter that hides it, and shows its latest value when it returns', async () => {
    const source = createFakeRowSource({ rowCount: 12, seed: 7 });
    const onSelect = vi.fn<(id: string) => void>();
    const props = {
      source,
      columns: COLUMNS,
      label: 'Made-up rows',
      selectedId: 'r3',
      onSelect,
      stale: false,
      drawEveryRow: true,
    };

    const view = render(createElement(LiveGridInner<FakeRow>, { ...props, filter: null }));
    const table = view.container;

    // All twelve rows, and the caller's row is the selected one.
    await waitFor(() => {
      expect(shownIds(table)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11']);
      expect(rowOf(table, 'r3')?.getAttribute('aria-selected')).toBe('true');
    });
    expect(table.querySelector('[role="grid"], [role="treegrid"]')?.getAttribute('aria-label')).toBe('Made-up rows');

    // Values start to stream: r1 and r3 each step up by one.
    source.changeRows(['r1', 'r3']);
    await waitFor(() => {
      expect(valueOf(table, 'r3')).toBe('10,301'); // 10,300 + 1
    });

    // A filter arrives in the middle of it. Twelve rows in six groups: G1 holds r1 and r7.
    view.rerender(createElement(LiveGridInner<FakeRow>, { ...props, filter: onlyG1 }));
    await waitFor(() => {
      expect(shownIds(table)).toEqual(['r1', 'r7']);
    });

    // The stream goes on while r3 is out of sight.
    source.changeRows(['r1', 'r3']);
    await waitFor(() => {
      expect(valueOf(table, 'r1')).toBe('10,102'); // 10,100 + 1 + 1
    });
    expect(shownIds(table)).toEqual(['r1', 'r7']);

    // The filter is cleared: r3 is back, still the selected row, showing its latest value.
    view.rerender(createElement(LiveGridInner<FakeRow>, { ...props, filter: null }));
    await waitFor(() => {
      expect(shownIds(table)).toContain('r3');
      expect(rowOf(table, 'r3')?.getAttribute('aria-selected')).toBe('true');
    });
    expect(valueOf(table, 'r3')).toBe('10,302'); // 10,300 + 1 + 1
    expect([...table.querySelectorAll('.ag-row[aria-selected="true"]')].map((row) => row.getAttribute('row-id'))).toEqual([
      'r3',
    ]);

    // Nothing the table did along the way asked the caller to change the selection.
    expect(onSelect).not.toHaveBeenCalled();
  });
});
