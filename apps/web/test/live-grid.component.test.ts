// @vitest-environment jsdom

import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { LiveGridInner } from '../src/modules/live-grid/LiveGrid';
import { createFakeRowSource } from '../src/modules/live-grid/fake';
import type { FakeRow } from '../src/modules/live-grid/fake';
import { COLUMNS as CONTRACT_COLUMNS, DEFAULT_COL_DEF } from '../src/board/columns';
import type { ContractRow } from '../src/store/contractRows';

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

// Read the grid's displayed positions, not the creation order of recycled DOM nodes.
function displayedIds(container: HTMLElement): (string | null | undefined)[] {
  return [0, 1, 2].map((index) => container.querySelector(`.ag-row[row-index="${String(index)}"]`)?.getAttribute('row-id'));
}

function contact(identifier: number, target: EventTarget): Touch {
  return { identifier, target } as Touch;
}

async function touchGrid() {
  const source = createFakeRowSource({ rowCount: 3, seed: 7 });
  const props = {
    source, columns: COLUMNS, label: 'Touch rows', selectedId: null,
    onSelect: vi.fn(), filter: null, stale: false, drawEveryRow: true,
  };
  const view = render(createElement(LiveGridInner<FakeRow>, props));
  await waitFor(() => expect(displayedIds(view.container)).toEqual(['r0', 'r1', 'r2']));
  fireEvent.click(view.container.querySelector('[col-id="value"] .ag-header-cell-label')!);
  await waitFor(() => expect(view.container.querySelector('[col-id="value"][aria-sort="ascending"]')).not.toBeNull());
  const target = rowOf(view.container, 'r0')!.querySelector('[col-id="value"]')!;
  const a = contact(1, target);
  fireEvent.touchStart(target, { touches: [a], changedTouches: [a] });
  act(() => {
    // r0 starts at 10,000; 101 increments take it above r1's 10,100.
    for (let i = 0; i < 101; i += 1) source.changeRows(['r0']);
  });
  await waitFor(() => expect(valueOf(view.container, 'r0')).toBe('10,101'));
  expect(displayedIds(view.container)).toEqual(['r0', 'r1', 'r2']);
  expect(view.getByRole('status').textContent).toContain('Sorting paused');
  return { view, props, target, a };
}

async function expectReleased(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(displayedIds(view.container)).toEqual(['r1', 'r0', 'r2']);
    expect(view.getByRole('status').textContent).not.toContain('Sorting paused');
  });
}

