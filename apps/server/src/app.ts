import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import sirv from 'sirv';
import { HEALTH_PATH, WS_PATH } from '@strike-desk/shared';

export interface AppOptions {
  /** Absolute path of the built web files (apps/web/dist). */
  staticDir: string;
  /** Milliseconds between ticks. Default 1000. Tests pass a small value. */
  tickMs?: number;
}

export interface App {
  server: Server;
  wss: WebSocketServer;
  /** Stops the tick timer, closes every client with code 1001, closes both servers. */
  close(): Promise<void>;
}

export function createApp(options: AppOptions): App {
  const tickMs = options.tickMs ?? 1000;

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

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      if (req.url === HEALTH_PATH) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
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

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '/', 'http://internal');
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  let tick = 0;

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'tick', tick }));
    ws.on('message', () => {
      // Inbound client messages are ignored — this phase only pushes.
    });
  });

  const interval = setInterval(() => {
    tick += 1;
    const payload = JSON.stringify({ type: 'tick', tick });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }, tickMs);

  async function close(): Promise<void> {
    clearInterval(interval);
    for (const client of wss.clients) {
      client.close(1001);
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { server, wss, close };
}
