import {
  BELL_STEP_IN_DAY,
  CONTENT_VERSION,
  ENGINE_VERSION,
  FIRST_PLAYER_ID,
  PRE_BELL_STEPS,
  STEP_MS,
  contractId,
  createSession,
  frameFor,
  handleCommand,
  isOffered,
} from '@strike-desk/shared/engine';
import type { Frame, Session } from '@strike-desk/shared/engine';

/**
 * A fixed game to stand on: the same session, at a named moment, every time.
 * What a command path is built and tried against instead of a live server.
 *
 * Nothing here reads a clock or draws a number. The seed is fixed, time is a
 * plain number, and command ids come from a counter.
 */

/** The clock reading at which the game's `start` is accepted. */
export const T0 = 1_000_000;

/** The only player a real session has. */
export const PLAYER = FIRST_PLAYER_ID;

/** The market every case plays. */
const SEED = 4242424242;

let issued = 0;

/** A command id nobody has used before. */
export function newId(): string {
  issued += 1;
  return `contract-${String(issued).padStart(6, '0')}`;
}

/** The clock reading at which a game started at `T0`, at pace 1, reaches a step. */
export function msAtStep(step: number): number {
  return T0 + step * STEP_MS;
}

export type Moment = 'lobby' | 'beforeBell' | 'open' | 'lastOpenStep' | 'atBell' | 'debrief';

/** The step of day 1 each named moment stands at. The lobby has no step. */
const STEP_OF: Record<Exclude<Moment, 'lobby'>, number> = {
  beforeBell: 10,
  open: PRE_BELL_STEPS + 100,
  lastOpenStep: BELL_STEP_IN_DAY - 1,
  atBell: BELL_STEP_IN_DAY,
  debrief: BELL_STEP_IN_DAY + 10,
};

/**
 * The fixed session and the clock reading of the named moment. Outside the
 * lobby the game was started at pace 1 at `T0`, and nothing else has happened
 * in it. A board size other than the game's own makes a stress session.
 */
export function sessionAt(moment: Moment, options: { targetsPerCompany?: number } = {}): { session: Session; nowMs: number } {
  const lobby = createSession('contract-session', { seed: SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION }, options);
  if (moment === 'lobby') return { session: lobby, nowMs: T0 };

  const started = handleCommand(lobby, PLAYER, { t: 'start', commandId: newId(), pace: 1 }, T0);
  if (started.receipt.outcome !== 'accepted') throw new Error('the fixed session refused to start');
  return { session: started.session, nowMs: msAtStep(STEP_OF[moment]) };
}

/** The player's whole public picture of a session at a clock reading. The session itself is left alone. */
export function frameAt(session: Session, nowMs: number): Frame {
  return frameFor(session, PLAYER, nowMs, { history: false, sections: 'full' }).frame;
}

/**
 * The ticket a frame offers at exactly this price, lowest contract id first.
 * A case that reasons about a named price asks for one this way, so that it
 * fails loudly if the fixed game no longer has a ticket there, rather than
 * quietly testing something else.
 */
export function quotedAt(frame: Frame, priceCents: number): { contractId: number; priceCents: number } {
  const board = frame.board;
  if (board === null) throw new Error('this frame has no board to pick a ticket from');
  for (let id = 0; id < frame.quotes.length; id += 1) {
    if (frame.quotes[id] === priceCents && isOffered(board, id)) return { contractId: id, priceCents };
  }
  throw new Error(`this frame offers no ticket quoted at ${priceCents}`);
}

/** Close UP of company 0 on a frame's board, with the price the frame shows for it. */
export function closeUp(frame: Frame): { contractId: number; priceCents: number } {
  const board = frame.board;
  const targetIndex = board?.companies[0]?.simpleUp[0];
  if (board === null || targetIndex === undefined) throw new Error('this frame has no board to pick a ticket from');
  const id = contractId(board.targetsPerCompany, { companyId: 0, targetIndex, side: 'up' });
  const priceCents = frame.quotes[id];
  if (priceCents === undefined) throw new Error(`this frame has no price for ticket ${id}`);
  return { contractId: id, priceCents };
}
