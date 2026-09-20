import type { ServerMessage } from '@strike-desk/shared/protocol';
import { parseServerMessage } from '@strike-desk/shared/protocol';

/**
 * Everything arriving on the socket comes through here. A message the
 * contract does not name — malformed text, a shape from another version,
 * the placeholder tick — becomes null, and nothing here ever throws: a
 * stray byte on the wire must not take the page down.
 */
export function decode(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return parseServerMessage(raw);
}
