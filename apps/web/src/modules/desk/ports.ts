import type { ReactNode } from 'react';
import type { Side } from '@strike-desk/shared/protocol';
import type { Pace } from '@strike-desk/shared/time';

/**
 * The desk pieces: the top bar, the company mark, the company chip and strip,
 * the news card, the reveal banner and the screens by game phase. This file
 * is their whole public face.
 *
 * Every piece is plain props in and callbacks out: no store, no socket, and
 * no command is built here. Every money amount arrives as a number the server
 * sent and is only formatted. No string a player reads is fixed by these
 * types.
 *
 * What is deliberately absent, and why:
 * - The lesson sentence and the "if you had held on" comparison: they belong
 *   to the debrief's own content, which is passed as `children`.
 * - Sound and animation options: no screen of ours sets them.
 * - Illustrated art: generated marks carry the first release.
 */

export type LineState = 'live' | 'stale' | 'offline';

export type Trend = 'up' | 'down' | 'flat';

export type GamePhase = 'lobby' | 'preBell' | 'open' | 'debrief' | 'final';

export interface TopBarProps {
  /** Cash plus what the open ticket would sell for now, as the server sent it: the big number. */
  readonly worthCents: number;
  /** Shown smaller, beside the worth. */
  readonly cashCents: number;
  /** 1 to 5; 0 in the lobby. */
  readonly day: number;
  readonly phase: GamePhase;
  /**
   * With `pace`, lets the bar show the time left. Turning steps into seconds
   * is formatting time. The bar runs no timer of its own: it shows what the
   * last frame said.
   */
  readonly stepsLeft: number;
  readonly pace: Pace | null;
  /** The state of the connection, always visible. */
  readonly line: LineState;
}

export interface CompanyMarkProps {
  /** 0 to 5: it picks the tile colour and the glyph, from the design tokens only. */
  readonly companyId: number;
  readonly ticker: string;
  readonly size: 'sm' | 'md';
}

export interface CompanyChipProps {
  readonly companyId: number;
  readonly ticker: string;
  readonly name: string;
  /** Null until the first price. */
  readonly priceCents: number | null;
  /**
   * Against the day's open, by comparing. No percentage and no change amount
   * is shown, because the server sends none.
   */
  readonly trend: Trend;
  readonly hasNews: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/**
 * The strip is a layout. The page gives each chip its own price subscription,
 * so the strip never redraws for a price.
 */
export interface CompanyStripProps {
  /** The list's accessible name. */
  readonly label: string;
  /** The chips. */
  readonly children: ReactNode;
}

export interface NewsCardProps {
  readonly companyId: number;
  readonly companyName: string;
  readonly ticker: string;
  readonly trust: 1 | 2 | 3;
  readonly source: string;
  readonly title: string;
  readonly body: string;
  /** What the headline claims. It says nothing about whether the claim is true. */
  readonly direction: Side;
  readonly revealed: boolean;
  /**
   * Present only from the day's closing bell on, and only if the game passes
   * it on. Without it the card says nothing about whether the news was true.
   */
  readonly outcome?: 'true' | 'false';
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/**
 * These props cannot say whether the news was true, on purpose: they hold a
 * company's name and nothing else. The banner's words are the brief's.
 */
export interface RevealBannerProps {
  /** Null: no banner. */
  readonly companyName: string | null;
}

/** One finished day, every number as the server sent it. */
export interface DaySummary {
  readonly day: number;
  readonly startCents: number;
  readonly endCents: number;
  readonly changeCents: number;
}

/**
 * The screen for the game's phase, told apart by `phase`. `canStart` and
 * `canAct` are false while the line is not live or a command of that kind is
 * waiting for its answer. `children` is the desk the game assembles for that
 * phase (news, chart, ticket); the screen lays it out on one screen with no
 * page scroll.
 */
export type PhaseScreenProps =
  | {
      readonly phase: 'lobby';
      readonly instruction?: string;
      readonly paces: readonly Pace[];
      readonly canStart: boolean;
      readonly onStart: (pace: Pace) => void;
    }
  | {
      readonly phase: 'preBell';
      readonly instruction?: string;
      readonly day: number;
      readonly canAct: boolean;
      readonly onOpenBell: () => void;
      readonly children: ReactNode;
    }
  | {
      readonly phase: 'open';
      readonly instruction?: string;
      readonly day: number;
      readonly canAct: boolean;
      readonly onSkipToBell: () => void;
      readonly children: ReactNode;
    }
  | {
      readonly phase: 'debrief';
      readonly day: number;
      /** Null until the day's result has arrived. */
      readonly result: DaySummary | null;
      readonly canAct: boolean;
      readonly onNextDay: () => void;
      readonly children: ReactNode;
    }
  | {
      readonly phase: 'final';
      readonly finalCents: number;
      readonly changeCents: number;
      /** The market number, shown only here. */
      readonly marketCode: string;
      readonly days: readonly DaySummary[];
      readonly onPlayAgain: () => void;
    };

/** What one moment of a game gives all the pieces. Stand-in sources and the contract suite use it. */
export interface DeskProps {
  readonly topBar: TopBarProps;
  readonly chips: readonly CompanyChipProps[];
  readonly news: readonly NewsCardProps[];
  readonly banner: RevealBannerProps;
  readonly screen: PhaseScreenProps;
}
