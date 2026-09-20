/**
 * Time is an input. A game is 4,500 logical steps (five days of 900); what
 * phase it is, which price is showing and how long is left are all pure
 * functions of the step. Wall-clock milliseconds become a step in exactly
 * one place: `stepAt`.
 */

/** Game time covered by one logical step. One step is one sample at 1x pace. */
export const STEP_MS = 200;
export const DAYS = 5;
export const PRE_BELL_STEPS = 300;
export const OPEN_STEPS = 500;
export const DEBRIEF_STEPS = 100;
export const DAY_STEPS = PRE_BELL_STEPS + OPEN_STEPS + DEBRIEF_STEPS;
export const GAME_STEPS = DAYS * DAY_STEPS;
/** Step within a day at which the closing bell rings. */
export const BELL_STEP_IN_DAY = PRE_BELL_STEPS + OPEN_STEPS;

export const PACES = [1, 3, 7.5] as const;
export type Pace = (typeof PACES)[number];

export type Phase = 'lobby' | 'preBell' | 'open' | 'debrief' | 'final';

export interface Moment {
  phase: Exclude<Phase, 'lobby'>;
  /** 1 to 5. Stays 5 in `final`. */
  day: number;
  /** Steps until the phase ends by itself. 0 in `final`. */
  stepsLeft: number;
  /**
   * Which point of the day's price path is showing: 0 before the bell (the
   * opening price), 1 to 499 while open, 500 from the closing bell on.
   */
  priceIndex: number;
}

/** Where a started game is at a step. */
export function momentAt(step: number): Moment {
  if (step >= GAME_STEPS) {
    return { phase: 'final', day: DAYS, stepsLeft: 0, priceIndex: OPEN_STEPS };
  }
  const safe = Math.max(0, Math.floor(step));
  const day = Math.floor(safe / DAY_STEPS) + 1;
  const inDay = safe % DAY_STEPS;
  if (inDay < PRE_BELL_STEPS) {
    return { phase: 'preBell', day, stepsLeft: PRE_BELL_STEPS - inDay, priceIndex: 0 };
  }
  if (inDay < BELL_STEP_IN_DAY) {
    return { phase: 'open', day, stepsLeft: BELL_STEP_IN_DAY - inDay, priceIndex: inDay - PRE_BELL_STEPS };
  }
  return { phase: 'debrief', day, stepsLeft: DAY_STEPS - inDay, priceIndex: OPEN_STEPS };
}

/** First step of a day (1-based). */
export function dayStartStep(day: number): number {
  return (day - 1) * DAY_STEPS;
}

/** The step at which a day's closing bell rings. */
export function bellStep(day: number): number {
  return dayStartStep(day) + BELL_STEP_IN_DAY;
}

/** Where each clock command jumps to from a step, or null when it does not apply there. */
export function jumpTarget(kind: 'openBell' | 'skipToBell' | 'nextDay', step: number): number | null {
  const moment = momentAt(step);
  if (kind === 'openBell') {
    return moment.phase === 'preBell' ? dayStartStep(moment.day) + PRE_BELL_STEPS : null;
  }
  if (kind === 'skipToBell') {
    return moment.phase === 'open' ? bellStep(moment.day) : null;
  }
  return moment.phase === 'debrief' ? dayStartStep(moment.day + 1) : null;
}

/**
 * The wall-clock half of a running session: at `anchorMs` the game was at
 * `anchorStep`, and it advances `pace` times faster than real time. A jump
 * (early bell, skip, next day) just re-anchors.
 */
export interface ClockState {
  pace: Pace;
  anchorMs: number;
  anchorStep: number;
}

/** The only place wall-clock milliseconds become a logical step. */
export function stepAt(clock: ClockState, nowMs: number): number {
  const elapsedMs = Math.max(0, nowMs - clock.anchorMs);
  const step = clock.anchorStep + Math.floor((elapsedMs * clock.pace) / STEP_MS);
  return Math.min(step, GAME_STEPS);
}

/**
 * Real milliseconds between samples of the market. The server samples five
 * times a second at every pace; a faster pace covers more steps per sample.
 */
export const SAMPLE_INTERVAL_MS = 200;
