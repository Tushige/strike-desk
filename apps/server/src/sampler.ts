import { frameFor } from '@strike-desk/shared/engine';
import type { SessionRegistry } from './sessions';

/** The part of a WebSocket the sampler needs. */
export interface FrameSocket {
  readyState: number;
  OPEN: number;
  /** Bytes handed to the socket and not yet written out. Sees this process's own queue only, not the kernel's or a proxy's. */
  bufferedAmount: number;
  send(text: string): void;
}

export interface SamplerStats {
  sent: number;
  skipped: number;
}

/**
 * Offer one sampled frame to one socket. A socket that has not finished
 * sending the last thing it was given is skipped: every frame is the whole
 * picture, so the next one makes up for it, and nothing is ever queued for a
 * slow reader.
 */
export function offerFrame(socket: FrameSocket, text: string): 'sent' | 'skipped' | 'closed' {
  if (socket.readyState !== socket.OPEN) return 'closed';
  if (socket.bufferedAmount > 0) return 'skipped';
  socket.send(text);
  return 'sent';
}

/**
 * One sampling pass over every session somebody is watching. What a frame
 * holds depends only on the session, the player it is for and `nowMs`, and
 * turning `nowMs` into a step is the shared code's business: nothing here does
 * arithmetic on time. A session is advanced once a pass, and a frame is
 * projected and turned into text once per player somebody is watching as,
 * however many sockets that player has.
 */
export function sampleSessions(registry: SessionRegistry, nowMs: number, stats: SamplerStats): void {
  for (const entry of registry.entries()) {
    if (entry.sockets.size === 0) continue;
    const texts = new Map<string, string>();
    for (const [socket, playerId] of entry.sockets) {
      let text = texts.get(playerId);
      if (text === undefined) {
        // The first of these advances the session; after it `entry.session` is already at this step.
        const { session, frame } = frameFor(entry.session, playerId, nowMs, { history: false, sections: 'live' });
        registry.replace(session.id, session);
        text = JSON.stringify(frame);
        texts.set(playerId, text);
      }
      const outcome = offerFrame(socket, text);
      if (outcome === 'sent') stats.sent += 1;
      else if (outcome === 'skipped') stats.skipped += 1;
    }
  }
}
