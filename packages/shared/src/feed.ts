import type { Command, ServerMessage } from './protocol';

/**
 * The client's data source, as the rest of the client sees it. A feed owns
 * one connection to one session: it connects, says `hello` (resuming the
 * session it already had, if any), reconnects after a drop and says `hello`
 * again. `hello` is the feed's own business and never appears here.
 *
 * A feed does not remember commands. `send` is fire-and-forget: if the
 * answer does not arrive, the caller sends the same command again with the
 * same `commandId`, and the server answers a repeat with the original
 * receipt. That keeps retry policy in one place, next to the button.
 *
 * Messages arrive already parsed and schema-checked; anything that fails
 * the schema is dropped by the feed.
 */

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export type FeedEvent = { type: 'status'; status: FeedStatus } | { type: 'message'; message: ServerMessage };

export interface Feed {
  /** Open the connection. Safe to call again after `close`. */
  connect(): void;
  /** Close for good: no reconnect follows. */
  close(): void;
  /** Send one command now. Dropped silently when the feed is not `live`. */
  send(command: Command): void;
  /** Listen to status changes and server messages. Returns the unsubscribe function. */
  subscribe(listener: (event: FeedEvent) => void): () => void;
}
