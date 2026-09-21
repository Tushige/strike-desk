import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'connection',
  order: 5,
  title: 'Connection and reconnect',
  summary:
    "The connection's states (connecting, live, stale, reconnecting with growing waits, resumed), resending a pending command, and the server's rule for two sockets on one session.",
  builtAgainst: "the feed's transport seam, with a fault hook for tests",
  demo: () => import('./connection.demo'),
};

export default entry;
