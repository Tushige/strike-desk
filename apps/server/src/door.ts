import type { Hello, ServerMessage, StartCommand } from '@strike-desk/shared/engine';
import { FIRST_PLAYER_ID, PROTOCOL_VERSION, frameFor, handleCommand, parseClientMessage } from '@strike-desk/shared/engine';
import type { TokenBucket, WindowCounter } from './limits';
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
  /**
   * The player this connection acts and watches as. Null until a hello has
   * been answered. Set here from the session, never taken from a message: no
   * message carries a player id.
   */
  playerId: string | null;
  /** This socket's own message budget. One chatty socket cannot spend another's. */
  messages: WindowCounter;
}

export interface DoorOptions {
  registry: SessionRegistry;
  /** The same clock the sampler runs on. */
  now: () => number;
  /** One budget for the whole service, spent only when a new game is about to be built. */
  newSessions: TokenBucket;
}

/** An answer to a message is always sent, even to a socket the sampler would skip. */
function answer(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  connection.socket.send(JSON.stringify(message));
}

/**
 * Every hello gets an explicit answer, decided in this order. A refusal makes
 * no session, and an error is always sent before the frame that follows it.
 */
function hello(options: DoorOptions, connection: Connection, message: Hello): void {
  if (connection.sessionId !== null) {
    answer(connection, { t: 'error', code: 'badMessage' });
    return;
  }
  // Compared here, not in the schema, so that another version can be told
  // what is wrong instead of being refused as unreadable.
  if (message.v !== PROTOCOL_VERSION) {
    answer(connection, { t: 'error', code: 'versionMismatch' });
    return;
  }
  // The stress board size is not taken by this service: refused, not ignored,
  // so no client can come to rely on sending it.
  if (message.board !== undefined) {
    answer(connection, { t: 'error', code: 'badMessage' });
    return;
  }

  const known = message.session === undefined ? undefined : options.registry.get(message.session);
  if (message.session !== undefined && known === undefined) {
    // The named game is gone. Say so first, then carry on with a new one, so
    // the client never mistakes the new game's frame for the old game.
    answer(connection, { t: 'error', code: 'noSession' });
  }
  // Rejoining a game costs nothing: only building a new one is budgeted, and
  // only the service's own budget can refuse it.
  if (known === undefined && !options.newSessions.take(options.now())) {
    answer(connection, { t: 'error', code: 'serverFull' });
    return;
  }
  const entry = known ?? options.registry.create(options.now());
  if (entry === null) {
    // Every session the service may hold is in use. This hello gets nothing;
    // nobody already playing is disturbed.
    answer(connection, { t: 'error', code: 'serverFull' });
    return;
  }
  // A session has exactly one player, and every connection to it is that player.
  const playerId = FIRST_PLAYER_ID;
  const attached = options.registry.attach(entry.session.id, playerId, connection.socket);
  if (attached !== 'attached') {
    // Too many tabs on one game. The tabs already on it keep it; this one is
    // simply not added.
    answer(connection, { t: 'error', code: attached === 'noSession' ? 'noSession' : 'serverFull' });
    return;
  }
  connection.sessionId = entry.session.id;
  connection.playerId = playerId;

  const { session, frame } = frameFor(entry.session, playerId, options.now(), { history: false, sections: 'live' });
  options.registry.replace(session.id, session);
  answer(connection, frame);
}

/** The one command taken. Its type is the fence: no other command can be handed to the game rules from here. */
function start(options: DoorOptions, connection: Connection, command: StartCommand): void {
  const entry = connection.sessionId === null ? undefined : options.registry.get(connection.sessionId);
  const playerId = connection.playerId;
  if (entry === undefined || playerId === null) {
    answer(connection, { t: 'error', code: 'noSession', commandId: command.commandId });
    return;
  }
  const nowMs = options.now();
  const handled = handleCommand(entry.session, playerId, command, nowMs);
  const { session, frame } = frameFor(handled.session, playerId, nowMs, { history: false, sections: 'live' });
  options.registry.replace(session.id, session);
  answer(connection, { t: 'reply', receipt: handled.receipt, frame });
}

export function handleInbound(options: DoorOptions, connection: Connection, text: string): void {
  // Counted before the text is even read, so a script cannot make the service
  // parse for it. A page sends two messages in a whole game.
  if (!connection.messages.hit(options.now())) {
    answer(connection, { t: 'error', code: 'tooManyCommands' });
    return;
  }

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
      hello(options, connection, message);
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
  connection.playerId = null;
}