describe('the live grid touch lifecycle', () => {
  it.each([false, true])('keeps both table contacts until the last ends (same target: %s)', async (sameTarget) => {
    const { view, target, a } = await touchGrid();
    const other = sameTarget ? target : rowOf(view.container, 'r1')!;
    const b = contact(2, other);
    fireEvent.touchStart(other, { touches: [a, b], changedTouches: [b] });
    fireEvent.touchEnd(target, { touches: [b], changedTouches: [a] });
    expect(displayedIds(view.container)).toEqual(['r0', 'r1', 'r2']);
    expect(view.getByRole('status').textContent).toContain('Sorting paused');
    fireEvent.touchCancel(other, { touches: [], changedTouches: [b] });
    await expectReleased(view);
  });

  it('retains pointer and focus holds independently after the final touch', async () => {
    const { view, target, a } = await touchGrid();
    fireEvent.pointerOver(target, { pointerType: 'mouse' });
    fireEvent.focusIn(target);
    fireEvent.touchEnd(target, { touches: [], changedTouches: [a] });
    expect(view.getByRole('status').textContent).toContain('Sorting paused');
    fireEvent.pointerOut(target, { pointerType: 'mouse', relatedTarget: document.body });
    expect(displayedIds(view.container)).toEqual(['r0', 'r1', 'r2']);
    expect(view.getByRole('status').textContent).toContain('Sorting paused');
    fireEvent.focusOut(target, { relatedTarget: document.body });
    await expectReleased(view);
  });

  it('reconciles a terminal event at the document and removes native listeners on unmount', async () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    try {
      const { view, target, a } = await touchGrid();
      fireEvent.touchEnd(document.body, { touches: [], changedTouches: [a] });
      await expectReleased(view);
      fireEvent.touchStart(target, { touches: [a], changedTouches: [a] });
      const native = add.mock.calls.flatMap(([type, listener, options], index) =>
        ['touchstart', 'touchend', 'touchcancel'].includes(type) &&
        [document, target, view.container.firstElementChild].some((node) => node === add.mock.contexts[index]) &&
        typeof options === 'object' && options.passive === true && !options.capture
          ? [{ type, listener, target: add.mock.contexts[index] }] : []);
      view.unmount();
      expect(native.length).toBeGreaterThanOrEqual(5);
      for (const attached of native) {
        expect(remove.mock.calls.some(([type, listener], index) =>
          type === attached.type && listener === attached.listener && remove.mock.contexts[index] === attached.target,
        )).toBe(true);
      }
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('releases its last contact while another finger remains outside the table', async () => {
    const { view, target, a } = await touchGrid();
    const b = contact(2, document.body);
    fireEvent.touchStart(document.body, { touches: [a, b], changedTouches: [b] });
    fireEvent.touchEnd(target, { touches: [b], changedTouches: [a] });
    await expectReleased(view);
  });

  it.each(['touchend', 'touchcancel'])('hears %s on the detached original target', async (type) => {
    const { view, props, target, a } = await touchGrid();
    view.rerender(createElement(LiveGridInner<FakeRow>, { ...props, isHighlighted: () => true }));
    await waitFor(() => expect(target.isConnected).toBe(false));
    const reachedDocument = vi.fn();
    document.addEventListener(type, reachedDocument);
    try {
      const event = new TouchEvent(type, { bubbles: true, touches: [], changedTouches: [a] });
      act(() => { target.dispatchEvent(event); });
      expect(event.target).toBe(target);
      expect(reachedDocument).not.toHaveBeenCalled();
      await expectReleased(view);
    } finally {
      document.removeEventListener(type, reachedDocument);
    }
  });
});

it('sorts raw contract money numerically, keeping unavailable cost separate from genuine zero', async () => {
  const base: ContractRow = { id: '0', contractId: 0, companyId: 0, company: 'Example', ticker: 'EX', side: 'up',
    targetCents: 900, priceCents: 900, breakEvenCents: 900, costCents: 900, realCents: 900, hopeCents: 900, dimmed: false, dir: 0 };
  // $9 precedes $100 numerically, whereas their formatted strings compare in the opposite order.
  const rows: ContractRow[] = [
    { ...base, id: '100', contractId: 100, targetCents: 10000, priceCents: 10000, breakEvenCents: 10000, costCents: 10000, realCents: 10000, hopeCents: 10000 },
    { ...base, id: '9', contractId: 9 },
    { ...base, id: 'empty', contractId: 3, costCents: null },
    { ...base, id: 'zero', contractId: 4, costCents: 0 },
  ];
  const source = { rows: () => rows, latest: () => rows, subscribe: () => () => {}, onChanged: () => () => {} };
  const view = render(createElement(LiveGridInner<ContractRow>, {
    source, columns: CONTRACT_COLUMNS, defaultColDef: DEFAULT_COL_DEF, label: 'Contract values',
    selectedId: null, onSelect: () => {}, filter: null, stale: false, drawEveryRow: true,
  }));
  await waitFor(() => expect(rowOf(view.container, '9')).not.toBeNull());
  expect(rowOf(view.container, 'empty')?.querySelector('[col-id="costCents"]')?.textContent).toBe('—');
  expect(rowOf(view.container, 'zero')?.querySelector('[col-id="costCents"]')?.textContent).toBe('$0');
  for (const column of ['targetCents', 'price', 'breakEvenCents', 'realCents', 'hopeCents']) {
    fireEvent.click(view.container.querySelector(`[col-id="${column}"] .ag-header-cell-label`)!);
    await waitFor(() => expect(rowOf(view.container, '9')?.getAttribute('row-index')).toBe('0'));
    expect(rowOf(view.container, '100')?.getAttribute('row-index')).toBe('3');
  }
  fireEvent.click(view.container.querySelector('[col-id="costCents"] .ag-header-cell-label')!);
  await waitFor(() => expect([0, 1, 2, 3].map((index) => view.container.querySelector(`.ag-row[row-index="${String(index)}"]`)?.getAttribute('row-id')))
    .toEqual(['empty', 'zero', '9', '100']));
});

it('holds filter-only membership across touch and focus, applies explicit changes, and removes the hint when cleared', async () => {
  const source = createFakeRowSource({ rowCount: 3, seed: 7 });
  const props = { source, columns: COLUMNS, label: 'Filtered values', selectedId: null, onSelect: vi.fn(), stale: false, drawEveryRow: true };
  const below = (row: FakeRow) => row.value < 10100;
  const view = render(createElement(LiveGridInner<FakeRow>, { ...props, filter: below }));
  await waitFor(() => expect(shownIds(view.container)).toEqual(['r0']));
  const target = rowOf(view.container, 'r0')!;
  const a = contact(1, target);
  fireEvent.touchStart(target, { touches: [a], changedTouches: [a] });
  fireEvent.focusIn(target);
  expect(view.getByText('Sorting and filters paused')).toBeTruthy();
  act(() => { for (let i = 0; i < 101; i += 1) source.changeRows(['r0']); });
  await waitFor(() => expect(valueOf(view.container, 'r0')).toBe('10,101'));
  expect(shownIds(view.container)).toEqual(['r0']);
  fireEvent.touchCancel(target, { touches: [], changedTouches: [a] });
  expect(shownIds(view.container)).toEqual(['r0']);
  fireEvent.focusOut(target, { relatedTarget: document.body });
  await waitFor(() => expect(shownIds(view.container)).toEqual([]));
  const wrapper = view.container.firstElementChild!;
  fireEvent.pointerOver(wrapper, { pointerType: 'mouse' });
  view.rerender(createElement(LiveGridInner<FakeRow>, { ...props, filter: null }));
  await waitFor(() => expect(shownIds(view.container)).toEqual(['r0', 'r1', 'r2']));
  expect(view.queryByText('Sorting and filters paused')).toBeNull();
  view.rerender(createElement(LiveGridInner<FakeRow>, { ...props, filter: onlyG1 }));
  await waitFor(() => expect(shownIds(view.container)).toEqual(['r1']));
  expect(view.getByText('Sorting and filters paused')).toBeTruthy();
  fireEvent.click(view.container.querySelector('[col-id="value"] .ag-header-cell-label')!);
  view.rerender(createElement(LiveGridInner<FakeRow>, { ...props, filter: null }));
  await waitFor(() => expect(view.getByText('Sorting paused')).toBeTruthy());
  fireEvent.pointerOut(wrapper, { pointerType: 'mouse', relatedTarget: document.body });
  expect(view.queryByText('Sorting paused')).toBeNull();
});
