/**
 * The rule for when the table holds its order still.
 *
 * A row that moves while someone is about to press it gets the wrong row
 * pressed. So while the pointer is over the table, a touch that began in it
 * is still down, or the focus is inside it, changed values are shown but no
 * row moves or disappears. The order catches up once, when the last of the
 * three has left.
 *
 * Pure: it is told what happened and answers with what that means. It reads
 * no clock and touches no page, so the rule can be tried without a table.
 */

export type SortPauseEvent = 'pointerIn' | 'pointerOut' | 'touchStart' | 'touchEnd' | 'focusIn' | 'focusOut';

export interface SortPauseState {
  /** True while the order must hold still. */
  readonly paused: boolean;
  /** True exactly once: on the event after which nothing holds the order any longer. */
  readonly catchUp: boolean;
}

export interface SortPause {
  readonly on: (event: SortPauseEvent) => SortPauseState;
  /** Where things stand, without anything having happened; never asks for a catch-up. */
  readonly state: () => SortPauseState;
}

export function createSortPause(): SortPause {
  let pointer = false;
  let touch = false;
  let focus = false;

  const paused = (): boolean => pointer || touch || focus;

  return {
    on(event) {
      const before = paused();
      if (event === 'pointerIn') pointer = true;
      else if (event === 'pointerOut') pointer = false;
      else if (event === 'touchStart') touch = true;
      else if (event === 'touchEnd') touch = false;
      else if (event === 'focusIn') focus = true;
      else focus = false;
      const after = paused();
      return { paused: after, catchUp: before && !after };
    },
    state: () => ({ paused: paused(), catchUp: false }),
  };
}
