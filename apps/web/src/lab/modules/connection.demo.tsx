import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createLoopbackTransport } from '../../modules/connection/fake';
import type { LoopbackTransport } from '../../modules/connection/fake';
import { createConnection, lineStateOf, resendNever, resendWhileFresh } from '../../modules/connection/index';
import type {
  Connection,
  ConnectionLine,
  ConnectionOptions,
  ConnectionPhase,
  ConnectionState,
  PendingCommand,
} from '../../modules/connection/index';

/**
 * The connection, shown against a stand-in server that lives in this page.
 * No real socket is opened: the line that is cut and brought back here is a
 * pretend one, run on the browser's timer and clock.
 */

type ResendOnResume = ConnectionOptions['resendOnResume'];
type PolicyName = 'never' | 'whileFresh';

/**
 * How recent a press must be to go out again by itself, on this page only.
 * A demo value: the connection holds no such number, and the game's is not
 * decided.
 */
const DEMO_FRESH_MS = 5000;

/** How many of the latest texts the log shows. */
const LOG_SHOWN = 12;

interface Line {
  connection: Connection;
  server: LoopbackTransport;
  /** Made once with the line, so React never sees a new subscribe function on a re-render. */
  watchState: (listener: () => void) => () => void;
  readState: () => ConnectionState;
  watchPending: (listener: () => void) => () => void;
  readPending: () => readonly PendingCommand[];
  /** Which answer to the resend question the line is run with; the switch on the page changes it. */
  setPolicy: (name: PolicyName) => void;
  /** A made-up buy with an id no press before it had. How it ends shows in the pending list and the ticket count. */
  buy: () => void;
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

  const policies: Record<PolicyName, ResendOnResume> = {
    never: resendNever,
    whileFresh: resendWhileFresh({ maxAgeMs: DEMO_FRESH_MS, now: pageClock }),
  };
  let policy: ResendOnResume = policies.never;

  const connection = createConnection({
    seam: server.seam,
    sessionKey: 'lab.connection.session',
    // The connection is handed one function for good; which answer it gives is this page's switch.
    resendOnResume: (pending, frame) => policy(pending, frame),
  });

  let presses = 0;

  return {
    connection,
    server,
    watchState: (listener) => connection.state.subscribe(listener),
    readState: () => connection.state.get(),
    watchPending: (listener) => connection.pending.subscribe(listener),
    readPending: () => connection.pending.get(),
    setPolicy(name) {
      policy = policies[name];
    },
    buy() {
      presses += 1;
      void connection.submit({
        t: 'buy',
        commandId: `lab-buy-${String(presses).padStart(4, '0')}`,
        day: 1,
        contractId: 7,
        spendCents: 50000,
        seenPriceCents: 1200,
      });
    },
  };
}

/** The page's clock, read a few times a second: the countdowns, the ticket count and the log ride on it. */
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

const LINE_TONE: Record<ConnectionLine, string> = {
  live: 'text-up',
  stale: 'text-gold',
  offline: 'text-down',
};

const LINE_MEANS: Record<ConnectionLine, string> = {
  live: 'buying is open',
  stale: 'numbers show, buying waits',
  offline: 'no line, buying is shut',
};

