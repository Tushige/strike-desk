import type { Pace } from '@strike-desk/shared/time';

/**
 * Every string a player reads on the screens, in one place. The voice is the
 * game's: short, warm and plain, the kid's word first and the real term
 * second. Nothing here ever says whether a headline was true before the
 * closing bell.
 */

export const DAYS = 5;

export const PACE_WORDS: Record<Pace, string> = {
  1: '15 min',
  3: '5 min',
  7.5: '2 min',
};

export const TRUST_NAMES: Record<1 | 2 | 3, string> = {
  3: 'Solid news',
  2: 'Could be true',
  1: 'Wild rumor',
};

export const PHASE_WORDS = {
  lobby: 'Getting ready',
  preBell: 'Before the bell',
  open: 'Market open',
  debrief: 'Closing bell',
  final: 'Game over',
} as const;

export const LINE_WORDS = {
  live: 'Connected',
  stale: 'Waiting for new prices',
  offline: 'Reconnecting',
} as const;

export const topBarWords = {
  worth: 'Total worth',
  cash: 'Cash',
  timeLeft: 'Time left',
  lobbyDays: `${String(DAYS)} trading days`,
  allDone: `All ${String(DAYS)} days done`,
  dayOf: (day: number): string => `Day ${String(day)} of ${String(DAYS)}`,
  oldNumbers: 'These numbers may be old.',
} as const;

export const startWords = {
  kicker: 'A trading game with pretend money',
  heading: ['Here is $1,000,000.', 'Grow it or blow it.'],
  lede: 'Five trading days. Fifteen minutes. Read the news, bet on prices going up or down, and decide when to cash out.',
  steps: [
    {
      title: 'Read the news',
      body: 'Six companies, three headlines a day. Some news is solid. Some is just a rumor. The trust dots tell you which.',
    },
    {
      title: 'Buy a ticket',
      body: 'Think the price will climb? Buy an UP ticket. Think it will drop? Buy a DOWN ticket. Then pick a target price.',
    },
    {
      title: 'Beat the bell',
      body: "Your ticket's value moves with the price. Cash out any time, or hold until the closing bell. Miss the target at the bell and the ticket is worth $0.",
    },
  ],
  action: 'Open the desk',
  opening: 'Opening the desk…',
  paceLabel: 'Game length',
  footer:
    'Made-up companies. Pretend money. Real trading ideas. For teachers: an UP ticket is a call option, a DOWN ticket is a put option, the target is the strike price, and the closing bell is expiry.',
  example:
    'Up does not always mean profit: a $100 share and a $300 ticket for a $100 target need the price above $103 before you are ahead. Each ticket represents 100 shares; $103 is the break-even share price.',
  connecting: 'Connecting to the desk…',
  serverFull: 'The desk is full right now. Try again in a minute.',
  gameGone: 'That game is over on the server, so this is a fresh one.',
} as const;

export const finalWords = {
  kicker: 'Final bell',
  finishedWith: 'You finished with',
  more: (amount: string): string => `${amount} more than the $1,000,000 you started with`,
  less: (amount: string): string => `${amount} less than the $1,000,000 you started with`,
  even: 'Exactly the $1,000,000 you started with',
  action: 'Play again',
  daysHeading: 'Your five days',
  lessonsHeading: 'Three things the desk taught you',
  lessons: [
    'News can be wrong. The less sure it is, the bigger the swing.',
    'Far targets are cheap and pay big, but they miss most of the time.',
    'Hope value expires at the bell. It can rise or fall before then.',
  ],
  notPlayed: 'Not played',
  satOut: 'Sat out',
  marketLabel: 'Market number',
  marketHint: 'This number recreates the exact same market. Traders call it a seed.',
} as const;

export interface Rank {
  /** Cents at or above which the rank is earned. */
  minCents: number;
  title: string;
  blurb: string;
}

export const RANKS: readonly Rank[] = [
  { minCents: 300_000_000, title: 'Desk Legend', blurb: 'You more than tripled the desk. Big swings, big nerve.' },
  { minCents: 150_000_000, title: 'Sharp Trader', blurb: 'You grew the desk by half or more. You read the news well and sized your bets.' },
  { minCents: 100_000_000, title: 'Steady Hand', blurb: 'You kept the desk alive and a little ahead. That is harder than it sounds.' },
  { minCents: 50_000_000, title: 'Bruised Rookie', blurb: 'You finished with less than you started. The market took a bite, but you are still standing.' },
  { minCents: -Infinity, title: 'Back to Training', blurb: 'Over half the desk is gone. Every great trader has a day like this. Go again.' },
];

/** The rank a final cash amount earns. Thresholds are copy, not money: the amount itself comes from the server. */
export function rankFor(finalCents: number): Rank {
  return RANKS.find((rank) => finalCents >= rank.minCents) ?? RANKS[RANKS.length - 1]!;
}
