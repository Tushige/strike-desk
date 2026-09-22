import type { Pace } from '@strike-desk/shared/time';
import { connection, newCommandId } from '../boot';
import type { CommandOutcome } from '../modules/connection/index';

/**
 * The clock commands a screen can send. Each one gets a fresh id here and
 * goes through the connection, which answers with how it ended; a resend
 * reuses the id, so pressing twice can never act twice.
 *
 * Buying and cashing out are not here: the order ticket builds those
 * commands itself, from the quote it is showing.
 */

export function startGame(pace: Pace): Promise<CommandOutcome> {
  return connection.submit({ t: 'start', commandId: newCommandId(), pace });
}

export function ringOpeningBell(day: number): Promise<CommandOutcome> {
  return connection.submit({ t: 'openBell', commandId: newCommandId(), day });
}

export function skipToClosingBell(day: number): Promise<CommandOutcome> {
  return connection.submit({ t: 'skipToBell', commandId: newCommandId(), day });
}

export function goToNextDay(day: number): Promise<CommandOutcome> {
  return connection.submit({ t: 'nextDay', commandId: newCommandId(), day });
}
