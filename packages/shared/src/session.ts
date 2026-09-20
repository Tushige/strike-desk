import type { ClockState } from './clock';
import { stepAt } from './clock';
import type { ProjectOptions } from './frame';
import { projectFrame } from './frame';
import type { GameState } from './game';
import { advanceTo, applyCommand, newGame } from './game';
import type { Market, MarketIdentity } from './market';
import { buildMarket } from './market';
import type { Command, Frame, Receipt } from './protocol';

/**
 * One player's session: the hidden market, the game state and the wall-clock
 * anchor that turns "now" into a logical step. This is the only layer that
 * sees milliseconds, and it never reads a clock itself: `nowMs` is always
 * passed in. Every function returns a new session and leaves its input alone.
 */

export interface Session {
  id: string;
  market: Market;
  game: GameState;
  /** Null until an accepted `start`: the lobby, where the step stays 0. */
  clock: ClockState | null;
}

export function createSession(id: string, identity: MarketIdentity, options: { targetsPerCompany?: number } = {}): Session {
  return { id, market: buildMarket(identity), game: newGame(options), clock: null };
}

/** The session's logical step at a wall-clock time. Never behind what the game has already reached. */
export function sessionStep(session: Session, nowMs: number): number {
  if (session.clock === null) return 0;
  return Math.max(session.game.step, stepAt(session.clock, nowMs));
}

export interface HandledCommand {
  session: Session;
  receipt: Receipt;
  /** True when this commandId had been seen before: nothing changed. */
  repeat: boolean;
}

/** Apply one schema-valid command at the step `nowMs` falls in. */
export function handleCommand(session: Session, command: Command, nowMs: number): HandledCommand {
  const result = applyCommand(session.market, session.game, command, sessionStep(session, nowMs));
  if (result.repeat) return { session, receipt: result.receipt, repeat: true };

  let clock = session.clock;
  if (command.t === 'start' && result.receipt.outcome === 'accepted') {
    clock = { pace: command.pace, anchorMs: nowMs, anchorStep: 0 };
  } else if (clock !== null && result.jumpedTo !== undefined) {
    clock = { ...clock, anchorMs: nowMs, anchorStep: result.jumpedTo };
  }
  return { session: { ...session, game: result.game, clock }, receipt: result.receipt, repeat: false };
}

/** Settle up to `nowMs`, then project the public frame for that step. */
export function frameFor(session: Session, nowMs: number, options: Pick<ProjectOptions, 'history' | 'sections'>): { session: Session; frame: Frame } {
  const game = advanceTo(session.market, session.game, sessionStep(session, nowMs));
  const next = game === session.game ? session : { ...session, game };
  const frame = projectFrame(next.market, game, game.step, { session: session.id, history: options.history, sections: options.sections ?? 'full' });
  return { session: next, frame };
}
