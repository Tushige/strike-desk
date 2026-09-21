import { FIRST_PLAYER_ID } from '@strike-desk/shared/engine';
import { LIMITS } from '../src/limits';
import type { FrameSocket } from '../src/sampler';
import { drawSessionId } from '../src/seed';
import { createRegistry } from '../src/sessions';
import { describeSessionSeatsContract } from './contracts/sessionSeats.contract';
import { FIXED_SEEDS } from './harness';

/**
 * The session registry the service runs on, tried against what anything
 * that holds a session's sockets must do.
 */
describeSessionSeatsContract<FrameSocket>('the session registry', () => {
  const registry = createRegistry({
    drawSeed: () => FIXED_SEEDS[0] ?? 0,
    drawId: drawSessionId,
    limits: LIMITS,
  });
  const entry = registry.create(0);
  if (entry === null) throw new Error('the registry made no session');

  return {
    seats: registry,
    sessionId: entry.session.id,
    playerId: FIRST_PLAYER_ID,
    limit: LIMITS.maxSocketsPerSession,
    newSocket: () => ({ readyState: 1, OPEN: 1, bufferedAmount: 0, send: () => undefined }),
  };
});
