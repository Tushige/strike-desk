import type { StressMeasurements } from './stressMeasurements';

/** Browser capabilities vary between the real page and a deterministic DOM test. */
export interface TableWatchOptions {
  requestFrame?: ((run: FrameRequestCallback) => number) | null;
  cancelFrame?: (id: number) => void;
  isVisible?: (element: HTMLElement) => boolean;
  observeLongTasks?: ((deliver: (entries: readonly { startTime: number; duration: number }[]) => void) => () => void) | null;
  observeText?: ((table: HTMLElement, deliver: (records: readonly MutationRecord[]) => void) => () => void) | null;
}

function observeText(table: HTMLElement, deliver: (records: readonly MutationRecord[]) => void): () => void {
  const observer = new MutationObserver(deliver);
  try { observer.observe(table, { subtree: true, childList: true, characterData: true }); }
  catch (error) { observer.disconnect(); throw error; }
  return () => { observer.disconnect(); };
}
function longTaskObserver(): TableWatchOptions['observeLongTasks'] {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return null;
  return (deliver) => {
    const observer = new PerformanceObserver((list) => { deliver(list.getEntries()); });
    try { observer.observe({ type: 'longtask' }); }
    catch (error) { observer.disconnect(); throw error; }
    return () => { observer.disconnect(); };
  };
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden]') !== null) return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.right <= 0 || box.top >= window.innerHeight || box.left >= window.innerWidth) return false;
  const viewport = element.closest('.ag-body-viewport');
  if (viewport !== null) {
    const clip = viewport.getBoundingClientRect();
    if (box.bottom <= clip.top || box.top >= clip.bottom || box.right <= clip.left || box.left >= clip.right) return false;
  }
  for (let parent: HTMLElement | null = element; parent !== null; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parent === element) continue;
    const clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (box.bottom <= clip.top || box.top >= clip.bottom)) return false;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (box.right <= clip.left || box.left >= clip.right)) return false;
  }
  return true;
}

/** Correlates text changes in actual price cells at the next rendering opportunity. */
export function watchTable(table: HTMLElement, measurements: StressMeasurements, options: TableWatchOptions = {}): () => void {
  const requestFrame = options.requestFrame === undefined
    ? (typeof window.requestAnimationFrame === 'function' ? (run: FrameRequestCallback) => window.requestAnimationFrame(run) : null)
    : options.requestFrame;
  const cancelFrame = options.cancelFrame ?? ((id) => { window.cancelAnimationFrame(id); });
  const isVisible = options.isVisible ?? visible;
  const dirty = new Set<HTMLElement>();
  let stopped = false;
  let frame = 0;
  let active = false;
  function visibility() {
    if (stopped) return false;
    const next = document.visibilityState !== 'hidden' && isVisible(table);
    if (next !== active) { active = next; dirty.clear(); measurements.setActive(next); }
    return next;
  }
  const add = (cell: HTMLElement) => { if (dirty.size < 4096) dirty.add(cell); };
  const mark = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    const cell = element?.closest<HTMLElement>('.ag-row[row-id] [col-id="price"]');
    if (cell !== null && cell !== undefined && table.contains(cell)) add(cell);
  };
  const onText = (records: readonly MutationRecord[]) => {
    if (!visibility()) return;
    for (const record of records) {
      mark(record.target);
      for (const node of record.addedNodes) {
        mark(node);
        if (node instanceof Element) node.querySelectorAll<HTMLElement>('.ag-row[row-id] [col-id="price"]').forEach(add);
      }
    }
  };
  let stopTexts: (() => void) | undefined;
  let stopTasks: (() => void) | undefined;
  try { stopTexts = (options.observeText === undefined ? observeText : options.observeText)?.(table, onText); } catch { /* Only this measurement becomes unavailable. */ }
  try {
    stopTasks = (options.observeLongTasks === undefined ? longTaskObserver() : options.observeLongTasks)?.((entries) => {
      if (stopped || !visibility()) return;
      for (const entry of entries) measurements.longTask(entry.startTime, entry.duration);
    });
  } catch { /* Workload and frame measurements remain usable. */ }
  measurements.setSupport({ delay: stopTexts !== undefined && requestFrame !== null, frames: requestFrame !== null, longTasks: stopTasks !== undefined });
  const onFrame = (at: number) => {
    if (stopped) return;
    if (visibility()) {
      measurements.frame(at);
      for (const cell of dirty) {
        if (!table.contains(cell) || !isVisible(cell)) continue;
        const id = Number(cell.closest('.ag-row[row-id]')?.getAttribute('row-id'));
        if (Number.isSafeInteger(id)) measurements.shownPrice(id, cell.textContent?.trim() ?? '', at);
      }
      dirty.clear();
    }
    frame = requestFrame?.(onFrame) ?? 0;
  };
  document.addEventListener('visibilitychange', visibility);
  visibility();
  frame = requestFrame?.(onFrame) ?? 0;
  return () => {
    if (stopped) return;
    stopped = true;
    cancelFrame(frame);
    stopTexts?.();
    stopTasks?.();
    document.removeEventListener('visibilitychange', visibility);
    dirty.clear();
    measurements.setActive(false);
  };
}
