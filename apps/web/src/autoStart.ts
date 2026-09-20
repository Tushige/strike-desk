import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import type { Pace } from '@strike-desk/shared/time';
import type { Feed } from '@strike-desk/shared/feed';

/**
 * Saying hello only creates or resumes a game; its clock stays stopped
 * until an explicit start command names the pace. The page has no button
 * to press, so it starts the game itself the first time it sees a game
 * still in the lobby.
 *
 * One command id per session, kept and reused: the server answers a
 * repeated id with the original receipt, so a resend after the connection
 * comes back is harmless and can never start two games. This file imports
 * no React.
 */

export interface AutoStartOptions {
  pace: Pace;
  /** Makes a command id of 8 to 64 characters. */
  makeId: () => string;
}

function frameOf(message: ServerMessage): Frame | null {
  if (message.t === 'frame') return message;
  if (message.t === 'reply') return message.frame;
  return null;
}

export function autoStart(feed: Feed, options: AutoStartOptions): () => void {
  let sessionId: string | null = null;
  let commandId: string | null = null;
  let sentSinceLive = false;

  return feed.subscribe((event) => {
    if (event.type === 'status') {
      // A fresh connection is the one moment a resend is worth making.
      if (event.status === 'live') sentSinceLive = false;
      return;
    }

    const frame = frameOf(event.message);
    if (frame === null || frame.clock.phase !== 'lobby') return;

    if (frame.session !== sessionId) {
      sessionId = frame.session;
      commandId = options.makeId();
      sentSinceLive = false;
    }
    if (sentSinceLive || commandId === null) return;

    sentSinceLive = true;
    feed.send({ t: 'start', commandId, pace: options.pace });
  });
}
