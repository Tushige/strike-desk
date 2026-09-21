import type { Side } from '@strike-desk/shared/protocol';
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

const TRUST_NAMES: Record<1 | 2 | 3, string> = {
  3: 'Solid news',
  2: 'Could be true',
  1: 'Wild rumor',
};

const CLAIMS: Record<Side, string> = {
  up: 'This news says UP',
  down: 'This news says DOWN',
};

export const newsWords = {
  trust: (trust: 1 | 2 | 3): string => TRUST_NAMES[trust],
  /** For a screen reader, in place of the three dots. */
  trustDots: (trust: 1 | 2 | 3): string => `Trust: ${String(trust)} of 3`,
  /** What the headline claims, worded as a claim and not as what will happen. */
  claim: (direction: Side): string => CLAIMS[direction],
  /** The whole of what a card says once its news has landed in the price. */
  newsOut: 'The news is out',
  /** Shown only when the game hands the card an outcome. */
  outcomeTrue: 'This news turned out true.',
  outcomeFalse: 'This news did not come true.',
} as const;

/** The banner names the company and nothing more: it never says whether the news was true. */
export const bannerWords = {
  title: 'Plot twist!',
  body: (companyName: string): string => `The news is out for ${companyName}. Watch the price.`,
} as const;

export const stripWords = {
  /** The list's accessible name, for the page that lays the strip out. */
  label: 'Companies',
} as const;
