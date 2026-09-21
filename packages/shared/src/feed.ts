import type { ClientMessage, Hello, ServerMessage } from './protocol';

/**
 * The client's data source, as the rest of the client sees it. A feed owns
 * one connection to one session: it connects, says `hello` (resuming the
 * session it already had, if any), reconnects after a drop and says `hello`
 * again. `hello` is the feed's own business and never appears here.
 *
 * A feed does not remember commands. `send` hands one message to the socket
 * and says whether it did; if the answer does not arrive, the caller sends
 * the same command again with the same `commandId`, and the server answers
 * a repeat with the original receipt. That keeps retry policy in one place,
 * next to the button.
 *
 * What a caller may rely on:
 *
 * 1. Events are delivered in the order they arrived.
 * 2. A message that fails the schema never reaches a listener.
 * 3. A listener that throws never costs another listener its event.
 * 4. `send` never throws.
 */

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/** Everything a caller may send: every client message but `hello`, which the feed sends by itself. */
export type Outbound = Exclude<ClientMessage, Hello>;

export type FeedEvent =
  | { type: 'status'; status: FeedStatus }
  | {
      type: 'message';
      message: ServerMessage;
      /**
       * Milliseconds on the feed's own clock when the text arrived, read
       * before parsing. Only the difference between two readings means
       * anything. The age of the data on screen and the measured processing
       * delay are both taken from it.
       */
      receivedAt: number;
    };

export interface Feed {
  /** Open the connection. Safe to call again after `close`. */
  connect(): void;
  /** Close for good: no reconnect follows. */
  close(): void;
  /**
   * Send one message now. `true` when the text was handed to an open socket,
   * `false` when it was not sent at all. `true` is not a promise that the
   * server received it: only a receipt is.
   */
  send(message: Outbound): boolean;
  /**
   * Cut the line exactly as the network would: the feed behaves as if its
   * socket had closed by itself (status `reconnecting`, a retry after the
   * usual wait, the session remembered). Does nothing unless the feed is
   * live. It exists for the hidden developer control and for tests, and it
   * sends nothing to the server.
   */
  simulateDrop(): void;
  /** Listen to status changes and server messages. Returns the unsubscribe function. */
  subscribe(listener: (event: FeedEvent) => void): () => void;
}