function Reading({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-lg tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Press({
  onPress,
  pressed,
  children,
}: {
  onPress: () => void;
  /** Set for a press that switches something on and off. */
  pressed?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function ConnectionDemo(): ReactElement {
  const [line] = useState(makeLine);
  const { connection, server } = line;
  const state = useSyncExternalStore(line.watchState, line.readState, line.readState);
  const pending = useSyncExternalStore(line.watchPending, line.readPending, line.readPending);
  const clock = useClock(100);
  const [policyName, setPolicyName] = useState<PolicyName>('never');
  const [silent, setSilent] = useState(false);

  // Leaving the page closes the pretend line, so nothing keeps ticking behind it.
  useEffect(
    () => () => {
      connection.close();
    },
    [connection],
  );

  const lineState = lineStateOf(state.phase);
  const log = server.log();
  const shown = log.slice(-LOG_SHOWN);

  function choosePolicy(name: PolicyName): void {
    line.setPolicy(name);
    setPolicyName(name);
  }

  function goSilent(on: boolean): void {
    server.silent(on);
    setSilent(on);
  }

  return (
    <section id="lab-demo-connection" className="mt-4 flex max-w-4xl flex-col gap-5">
      <p className="m-0 max-w-prose text-sm text-muted-foreground">
        A pretend line to a stand-in server that lives in this page: no real socket is opened, and nothing here reaches
        the game. Connect, then cut the line and watch it come back by itself, waiting a little longer after every
        failed attempt. Buy a made-up ticket and break the line under it: however the press travels, the server ends
        up holding exactly one ticket for it.
      </p>
      <p className="m-0 max-w-prose text-sm text-muted-foreground">
        One thing the stand-in does that the real service does not do yet: it lists its recent answers on every
        update, so a lost reply is settled here by the next update. Against the real service today, a lost reply is
        settled only by sending the same command again, which the drop-the-command buttons show.
      </p>

      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-live="polite">
        <Reading label="Phase">
          <span className={PHASE_TONE[state.phase]}>{state.phase}</span>
        </Reading>
        <Reading label="Line, as a form sees it">
          <span className={LINE_TONE[lineState]}>{lineState}</span>
          <span className="block text-xs text-muted-foreground">{LINE_MEANS[lineState]}</span>
        </Reading>
        <Reading label="Attempt">{state.attempt}</Reading>
        <Reading label="Next attempt in">{state.retryAt === null ? 'none waiting' : seconds(state.retryAt - clock)}</Reading>
        <Reading label="Age of the data">
          {state.lastMessageAt === null ? 'nothing yet' : seconds(clock - state.lastMessageAt)}
        </Reading>
        <Reading label="Tickets the server holds">{server.tickets()}</Reading>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <Group title="The line">
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
            pressed={silent}
            onPress={() => {
              goSilent(!silent);
            }}
          >
            {silent ? 'Resume traffic' : 'Go silent'}
          </Press>
          <Press
            onPress={() => {
              connection.close();
            }}
          >
            Close
          </Press>
        </Group>

        <Group title="A command">
          <Press onPress={line.buy}>Buy</Press>
          <Press
            onPress={() => {
              server.loseNextReply();
            }}
          >
            Lose the next reply
          </Press>
          <Press
            onPress={() => {
              server.dropNextCommand();
            }}
          >
            Drop the next command
          </Press>
        </Group>

        <Group title="Both at once, faster than a hand can">
          <Press
            onPress={() => {
              server.loseNextReply();
              line.buy();
              server.cut();
            }}
          >
            Buy, lose the reply, cut the line
          </Press>
          <Press
            onPress={() => {
              server.dropNextCommand();
              line.buy();
              server.cut();
            }}
          >
            Buy, drop the command, cut the line
          </Press>
        </Group>

        <Group title="After a reconnect, an unanswered command">
          <Press
            pressed={policyName === 'never'}
            onPress={() => {
              choosePolicy('never');
            }}
          >
            Waits to be resent by hand
          </Press>
          <Press
            pressed={policyName === 'whileFresh'}
            onPress={() => {
              choosePolicy('whileFresh');
            }}
          >
            Resends by itself while fresh
          </Press>
          <p className="m-0 basis-full text-xs text-muted-foreground">
            Fresh means pressed no more than {DEMO_FRESH_MS / 1000} seconds ago and still the same game day. The{' '}
            {DEMO_FRESH_MS / 1000} seconds is a demo value for this page only.
          </p>
        </Group>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Commands with no answer yet
          </h3>
          {pending.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
              {pending.map((one) => (
                <li
                  key={one.command.commandId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <span className="font-mono text-foreground">{one.command.commandId}</span>
                  <span className={one.status === 'sent' ? 'text-up' : 'text-gold'}>{one.status}</span>
                  <span className="tabular-nums text-muted-foreground">
                    sent {one.sends} {one.sends === 1 ? 'time' : 'times'}
                  </span>
                  {one.status === 'checking' ? (
                    <Press
                      onPress={() => {
                        connection.resend(one.command.commandId);
                      }}
                    >
                      Resend
                    </Press>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-xs text-muted-foreground">
            Resend does something only while the phase is live, and always sends the same text again.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            What the sockets were handed ({log.length} in all, the last {shown.length} shown)
          </h3>
          <ol
            className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-auto rounded-md border border-border bg-background p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            role="log"
            aria-label="Texts handed to the sockets"
            tabIndex={0}
          >
            {shown.length === 0 ? (
              <li className="text-sm text-muted-foreground">Nothing yet.</li>
            ) : (
              shown.map((entry, index) => (
                <li key={`${String(log.length - shown.length + index)}`} className="flex gap-2 text-xs">
                  <span className="shrink-0 tabular-nums text-muted-foreground">socket {entry.socket}</span>
                  <span className="break-all font-mono text-foreground">{entry.text}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </section>
  );
}
