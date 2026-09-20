import { describe, expect, it } from 'vitest';
import type { ClockState } from '../src/clock';
import { DAY_STEPS, GAME_STEPS, SAMPLE_INTERVAL_MS, bellStep, dayStartStep, jumpTarget, momentAt, stepAt } from '../src/clock';

describe('momentAt', () => {
  it.each([
    [0, { phase: 'preBell', day: 1, stepsLeft: 300, priceIndex: 0 }],
    [299, { phase: 'preBell', day: 1, stepsLeft: 1, priceIndex: 0 }],
    [300, { phase: 'open', day: 1, stepsLeft: 500, priceIndex: 0 }],
    [301, { phase: 'open', day: 1, stepsLeft: 499, priceIndex: 1 }],
    [799, { phase: 'open', day: 1, stepsLeft: 1, priceIndex: 499 }],
    [800, { phase: 'debrief', day: 1, stepsLeft: 100, priceIndex: 500 }],
    [899, { phase: 'debrief', day: 1, stepsLeft: 1, priceIndex: 500 }],
    [900, { phase: 'preBell', day: 2, stepsLeft: 300, priceIndex: 0 }],
    [4499, { phase: 'debrief', day: 5, stepsLeft: 1, priceIndex: 500 }],
    [4500, { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500 }],
    [99999, { phase: 'final', day: 5, stepsLeft: 0, priceIndex: 500 }],
  ])('step %i', (step, expected) => {
    expect(momentAt(step)).toEqual(expected);
  });

  it('treats a negative step as the start', () => {
    expect(momentAt(-5)).toEqual(momentAt(0));
  });

  it('covers five days of 900 steps', () => {
    expect(DAY_STEPS).toBe(900);
    expect(GAME_STEPS).toBe(4500);
    expect(dayStartStep(3)).toBe(1800);
    expect(bellStep(1)).toBe(800);
    expect(bellStep(5)).toBe(4400);
  });
});

describe('jumpTarget', () => {
  it('opens the bell early only before the bell', () => {
    expect(jumpTarget('openBell', 0)).toBe(300);
    expect(jumpTarget('openBell', 299)).toBe(300);
    expect(jumpTarget('openBell', 950)).toBe(1200);
    expect(jumpTarget('openBell', 300)).toBeNull();
    expect(jumpTarget('openBell', 800)).toBeNull();
    expect(jumpTarget('openBell', 4500)).toBeNull();
  });

  it('skips to the closing bell only while the market is open', () => {
    expect(jumpTarget('skipToBell', 300)).toBe(800);
    expect(jumpTarget('skipToBell', 799)).toBe(800);
    expect(jumpTarget('skipToBell', 1300)).toBe(1700);
    expect(jumpTarget('skipToBell', 299)).toBeNull();
    expect(jumpTarget('skipToBell', 800)).toBeNull();
  });

  it('moves to the next day only from the debrief, and past day 5 to the end', () => {
    expect(jumpTarget('nextDay', 800)).toBe(900);
    expect(jumpTarget('nextDay', 899)).toBe(900);
    expect(jumpTarget('nextDay', 4400)).toBe(GAME_STEPS);
    expect(jumpTarget('nextDay', 799)).toBeNull();
    expect(jumpTarget('nextDay', 900)).toBeNull();
    expect(jumpTarget('nextDay', 4500)).toBeNull();
  });
});

describe('stepAt', () => {
  const at = (pace: ClockState['pace'], elapsedMs: number, anchorStep = 0) =>
    stepAt({ pace, anchorMs: 1_000_000, anchorStep }, 1_000_000 + elapsedMs);

  it('advances one step per 200 ms at pace 1', () => {
    expect(at(1, 0)).toBe(0);
    expect(at(1, 199)).toBe(0);
    expect(at(1, 200)).toBe(1);
    expect(at(1, 180_000)).toBe(900);
  });

  it('advances 3 and 7.5 times faster at the other paces', () => {
    expect(at(3, 200)).toBe(3);
    expect(at(3, 60_000)).toBe(900);
    expect(at(7.5, 200)).toBe(7);
    expect(at(7.5, 400)).toBe(15);
    expect(at(7.5, 24_000)).toBe(900);
  });

  it('continues from the anchor step', () => {
    expect(at(1, 1_000, 800)).toBe(805);
  });

  it('never runs backwards before the anchor and never passes the end', () => {
    expect(at(1, -5_000, 42)).toBe(42);
    expect(at(7.5, 10_000_000)).toBe(GAME_STEPS);
    expect(at(1, 200, GAME_STEPS)).toBe(GAME_STEPS);
  });

  it('samples five times a second', () => {
    expect(SAMPLE_INTERVAL_MS).toBe(200);
  });
});
