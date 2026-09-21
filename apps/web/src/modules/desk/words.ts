import type { GamePhase, LineState, Trend } from './ports';

/**
 * Every string a player can read or hear from the desk pieces, in one place,
 * grouped by piece. Nothing else in this block holds a word a player meets.
 *
 * The voice is the game's: short, warm and plain, the kid's word first and
 * the real term second. A string here never says whether a headline was
 * true, except the two outcome lines, which a card shows only when it is
 * handed an outcome.
 */

const PHASE_NAMES: Record<GamePhase, string> = {
  lobby: 'Getting ready',
  preBell: 'Before the bell',
  open: 'Market open',
  debrief: 'Closing bell',
  final: 'Game over',
};

const LINE_WORDS: Record<LineState, string> = {
  live: 'Connected',
  stale: 'Waiting for new prices',
  offline: 'Connection lost',
};

const TREND_WORDS: Record<Trend, string> = {
  up: 'Up today',
  down: 'Down today',
  flat: 'Flat today',
};

export const topBarWords = {
  worthLabel: 'Total worth',
  cashLabel: 'Cash',
  timeLabel: 'Time left',
  /** Shown beside the line's words whenever the line is not live. */
  oldNumbers: 'These numbers may be old.',
  dayOf: (day: number, days: number): string => `Day ${String(day)} of ${String(days)}`,
  phase: (phase: GamePhase): string => PHASE_NAMES[phase],
  line: (line: LineState): string => LINE_WORDS[line],
} as const;

export const chipWords = {
  noPrice: 'No price yet',
  news: 'News',
  trend: (trend: Trend): string => TREND_WORDS[trend],
} as const;

export const stripWords = {
  /** The list's accessible name, for the page that lays the strip out. */
  label: 'Companies',
} as const;
