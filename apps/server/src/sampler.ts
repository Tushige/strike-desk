import { liveNewsFrameFor, withDraft } from './liveNewsFrame';
import type { Frame, QuotesMessage } from '@strike-desk/shared/engine';
import type { SessionRegistry, StressStream } from './sessions';

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
 * Offer one sampled message to one socket. A socket that has not finished
 * sending the last thing it was given is skipped, and nothing is ever queued
 * for a slow reader: every frame is the whole picture, so the next one makes
 * up for it. With the stress setting on, where a skipped message may have been
 * a difference rather than the whole picture, it is the periodic whole frame
 * that makes up for it instead.
 */
export function offerFrame(socket: FrameSocket, text: string): 'sent' | 'skipped' | 'closed' {
  if (socket.readyState !== socket.OPEN) return 'closed';
  if (socket.bufferedAmount > 0) return 'skipped';
  socket.send(text);
  return 'sent';
}

/** The four ticket-price arrays a frame carries, which are what a batch is a difference of. */
interface QuoteArrays {
  quotes: readonly number[];
  quoteReals: readonly number[];
  quoteHopes: readonly number[];
  quoteBreakEvens: readonly number[];
}

/**
 * Every ticket whose price, real value, hope value or break-even differs
 * between what was last sent and this frame, as the wire's five-number tuple.
 * A ticket the previous arrays never held counts as changed, so a board that
 * grew is carried in full.
 *
 * Pure: no clock, no socket, no session.
 */
export function quoteChangesBetween(previous: QuoteArrays, frame: QuoteArrays): QuotesMessage['changes'] {
  const changes: QuotesMessage['changes'] = [];
  for (let id = 0; id < frame.quotes.length; id += 1) {
    const priceCents = frame.quotes[id] ?? 0;
    const realCents = frame.quoteReals[id] ?? 0;
    const hopeCents = frame.quoteHopes[id] ?? 0;
    const breakEvenCents = frame.quoteBreakEvens[id] ?? 0;
    if (
      id < previous.quotes.length &&
      priceCents === previous.quotes[id] &&
      realCents === previous.quoteReals[id] &&
      hopeCents === previous.quoteHopes[id] &&
      breakEvenCents === previous.quoteBreakEvens[id]
    ) {
      continue;
    }
    changes.push([id, priceCents, realCents, hopeCents, breakEvenCents]);
  }
  return changes;
}

/**
 * Whether this pass owes the client the whole picture rather than a difference.
 *
 * Every reason but the last is a thing a batch cannot carry and the brief
 * never lets a client miss (section 8.3 rule 3):
 *
 * - The game has not started. Guarded on the phase by name rather than on the
 *   lobby's quote list happening to be empty: a lobby frame's day is 0, and a
 *   batch's day is bounded 1 to 5 by this service's own wire contract, so a
 *   batch here would be a message the contract refuses.
 * - The day changed, and a batch belongs to one day's board.
 * - The phase changed. Not an optimisation: whether a ticket is dimmed as too
 *   cheap to trade depends on the market being open, so without this every
 *   row's dimmed state would be wrong for up to a whole cadence after a bell.
 *   A switched-on session holds no position, so a phase move bumps no revision
 *   and would otherwise pass unannounced.
 * - The revision changed. A receipt or a settlement moves it, and a batch that
 *   carried the new revision without the account behind it would leave the
 *   page holding a newer ordering triple than the picture it shows.
 */
function wholeFrameDue(stream: StressStream, frame: Frame, nowMs: number, stressFullFrameMs: number): boolean {
  if (frame.clock.phase === 'lobby') return true;
  if (frame.clock.day !== stream.day) return true;
  if (frame.clock.phase !== stream.phase) return true;
  if (frame.rev !== stream.rev) return true;
  return nowMs - stream.lastWholeFrameMs >= stressFullFrameMs;
}

/** What a switched-on session sends this pass, and what it then holds as sent. Null text means nothing to send. */
function stressSample(
  stream: StressStream | null,
  frame: Frame,
  nowMs: number,
  stressFullFrameMs: number,
): { text: string | null; stream: StressStream; whole: boolean } {
  const sent = {
    quotes: frame.quotes,
    quoteReals: frame.quoteReals,
    quoteHopes: frame.quoteHopes,
    quoteBreakEvens: frame.quoteBreakEvens,
    day: frame.clock.day,
    phase: frame.clock.phase,
    rev: frame.rev,
  };

  // Read before the stream is replaced: a trigger judged against what this
  // pass is about to send could never fire. A null stream is the first pass of
  // this session, where there is nothing to send a difference against.
  if (stream === null || wholeFrameDue(stream, frame, nowMs, stressFullFrameMs)) {
    return { text: JSON.stringify(frame), stream: { ...sent, lastWholeFrameMs: nowMs }, whole: true };
  }

  const changes = quoteChangesBetween(stream, frame);
  // An unchanged board must not cost five messages a second.
  if (changes.length === 0) return { text: null, stream, whole: false };
  const message: QuotesMessage = {
    t: 'quotes',
    session: frame.session,
    rev: frame.rev,
    step: frame.step,
    day: frame.clock.day,
    priceIndex: frame.clock.priceIndex,
    prices: frame.prices,
    changes,
  };
  return { text: JSON.stringify(message), stream: { ...sent, lastWholeFrameMs: stream.lastWholeFrameMs }, whole: false };
}

/**
 * One sampling pass over every session somebody is watching. What a frame
 * holds depends only on the session, the player it is for and `nowMs`, and
 * turning `nowMs` into a step is the shared code's business: nothing here does
 * arithmetic on time. A session is advanced once a pass, and a frame is
 * projected once per player somebody is watching as. Draftless sockets share
 * its text; a connection's preview decorates only its own whole picture.
 *
 * An ordinary session is sent the whole picture every pass. A switched-on one
 * is sent only the tickets that changed, with the whole picture every
 * `stressFullFrameMs` as the way back into step.
 */
export function sampleSessions(registry: SessionRegistry, nowMs: number, stats: SamplerStats, stressFullFrameMs: number): void {
  for (const entry of registry.entries()) {
    if (entry.sockets.size === 0) continue;
    const samples = new Map<string, { text: string | null; whole: Frame | null }>();
    for (const [socket, playerId] of entry.sockets) {
      let sample = samples.get(playerId);
      if (sample === undefined) {
        // The first of these advances the session; after it `entry.session` is already at this step.
        const { session, frame } = liveNewsFrameFor(entry.session, playerId, nowMs);
        registry.replace(session.id, session);
        if (session.game.stress) {
          const sampled = stressSample(entry.stressStream, frame, nowMs, stressFullFrameMs);
          // Moved on whether or not any socket took it. Every client on a
          // session shares one text, so holding the stream back for one
          // backed-up socket would cost every other client the rest of the
          // batches; the periodic whole picture is that client's way back.
          entry.stressStream = sampled.stream;
          sample = { text: sampled.text, whole: sampled.whole ? frame : null };
        } else {
          sample = { text: JSON.stringify(frame), whole: frame };
        }
        samples.set(playerId, sample);
      }
      let text = sample.text;
      if (text === null) continue;
      const request = entry.drafts.get(socket);
      if (request !== undefined && sample.whole !== null && socket.readyState === socket.OPEN && socket.bufferedAmount === 0) {
        text = JSON.stringify(withDraft(sample.whole, request));
      }
      const outcome = offerFrame(socket, text);
      if (outcome === 'sent') stats.sent += 1;
      else if (outcome === 'skipped') stats.skipped += 1;
    }
  }
}
