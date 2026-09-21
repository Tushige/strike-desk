import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import sirv from 'sirv';
import { HEALTH_PATH, SAMPLE_INTERVAL_MS, WS_PATH } from '@strike-desk/shared/engine';
import { PUBLIC_MAX_BOARD_SIZE } from './boardSizes';
import type { Connection } from './door';
import { handleClosed, handleInbound } from './door';
import type { Limits } from './limits';
import { LIMITS, createTokenBucket, createWindowCounter } from './limits';
import { originAllowed } from './origin';
import type { FrameSocket } from './sampler';
import { sampleSessions } from './sampler';
import { drawSeed, drawSessionId } from './seed';
import { createRegistry } from './sessions';

export interface BuildVersion {
  /** First 7 characters of the commit the build was made from. */
  commit: string;
  /** ISO 8601 UTC time of the build, seconds precision, for example 2026-09-20T01:02:03Z. */
  buildTime: string;
}

export interface AppOptions {
  /** Absolute path of the built web files (apps/web/dist). */
  staticDir: string;
  /**
   * Stamped once at build time by scripts/write-version.mjs, never read from
   * the clock or the environment here — a free instance waking from sleep
   * restarts this process without a new build.
   */
  version: BuildVersion;
  /** Milliseconds between heartbeat rounds. Default 20000. 0 makes no timer: `heartbeatOnce` is then called by hand. */
  heartbeatMs?: number;
  /**
   * The clock every session runs on, in milliseconds. It must never go back.
   * Default `performance.now()`. Tests pass one that only moves when told to.
   * Every piece of timekeeping here reads it, the heartbeat included, so one
   * fake clock drives the whole service.
   */
  now?: () => number;
  /** Milliseconds between sampling passes. Default SAMPLE_INTERVAL_MS. 0 makes no timer: `sampleOnce` is then called by hand. */
  sampleMs?: number;
  /** Draws a new game's seed. Default: the crypto source. Tests pass fixed seeds. */
  drawSeed?: () => number;
  /**
   * Honour the `probe` query value on the socket path. Default false: every
   * connection is then an ordinary one, whatever it asks for. The measurement
   * modes exist for one unfinished host measurement, not for the public host.
   */
  probeModes?: boolean;
  /** Guard numbers to use in place of the named ones. Tests set a small cap; nothing in production sets any of them. */
  limits?: Partial<Limits>;
  /** Milliseconds between housekeeping passes. Default `sweepIntervalMs`. 0 makes no timer: `sweepOnce` is then called by hand. */
  sweepMs?: number;
  /** Milliseconds between hello-deadline passes. Default `helloCheckIntervalMs`. 0 makes no timer: `helloDeadlineOnce` is then called by hand. */
  helloCheckMs?: number;
  /**
   * The largest stress board size this instance will build. Default
   * `PUBLIC_MAX_BOARD_SIZE`: only an instance started for a measurement is
   * given a larger one.
   */
  maxBoardSize?: number;
}

export interface App {
  server: Server;
  wss: WebSocketServer;
  /**
   * One sampling pass at `nowMs`: a frame for every session somebody is
   * watching. The timer calls this; a test calls it directly.
   */
  sampleOnce(nowMs: number): void;
  /**
   * One heartbeat round at `nowMs`: every connection is pinged, one that has
   * been sent nothing for the heartbeat period is sent the heartbeat message,
   * and one that has missed two pings in a row is dropped. The timer calls
   * this; a test calls it directly.
   */
  heartbeatOnce(nowMs: number): void;
  /**
   * One housekeeping pass at `nowMs`: every session that has had no socket
   * for the whole time-to-live is freed. The timer calls this; a test calls
   * it directly.
   */
  sweepOnce(nowMs: number): void;
  /**
   * One hello-deadline round at `nowMs`: every ordinary connection that has
   * been given no session within the deadline of opening is dropped. The
   * timer calls this; a test calls it directly.
   */
  helloDeadlineOnce(nowMs: number): void;
  /** Stops the timers, closes every client with code 1001, closes both servers. */
  close(): Promise<void>;
}

/**
 * `/ws` (no `probe` value, or an unknown one): ordinary. It is pinged, the
 * door answers what it sends, and it is sent the heartbeat message whenever
 * nothing else has gone its way for the heartbeat period.
 *
 * The two measurement modes are read only when `probeModes` is on, so the
 * public host has no way to reach them. `/ws?probe=quiet`: never routed to
 * the door, pinged, and sees the heartbeat message. `/ws?probe=silent`:
 * receives nothing at all and is not pinged — the baseline for the host
 * idle-timeout measurement.
 *
 * Neither measurement mode is held to the hello deadline: a measurement
 * connection never reaches the door, so it could never hold a session, and a
 * run holds one open for twenty minutes. That opens nothing on the public
 * host, where `probeModes` is off and every connection is ordinary whatever
 * its query says.
 */
