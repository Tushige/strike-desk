import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createLoopbackTransport } from '../../modules/connection/fake';
import type { LoopbackTransport } from '../../modules/connection/fake';
import { createConnection } from '../../modules/connection/index';
import type { Connection, ConnectionPhase, ConnectionState } from '../../modules/connection/index';

/**
 * The connection, shown against a stand-in server that lives in this page.
 * No real socket is opened: the line that is cut and brought back here is a
 * pretend one, run on the browser's timer and clock.
 */

interface Line {
  connection: Connection;
  server: LoopbackTransport;
  /** Made once with the line, so React never sees a new subscribe function on a re-render. */
  watchState: (listener: () => void) => () => void;
  readState: () => ConnectionState;
}

function browserTimer(run: () => void, ms: number): () => void {
  const timer = window.setTimeout(run, ms);
  return () => {
    window.clearTimeout(timer);
  };
}

function pageClock(): number {
  return performance.now();
}

function makeLine(): Line {
  const server = createLoopbackTransport({ schedule: browserTimer, now: pageClock, random: Math.random });
  const connection = createConnection({
    seam: server.seam,
    sessionKey: 'lab.connection.session',
    resendOnResume: () => false,
  });
  return {
    connection,
    server,
    watchState: (listener) => connection.state.subscribe(listener),
    readState: () => connection.state.get(),
  };
}

/** The page's clock, read a few times a second, for the two countdowns. */
function useClock(everyMs: number): number {
  const [reading, setReading] = useState(pageClock);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setReading(pageClock());
    }, everyMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [everyMs]);
  return reading;
}

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

const PHASE_TONE: Record<ConnectionPhase, string> = {
  connecting: 'text-muted-foreground',
  live: 'text-up',
  stale: 'text-gold',
  reconnecting: 'text-down',
  resumed: 'text-gold',
  closed: 'text-muted-foreground',
};

function Reading({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-lg tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Press({ onPress, children }: { onPress: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}

export default function ConnectionDemo(): ReactElement {
  const [{ connection, server, watchState, readState }] = useState(makeLine);
  const state = useSyncExternalStore(watchState, readState, readState);
  const clock = useClock(100);

  // Leaving the page closes the pretend line, so nothing keeps ticking behind it.
  useEffect(
    () => () => {
      connection.close();
    },
    [connection],
  );

  return (
    <section id="lab-demo-connection" className="mt-4 flex max-w-3xl flex-col gap-4">
      <p className="m-0 max-w-prose text-sm text-muted-foreground">
        A pretend line to a stand-in server that lives in this page: no real socket is opened. Connect, then cut the
        line and watch it come back by itself, waiting a little longer after every failed attempt.
      </p>

      <div className="flex flex-wrap gap-2">
        <Press
          onPress={() => {
            connection.connect();
          }}
        >
          Connect
        </Press>
        <Press
          onPress={() => {
            server.cut();
          }}
        >
          Cut the line
        </Press>
        <Press
          onPress={() => {
            connection.close();
          }}
        >
          Close
        </Press>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
        <Reading label="Phase">
          <span className={PHASE_TONE[state.phase]}>{state.phase}</span>
        </Reading>
        <Reading label="Attempt">{state.attempt}</Reading>
        <Reading label="Next attempt in">{state.retryAt === null ? 'none waiting' : seconds(state.retryAt - clock)}</Reading>
        <Reading label="Age of the data">
          {state.lastMessageAt === null ? 'nothing yet' : seconds(clock - state.lastMessageAt)}
        </Reading>
      </dl>
    </section>
  );
}
