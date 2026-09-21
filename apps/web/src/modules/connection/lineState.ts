import type { ConnectionPhase } from './ports';

/**
 * The line as a form or a status strip cares about it: may the player act,
 * are the numbers merely old, or is there no line at all. The same three
 * words the order ticket and the desk pieces use, under this block's own
 * name, because a block imports no other block.
 */
export type ConnectionLine = 'live' | 'stale' | 'offline';

/**
 * The one mapping from where the connection stands to the line state. The
 * table is in `ports.ts` under `ConnectionPhase`; this is that table.
 *
 * `resumed` is `stale` on purpose: the first frame after a reconnect is on
 * screen, so the numbers show, but commands still unanswered are being
 * settled and perhaps resent, and a new order must not race them. Buying
 * opens again with the next message.
 */
export function lineStateOf(phase: ConnectionPhase): ConnectionLine {
  switch (phase) {
    case 'live':
      return 'live';
    case 'stale':
    case 'resumed':
      return 'stale';
    case 'connecting':
    case 'reconnecting':
    case 'closed':
      return 'offline';
  }
}
