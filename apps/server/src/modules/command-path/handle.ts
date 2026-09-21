import { frameFor, handleCommand } from '@strike-desk/shared/engine';
import type { HandleCommand } from './ports';

/**
 * The command path, built on the rules in shared code: apply the command at
 * the step `nowMs` falls in, then project the sender's whole picture of what
 * came out of it, with today's price history and the quote of the draft that
 * connection holds.
 *
 * The session handed back is the one the projection returns, not the one the
 * command returned. Projecting settles the game up to `nowMs`, and a bell that
 * rang between the two would otherwise be paid into a session nobody keeps:
 * the reply would show the money and the next command would not find it.
 *
 * It reads no clock, keeps nothing between calls and changes nothing it was
 * handed. An unknown player id throws: the id comes from the connection, so a
 * wrong one is a fault in the wiring, not something a player did.
 */
export const handle: HandleCommand = (input) => {
  const applied = handleCommand(input.session, input.playerId, input.command, input.nowMs);
  const projected = frameFor(applied.session, input.playerId, input.nowMs, { history: true, sections: 'full', draft: input.draft });
  return {
    session: projected.session,
    reply: { t: 'reply', receipt: applied.receipt, frame: projected.frame },
    repeat: applied.repeat,
  };
};
