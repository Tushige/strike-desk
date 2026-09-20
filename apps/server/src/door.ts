import type { ServerMessage, StartCommand } from '@strike-desk/shared';
import { frameFor, handleCommand, parseClientMessage } from '@strike-desk/shared';
import type { FrameSocket } from './sampler';
import type { SessionRegistry } from './sessions';

/**
 * The door: every inbound message is parsed here and routed from here.
 * Two kinds are taken: `hello`, which makes or resumes a session and leaves
 * its clock stopped, and `start`, which starts it. Everything else is
 * refused by name and never reaches the game rules.
 */

export interface Connection {
  socket: FrameSocket;
  /** Null until a hello has been answered. */
  sessionId: string | null;
}

export interface DoorOptions {
  registry: SessionRegistry;
  /** The same clock the sampler runs on. */
  now: () => number;
}

/** An answer to a message is always sent, even to a socket the sampler would skip. */
function answer(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  connection.socket.send(JSON.stringify(message));
}

function hello(options: DoorOptions, connection: Connection, wantedId: string | undefined): void {
  if (connection.sessionId !== null) {
    answer(connection, { t: 'error', code: 'badMessage' });
    return;
  }
  const known = wantedId === undefined ? undefined : options.registry.get(wantedId);
  const entry = known ?? options.registry.create();
  options.registry.attach(entry.session.id, connection.socket);
  connection.sessionId = entry.session.id;

  const { session, frame } = frameFor(entry.session, options.now(), { history: false, sections: 'live' });
  options.registry.replace(session.id, session);
  answer(connection, frame);
}

/** The one command taken. Its type is the fence: no other command can be handed to the game rules from here. */
function start(options: DoorOptions, connection: Connection, command: StartCommand): void {
  const entry = connection.sessionId === null ? undefined : options.registry.get(connection.sessionId);
  if (entry === undefined) {
    answer(connection, { t: 'error', code: 'noSession', commandId: command.commandId });
    return;
  }
  const nowMs = options.now();
  const handled = handleCommand(entry.session, command, nowMs);
  const { session, frame } = frameFor(handled.session, nowMs, { history: false, sections: 'live' });
  options.registry.replace(session.id, session);
  answer(connection, { t: 'reply', receipt: handled.receipt, frame });
}

export function handleInbound(options: DoorOptions, connection: Connection, text: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    answer(connection, { t: 'error', code: 'badMessage' });
    return;
  }
  const message = parseClientMessage(raw);
  if (message === null) {
    answer(connection, { t: 'error', code: 'badMessage' });
    return;
  }

  switch (message.t) {
    case 'hello':
      // Only the session id is read. The stress board size is not taken here.
      hello(options, connection, message.session);
      return;
    case 'start':
      start(options, connection, message);
      return;
    case 'buy':
    case 'cashOut':
    case 'openBell':
    case 'skipToBell':
    case 'nextDay':
      answer(connection, { t: 'error', code: 'badMessage', commandId: message.commandId });
      return;
  }
}

/** Forget a closed connection. */
export function handleClosed(options: DoorOptions, connection: Connection): void {
  if (connection.sessionId === null) return;
  options.registry.detach(connection.sessionId, connection.socket, options.now());
  connection.sessionId = null;
}
