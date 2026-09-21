import { frameFor, handleCommand } from '@strike-desk/shared/engine';
import type { HandleCommand } from '../src/modules/command-path/index';
import { describeCommandPathContract } from './contracts/commandPath.contract';

/**
 * The rules that already exist in shared code, put into the command path's
 * shape: apply the command, then project the player's whole picture of what
 * came out of it. `frameFor` settles the game up to `nowMs` and hands that
 * session back, so its session is the one returned; dropping it would lose a
 * settlement.
 */
const handle: HandleCommand = (input) => {
  const applied = handleCommand(input.session, input.playerId, input.command, input.nowMs);
  const projected = frameFor(applied.session, input.playerId, input.nowMs, { history: true, sections: 'full', draft: input.draft });
  return { session: projected.session, reply: { t: 'reply', receipt: applied.receipt, frame: projected.frame }, repeat: applied.repeat };
};

describeCommandPathContract('the rules in shared code', handle);
