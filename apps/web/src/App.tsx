import { useEffect, useState } from 'react';
import { WS_PATH } from '@strike-desk/shared';

interface TickMessage {
  type: 'tick';
  tick: number;
}

function isTickMessage(value: unknown): value is TickMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown; tick?: unknown };
  return candidate.type === 'tick' && typeof candidate.tick === 'number';
}

export default function App() {
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [reconnects, setReconnects] = useState(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect(): void {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}${WS_PATH}`);

      socket.addEventListener('open', () => {
        setConnected(true);
      });

      socket.addEventListener('message', (event) => {
        try {
          const data: unknown = JSON.parse(event.data as string);
          if (isTickMessage(data)) {
            setTick(data.tick);
          }
        } catch {
          // Ignore malformed frames.
        }
      });

      socket.addEventListener('close', () => {
        setConnected(false);
        if (cancelled) return;
        setReconnects((count) => count + 1);
        retryTimer = setTimeout(connect, 2000);
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return (
    <main>
      <h1>Strike Desk</h1>
      <p>Test page</p>
      <p>
        Server tick <span className="tick-value">{tick}</span>
      </p>
      <p>{connected ? 'Live' : 'Connecting'}</p>
      <p>
        Reconnects <span>{reconnects}</span>
      </p>
    </main>
  );
}
