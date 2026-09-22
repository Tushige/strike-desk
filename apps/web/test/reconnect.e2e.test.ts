/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import { contractId } from '@strike-desk/shared/protocol';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import { createConnection, resendWhileFresh } from '../src/modules/connection/index';
import type { Connection, SocketLike } from '../src/modules/connection/index';
import { createManualScheduler } from './fakeSocket';

/**
 * The reconnect proof, end to end over a real socket to the real service:
 * buy, cut the line, reconnect, and the game holds exactly one ticket and
 * the right cash. Two ways to cut it, both real:
 *
 * - "lost reply": the buy reaches the server and the line drops before the
 *   answer comes back. The reconnect's first frame carries the receipt, which
 *   settles the buy without sending anything again.
 * - "unsent buy": the line drops before the buy leaves the page. After the
 *   reconnect the page sends it again by itself, under the same id.
 *
 * Then the same id is sent once more on purpose. The server answers with the
 * first receipt and the money is untouched: a resend can never buy twice.
 */

interface TestSocket extends SocketLike {
  ping(): void;
  once(event: 'pong', listener: () => void): void;
}
const Socket = createRequire(path.resolve('apps/server/package.json'))('ws') as new (url: string) => TestSocket;

type Fault = 'lost reply' | 'unsent buy';

interface Service {
  url: string;
  /** Advance the service's clock by `ms` and sample one frame to every socket. */
  tick(ms: number): void;
  close(): void;
}

async function startService(): Promise<Service> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['--import', pathToFileURL(createRequire(path.resolve('apps/server/package.json')).resolve('tsx')).href, 'apps/server/test/news-app.ts'], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error(`service readiness timeout: ${errors}`)); }, 30_000);
    lines.on('line', (line) => {
      if (!line.startsWith('{')) return;
      clearTimeout(timeout);
      resolve((JSON.parse(line) as { url: string }).url);
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(errors)); });
  });
  return {
    url,
    tick(ms) { child.stdin.write(`${String(ms)}\n`); },
    close() { child.stdin.write('close\n'); child.kill(); },
  };
}

function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = (): void => {
      if (check()) { resolve(); return; }
      if (Date.now() - started > ms) { reject(new Error(`timed out waiting for ${what}`)); return; }
      setTimeout(poll, 10);
    };
    poll();
  });
}

const services: Service[] = [];
const connections: Connection[] = [];
afterEach(() => {
  connections.splice(0).forEach((connection) => { connection.close(); });
  services.splice(0).forEach((service) => { service.close(); });
});

describe.each<Fault>(['lost reply', 'unsent buy'])('after a %s', (fault) => {
  it('the reconnected game holds exactly one ticket and the right cash, and a deliberate resend changes nothing', async () => {
    const service = await startService();
    services.push(service);
    const frames: Frame[] = [];
    const received: ServerMessage[] = [];
    let live: TestSocket | null = null;
    let armed = true;
    const retries = createManualScheduler();

    const connection = createConnection({
      seam: {
        url: service.url,
        storage: null,
        schedule: (run, ms) => retries.schedule(run, ms),
        random: () => 0,
        now: () => performance.now(),
        createSocket(address) {
          const socket = new Socket(address);
          live = socket;
          return {
            get readyState() { return socket.readyState; },
            close: () => { socket.close(); },
            send(text) {
              const message = JSON.parse(text) as { t: string };
              // The line drops just as the buy is pressed: the text never leaves the page.
              if (fault === 'unsent buy' && armed && message.t === 'buy') { armed = false; socket.close(); return; }
              socket.send(text);
            },
            addEventListener(type, listener) {
              socket.addEventListener(type, (event) => {
                if (type === 'message') {
                  const message = JSON.parse(String((event as { data: unknown }).data)) as ServerMessage;
                  // The buy went through and the line drops before its answer arrives.
                  if (fault === 'lost reply' && armed && message.t === 'reply' && message.receipt.kind === 'buy') { armed = false; socket.close(); return; }
                }
                listener(event);
              });
            },
          };
        },
      },
      sessionKey: 'test.session',
      resendOnResume: resendWhileFresh({ maxAgeMs: 20_000, now: () => performance.now() }),
    });
    connections.push(connection);
    connection.subscribe((event) => {
      if (event.type !== 'message') return;
      received.push(event.message);
      if (event.message.t === 'frame') frames.push(event.message);
      if (event.message.t === 'reply') frames.push(event.message.frame);
    });

    connection.connect();
    await until(() => frames.length > 0, 'the lobby frame');
    const started = await connection.submit({ t: 'start', commandId: 'e2e-start', pace: 1 });
    expect(started.outcome).toBe('accepted');
    const opening = frames.at(-1);
    if (opening?.board === null || opening === undefined) throw new Error('no board after start');
    const board = opening.board;
    const closeUp = contractId(board.targetsPerCompany, { companyId: 0, targetIndex: board.companies[0]!.simpleUp[0], side: 'up' });
    const seen = opening.quotes[closeUp]!;

    // The press. The line is cut by the fault above, one way or the other.
    const buy = connection.submit({ t: 'buy', commandId: 'e2e-buy-0001', day: 1, contractId: closeUp, spendCents: 10_000_000, seenPriceCents: seen });
    await until(() => connection.state.get().phase === 'reconnecting', 'the line to drop');
    expect(connection.pending.get().map((pending) => [pending.command.commandId, pending.status])).toEqual([['e2e-buy-0001', 'checking']]);

    // The reconnect: the booked retry runs, a new socket says hello with the same session.
    retries.runNext();
    await until(() => (live?.readyState ?? 0) === 1, 'the new socket to open');
    const outcome = await buy;
    expect(outcome.outcome).toBe('accepted');
    await until(() => connection.pending.get().length === 0, 'nothing left pending');

    // One ticket, and the cash is the starting million less what it cost.
    service.tick(0);
    await until(() => frames.some((frame) => frame.positions.length === 1 && frame.receipts.some((receipt) => receipt.commandId === 'e2e-buy-0001')), 'a frame with the ticket');
    const settled = frames.at(-1)!;
    expect(settled.positions).toHaveLength(1);
    expect(settled.account.cashCents).toBe(100_000_000 - settled.positions[0]!.costCents);
    expect(settled.receipts.filter((receipt) => receipt.kind === 'buy')).toHaveLength(1);

    // The same id once more, straight onto the wire: the server answers with
    // the first receipt, and the ticket and the cash are what they were.
    const before = received.length;
    connection.send({ t: 'buy', commandId: 'e2e-buy-0001', day: 1, contractId: closeUp, spendCents: 10_000_000, seenPriceCents: seen });
    await until(() => received.slice(before).some((message) => message.t === 'reply' && message.receipt.commandId === 'e2e-buy-0001'), 'the repeated receipt');
    const repeat = received.slice(before).find((message) => message.t === 'reply' && message.receipt.commandId === 'e2e-buy-0001');
    if (repeat?.t !== 'reply') throw new Error('no repeated reply');
    expect(repeat.receipt).toEqual(outcome.outcome === 'accepted' ? outcome.receipt : null);
    expect(repeat.frame.positions).toHaveLength(1);
    expect(repeat.frame.account.cashCents).toBe(settled.account.cashCents);
  }, 60_000);
});
