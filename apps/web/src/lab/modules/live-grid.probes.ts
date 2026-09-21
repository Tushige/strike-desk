/**
 * What only a page can measure about a live table: how evenly the screen is
 * drawn, whether anything blocked it, and how long a changed value takes to
 * be shown.
 *
 * The probes at the top are pure: they are told times and answer with
 * numbers, so they can be tried without a browser. `watchPage` at the bottom
 * is the one part that touches the page, and all it does is tell the probes
 * what happened and when.
 *
 * Two rules every probe keeps. A tab that is hidden is not measured: a hidden
 * tab draws no frames, and the gap until it comes back is not a slow frame.
 * And a browser that cannot measure something says so, never zero.
 */

/** How far back a sample looks, in milliseconds. */
const WINDOW_MS = 10_000;

/** A task this long or longer is a long task, by the browser's own definition. */
export const LONG_TASK_MS = 50;

/** The nearest-rank percentile: the smallest value with at least this share of the values at or under it. */
export function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((share / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

/** Typical is the median; the worst 5% starts at the 95th percentile. */
export interface Spread {
  readonly count: number;
  readonly typicalMs: number | null;
  readonly worstMs: number | null;
}

interface Timed {
  readonly at: number;
  readonly ms: number;
}

function spreadOf(kept: readonly Timed[]): Spread {
  const values = kept.map((one) => one.ms);
  return { count: values.length, typicalMs: percentile(values, 50), worstMs: percentile(values, 95) };
}

function within(kept: readonly Timed[], now: number): Timed[] {
  return kept.filter((one) => one.at >= now - WINDOW_MS);
}

export interface FrameProbe {
  /** An animation frame began at this time. */
  readonly frame: (at: number) => void;
  /** The tab was hidden: the next frame starts a new run instead of closing a gap. */
  readonly hidden: () => void;
  /** The gaps between frames over the last ten seconds. */
  readonly sample: (now: number) => Spread;
}

export function createFrameProbe(): FrameProbe {
  let last: number | null = null;
  let gaps: Timed[] = [];

  return {
    frame(at) {
      if (last !== null) gaps.push({ at, ms: at - last });
      last = at;
    },
    hidden() {
      last = null;
    },
    sample(now) {
      gaps = within(gaps, now);
      return spreadOf(gaps);
    },
  };
}

export interface DelayProbe {
  /** The page changed the rows at this time. A change not yet shown is given up. */
  readonly changed: (at: number) => void;
  /** New values were written into the table. */
  readonly written: () => void;
  /** An animation frame began: if new values were waiting to be seen, this is when they were. */
  readonly frame: (at: number) => void;
  /** The tab was hidden: whatever was under way is given up. */
  readonly hidden: () => void;
  /** From a change to the frame that showed it, over the last ten seconds. */
  readonly sample: (now: number) => Spread;
}

export function createDelayProbe(): DelayProbe {
  let changedAt: number | null = null;
  let waitingToBeSeen = false;
  let delays: Timed[] = [];

  return {
    changed(at) {
      changedAt = at;
      waitingToBeSeen = false;
    },
    written() {
      if (changedAt !== null) waitingToBeSeen = true;
    },
    frame(at) {
      if (changedAt === null || !waitingToBeSeen) return;
      delays.push({ at, ms: at - changedAt });
      changedAt = null;
      waitingToBeSeen = false;
    },
    hidden() {
      changedAt = null;
      waitingToBeSeen = false;
    },
    sample(now) {
      delays = within(delays, now);
      return spreadOf(delays);
    },
  };
}

export interface LongTasks {
  /** False when this browser cannot report long tasks; the two counts then mean nothing. */
  readonly supported: boolean;
  readonly count: number;
  readonly longestMs: number;
}

export interface LongTaskProbe {
  /** The browser reported a task of this length. */
  readonly task: (at: number, ms: number) => void;
  /** Long tasks over the last ten seconds. */
  readonly sample: (now: number) => LongTasks;
}

export function createLongTaskProbe(supported: boolean): LongTaskProbe {
  let tasks: Timed[] = [];

  return {
    task(at, ms) {
      if (ms >= LONG_TASK_MS) tasks.push({ at, ms });
    },
    sample(now) {
      tasks = within(tasks, now);
      let longestMs = 0;
      for (const one of tasks) if (one.ms > longestMs) longestMs = one.ms;
      return { supported, count: tasks.length, longestMs };
    },
  };
}

// ---------------------------------------------------------------------------- the page

export interface PageSample {
  readonly frames: Spread;
  readonly delay: Spread;
  readonly longTasks: LongTasks;
}

export interface PageWatch {
  /** The page is about to change the rows. */
  readonly changed: () => void;
  readonly sample: () => PageSample;
  readonly stop: () => void;
}

function canReportLongTasks(): boolean {
  return typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask');
}

/**
 * Watches the page around one table. New values are known to have been
 * written when the text inside the table changes; a cell that only flashes
 * changes its classes, not its text, and is not taken for a new value.
 */
export function watchPage(table: HTMLElement): PageWatch {
  const frames = createFrameProbe();
  const delay = createDelayProbe();
  const supported = canReportLongTasks();
  const longTasks = createLongTaskProbe(supported);

  let frameRequest = 0;
  const onFrame = (at: number): void => {
    frames.frame(at);
    delay.frame(at);
    frameRequest = window.requestAnimationFrame(onFrame);
  };
  frameRequest = window.requestAnimationFrame(onFrame);

  const texts = new MutationObserver(() => {
    delay.written();
  });
  texts.observe(table, { subtree: true, childList: true, characterData: true });

  const tasks = supported
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.task(entry.startTime + entry.duration, entry.duration);
      })
    : null;
  tasks?.observe({ type: 'longtask' });

  const onVisibility = (): void => {
    if (document.visibilityState !== 'hidden') return;
    frames.hidden();
    delay.hidden();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    changed() {
      if (document.visibilityState !== 'hidden') delay.changed(performance.now());
    },
    sample() {
      const now = performance.now();
      return { frames: frames.sample(now), delay: delay.sample(now), longTasks: longTasks.sample(now) };
    },
    stop() {
      window.cancelAnimationFrame(frameRequest);
      texts.disconnect();
      tasks?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
