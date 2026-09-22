import type { Side } from '@strike-desk/shared/protocol';
import type { Pace } from '@strike-desk/shared/time';
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

const START_WORDS: Record<Pace, string> = {
  1: 'Start at normal speed',
  3: 'Start fast (3x)',
  7.5: 'Start turbo (7.5x)',
};

export const lobbyWords = {
  heading: 'Ready for the opening bell?',
  body: (days: number): string => `${days === 5 ? 'Five' : String(days)} trading days. Read the news, follow prices, and explore tickets.`,
  paceHint: 'Pick a speed to start. The rules are the same at every speed.',
  start: (pace: Pace): string => START_WORDS[pace],
} as const;

export const preBellWords = {
  heading: (day: number): string => `Day ${String(day)}: before the bell`,
  body: 'Read the news and explore tickets. Prices stand still until the opening bell.',
  action: 'Ring the opening bell',
} as const;

export const openWords = {
  heading: (day: number): string => `Day ${String(day)}: the market is open`,
  body: 'Prices are moving. Compare tickets and explore what they could pay.',
  action: 'Skip to the closing bell',
} as const;

export const debriefWords = {
  heading: (day: number): string => `Day ${String(day)}: closing bell`,
  /** Shown until the day's result arrives. */
  waiting: 'Counting up the day…',
  startLabel: 'Started the day with',
  endLabel: 'Ended the day with',
  changeLabel: 'Change today',
  upDay: 'Nice move!',
  downDay: 'Tough day. It happens.',
  flatDay: 'A quiet day.',
  nextDay: (day: number): string => `Go to day ${String(day)}`,
  lastDay: 'See your final result',
} as const;

export const finalWords = {
  heading: 'That was the final bell!',
  finalLabel: 'You finished with',
  changeLabel: 'Since the start',
  daysCaption: 'Day by day',
  dayColumn: 'Day',
  startColumn: 'Started with',
  endColumn: 'Ended with',
  changeColumn: 'Change',
  /** Kid term first; the real term follows in the hint. */
  marketLabel: 'Market number',
  marketHint: 'This number recreates the exact same market. Traders call it a seed.',
  action: 'Play again',
} as const;

export const stripWords = {
  /** The list's accessible name, for the page that lays the strip out. */
  label: 'Companies',
} as const;

export const controlWords = {
  preview: 'Ticket preview only. Buying and cashing out are not available.',
  checking: 'Checking...',
  retry: 'Retry safely',
  retryHint: 'Send the same request again. It will not happen twice.',
} as const;