type ConnMode = 'normal' | 'quiet' | 'silent';

interface ConnState {
  mode: ConnMode;
  /** The injected clock's reading when anything was last sent to this connection. */
  lastSendMs: number;
  /** The injected clock's reading when this connection was opened. */
  openedMs: number;
  /** Pings sent since the last pong came back. */
  missedPongs: number;
  /**
   * The door's own record for this connection. The hello deadline reads its
   * `sessionId`, which is the one place that knows a hello has been answered:
   * a second flag here could drift from it.
   */
  connection: Connection;
}

const HB_PAYLOAD = JSON.stringify({ type: 'hb' });
/** Close code for "the server hit something it did not expect". */
const CLOSE_INTERNAL_ERROR = 1011;
/**
 * How many rounds in a row a connection may fail to answer a ping before it
 * is dropped. Two, not one: a single slow answer must not cost a player
 * their connection.
 */
const MISSED_PONGS_ALLOWED = 2;

function toText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}

/** One header value: a repeated header arrives as a list, and the first entry is the one that counts. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function modeFromUrl(url: URL): ConnMode {
  const probe = url.searchParams.get('probe');
  if (probe === 'quiet') return 'quiet';
  if (probe === 'silent') return 'silent';
  return 'normal';
}

export function createApp(options: AppOptions): App {
  const heartbeatMs = options.heartbeatMs ?? 20000;
  const sampleMs = options.sampleMs ?? SAMPLE_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());
  const probeModes = options.probeModes ?? false;
  const limits: Limits = { ...LIMITS, ...options.limits };
  const sweepMs = options.sweepMs ?? limits.sweepIntervalMs;
  const helloCheckMs = options.helloCheckMs ?? limits.helloCheckIntervalMs;

  const registry = createRegistry({ drawSeed: options.drawSeed ?? drawSeed, drawId: drawSessionId, limits });
  // One budget for the whole service. Per address would be the wrong shape
  // here: a classroom shares one address, and behind a proxy every visitor
  // appears to come from the same one.
  const newSessions = createTokenBucket(limits.newSessionBurst, limits.newSessionRefillPerSecond);
  const door = { registry, now, newSessions, maxBoardSize: options.maxBoardSize ?? PUBLIC_MAX_BOARD_SIZE };
  const samplerStats = { sent: 0, skipped: 0 };

  const serveStatic = sirv(options.staticDir, {
    single: true,
    etag: true,
    dev: false,
    setHeaders(res, pathname) {
      if (pathname.startsWith('/assets/')) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('cache-control', 'no-cache');
      }
    },
  });

  const connections = new Map<WebSocket, ConnState>();
  /** Whether the cap line has already been logged for the crossing the service is in. */
  let capLogged = false;

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      if (req.url === HEALTH_PATH) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        // Two counts and nothing more: enough to see "two tabs, two games"
        // and to watch the sweep work, with no session id and no seed.
        res.end(
          JSON.stringify({
            ok: true,
            commit: options.version.commit,
            buildTime: options.version.buildTime,
            sessions: registry.size,
            sockets: connections.size,
          }),
        );
        return;
      }

      if (req.url === WS_PATH) {
        res.writeHead(426);
        res.end('Upgrade Required');
        return;
      }

      serveStatic(req, res);
    } catch {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  const server = createServer(handleRequest);

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });

  /** Routes every send through here so `lastSendMs` is always accurate. */
  function sendTo(ws: WebSocket, state: ConnState, payload: string): void {
    ws.send(payload);
    state.lastSendMs = now();
  }

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const origin = firstHeader(req.headers.origin);
    if (!originAllowed({ origin, host: firstHeader(req.headers.host), forwardedHost: firstHeader(req.headers['x-forwarded-host']) })) {
      // The refused origin and nothing else about the request: enough to see
      // in the host's log which page was turned away, without putting a
      // session id or a header set anywhere near it.
      console.warn('ws origin refused', origin);
      socket.destroy();
      return;
    }

    if (connections.size >= limits.maxConnections) {
      // Counted here, before the handshake: the handshake is the expensive
      // part, and a connection that never speaks costs nothing anywhere else
      // in the service, so this count is the only thing standing between it
      // and the host's memory. The count and the `set` below are one
      // synchronous turn — there is no `await` between them — so two upgrades
      // can never both pass on the last free place.
      //
      // A short answer rather than a bare destroy, so a client can tell
      // "full" from "broken". The http server has already handed the raw
      // socket over, so it gets a listener of its own first: a peer that
      // resets in the middle of this write must not become an unhandled
      // event and take the process down with it.
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => {
        socket.destroy();
      });
      if (!capLogged) {
        // Once each time the cap is reached, never once per refusal: a flood
        // must not be able to fill the host's log, and saying nothing at all
        // would leave the owner blind to a full service.
        console.warn('ws connection cap reached', limits.maxConnections);
        capLogged = true;
      }
      return;
    }

    const mode = probeModes ? modeFromUrl(url) : 'normal';

    wss.handleUpgrade(req, socket, head, (ws) => {
      // What the door and the sampler hold: every send still goes through
      // `sendTo`, so the heartbeat knows when this socket last heard anything.
      const frameSocket: FrameSocket = {
        OPEN: ws.OPEN,
        get readyState() {
          return ws.readyState;
        },
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
        send(text: string) {
          sendTo(ws, state, text);
        },
      };
      const connection: Connection = {
        socket: frameSocket,
        sessionId: null,
        playerId: null,
        messages: createWindowCounter(limits.messagesPerWindow, limits.messageWindowMs),
      };
      const state: ConnState = { mode, lastSendMs: now(), openedMs: now(), missedPongs: 0, connection };
      connections.set(ws, state);
      capLogged = false;

      ws.on('pong', () => {
        state.missedPongs = 0;
      });

      ws.on('message', (data, isBinary) => {
        // The probe modes only listen.
        if (mode !== 'normal') return;
        try {
          // Binary is never part of the contract: it goes to the door as text that cannot parse.
          handleInbound(door, connection, isBinary ? '' : toText(data));
        } catch {
          // Nothing a client sends may take the process down.
          ws.close(CLOSE_INTERNAL_ERROR);
        }
      });
      ws.on('error', () => {
        // `ws` reports a frame over `maxPayload` (and any other protocol
        // error) here and closes the socket itself. Without a listener the
        // event would be unhandled.
      });
      ws.on('close', () => {
        connections.delete(ws);
        handleClosed(door, connection);
      });

      wss.emit('connection', ws, req);
    });
  });

  function heartbeatOnce(nowMs: number): void {
    for (const [ws, state] of connections) {
      if (state.mode === 'silent') continue;
      state.missedPongs += 1;
      if (state.missedPongs >= MISSED_PONGS_ALLOWED) {
        // Two rounds with no answer: the peer is gone, not slow.
        ws.terminate();
        continue;
      }
      ws.ping();
      if (nowMs - state.lastSendMs >= heartbeatMs) {
        sendTo(ws, state, HB_PAYLOAD);
      }
    }
  }

  const heartbeatTimer = heartbeatMs > 0 ? setInterval(() => heartbeatOnce(now()), heartbeatMs) : null;

  function sampleOnce(nowMs: number): void {
    sampleSessions(registry, nowMs, samplerStats, limits.stressFullFrameMs);
  }

  // One timer for every session; no game has a timer of its own. A pass is
  // synchronous today, so passes cannot overlap; the flag keeps a late timer
  // from piling them up if a pass ever comes to wait on something.
  let sampling = false;
  const sampleTimer =
    sampleMs > 0
      ? setInterval(() => {
          if (sampling) return;
          sampling = true;
          try {
            sampleOnce(now());
          } finally {
            sampling = false;
          }
        }, sampleMs)
      : null;

  function sweepOnce(nowMs: number): void {
    registry.sweepOnce(nowMs);
  }

  // One housekeeping timer for the whole service, whatever the number of
  // sessions: no game has a timer of its own.
  const sweepTimer = sweepMs > 0 ? setInterval(() => sweepOnce(now()), sweepMs) : null;

  function helloDeadlineOnce(nowMs: number): void {
    for (const [ws, state] of connections) {
      // A measurement connection never reaches the door, so it could never
      // hold a session; the modes are unreachable on the public host anyway.
      if (state.mode !== 'normal') continue;
      // Read from the door's own record: a hello that was refused leaves no
      // session, so one refused message cannot buy a socket a place for good.
      if (state.connection.sessionId !== null) continue;
      if (nowMs - state.openedMs < limits.helloDeadlineMs) continue;
      // `terminate`, not `close`: the place is wanted back now, and a close
      // would arm a timer of its own inside the library for every socket.
      ws.terminate();
    }
  }

  // One timer for the whole service, whatever the number of connections: no
  // socket has a deadline timer of its own.
  const helloCheckTimer = helloCheckMs > 0 ? setInterval(() => helloDeadlineOnce(now()), helloCheckMs) : null;

  async function close(): Promise<void> {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (sampleTimer !== null) clearInterval(sampleTimer);
    if (sweepTimer !== null) clearInterval(sweepTimer);
    if (helloCheckTimer !== null) clearInterval(helloCheckTimer);
    for (const ws of connections.keys()) {
      ws.close(1001);
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { server, wss, sampleOnce, heartbeatOnce, sweepOnce, helloDeadlineOnce, close };
}
