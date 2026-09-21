export { createConnection } from './connection';
export { lineStateOf } from './lineState';
export type { ConnectionLine } from './lineState';
export { resendNever, resendWhileFresh } from './policies';
export { STALE_AFTER_MS } from './ports';
export type {
  CommandOutcome,
  Connection,
  ConnectionOptions,
  ConnectionPhase,
  ConnectionState,
  CreateConnection,
  PendingCommand,
  ReadSlice,
  SessionStore,
  SocketLike,
  TransportSeam,
} from './ports';
