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
 * A session owns the hidden market, the clock and the pace, and holds
 * players; a player owns an account. Every command and every frame names the
 * player it is for. A session made here has exactly one player unless a test
 * asks for more: nothing lets a second player join.
 *
 * The wall-clock anchor that turns "now" into a logical step lives here. This
 * is the only layer that sees milliseconds, and it never reads a clock
 * itself: `nowMs` is always passed in. Every function returns a new session
 * and leaves its input alone.
 */

export interface Session {
  id: string;
  market: Market;
  game: GameState;
  /** Null until an accepted `start`: the lobby, where the step stays 0. */
  clock: ClockState | null;
}

export function createSession(id: string, identity: MarketIdentity, options: { targetsPerCompany?: number; playerIds?: readonly string[] } = {}): Session {
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

/** Apply one player's schema-valid command at the step `nowMs` falls in. The clock it may move is the session's, shared by every player. */
export function handleCommand(session: Session, playerId: string, command: Command, nowMs: number): HandledCommand {
  const result = applyCommand(session.market, session.game, playerId, command, sessionStep(session, nowMs));
  if (result.repeat) return { session, receipt: result.receipt, repeat: true };

  let clock = session.clock;
  if (command.t === 'start' && result.receipt.outcome === 'accepted') {
    clock = { pace: command.pace, anchorMs: nowMs, anchorStep: 0 };
  } else if (clock !== null && result.jumpedTo !== undefined) {
    clock = { ...clock, anchorMs: nowMs, anchorStep: result.jumpedTo };
  }
  return { session: { ...session, game: result.game, clock }, receipt: result.receipt, repeat: false };
}

/** Settle every player up to `nowMs`, then project the named player's public frame for that step. */
export function frameFor(session: Session, playerId: string, nowMs: number, options: Pick<ProjectOptions, 'history' | 'sections'>): { session: Session; frame: Frame } {
  const game = advanceTo(session.market, session.game, sessionStep(session, nowMs));
  const next = game === session.game ? session : { ...session, game };
  const frame = projectFrame(next.market, game, playerId, game.step, { session: session.id, history: options.history, sections: options.sections ?? 'full' });
  return { session: next, frame };
}
