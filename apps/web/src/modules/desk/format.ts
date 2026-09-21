import { STEP_MS } from '@strike-desk/shared/time';
import type { Pace } from '@strike-desk/shared/time';

/**
 * Turning what a frame says into text. Nothing here reads a clock or runs a
 * timer: the same steps and pace always give the same text.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/**
 * The real time a phase has left, as minutes and seconds. A step is a fixed
 * slice of game time and a game runs `pace` times faster than a wall clock,
 * so 300 steps are a minute at pace 1 and twenty seconds at pace 3. A part of
 * a second counts as a whole one, so the text reaches 0:00 only when no step
 * is left. Empty before a pace is chosen: there is no clock to show yet.
 */
export function timeLeftText(stepsLeft: number, pace: Pace | null): string {
  if (pace === null) return '';
  const seconds = Math.ceil((Math.max(0, stepsLeft) * STEP_MS) / pace / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}
