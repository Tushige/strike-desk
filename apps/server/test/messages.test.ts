import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import type { Harness } from './harness';
import { startHarness } from './harness';

/**
 * Anything at all may arrive at a public socket. Every case below is sent to
 * the real server over a real connection, and every case is followed by a
 * fresh connection saying a valid hello: the point is not only that the bad
 * message was refused, but that the service is still serving afterwards.
 */

const HELLO = { t: 'hello', v: PROTOCOL_VERSION };
const BAD_MESSAGE = { t: 'error', code: 'badMessage' };
/** The socket's inbound size limit. `ws` refuses a larger frame itself. */
const MAX_PAYLOAD = 4096;
/** The close code for "message too big". */
const CLOSE_TOO_LARGE = 1009;

let harness: Harness | null = null;

async function boot(overrides: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  harness = await startHarness(overrides);
  return harness;
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** A brand new connection must still get its lobby frame. */
async function stillServing(running: Harness): Promise<void> {
  const bystander = running.connect();
  await bystander.opened();
  bystander.send(HELLO);
  expect((await bystander.nextFrame()).clock.phase).toBe('lobby');
  await bystander.close();
}

describe('a malformed message is refused and the service carries on', () => {
  const BAD_TEXTS: [string, string][] = [
    ['an empty message', ''],
    ['text that is not JSON', '{'],
    ['JSON that is not an object', 'null'],
    ['an array', '[]'],
    ['a kind the contract does not have', '{"t":"nope"}'],
    ['a hello with no version', '{"t":"hello"}'],
    ['a hello carrying a key the contract does not name', '{"t":"hello","v":1,"admin":true}'],
    ['a start whose command id is too short', '{"t":"start","commandId":"x","pace":1}'],
    ['a start at a pace that does not exist', '{"t":"start","commandId":"12345678","pace":2}'],
  ];

  it.each(BAD_TEXTS)('%s is answered badMessage', async (_name, text) => {
    const running = await boot();
    const client = running.connect();
    await client.opened();

    client.sendText(text);
    expect(await client.nextError()).toEqual(BAD_MESSAGE);

    await stillServing(running);
  });

  it('a binary message is answered badMessage', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();

    // Nothing on this wire is binary, so it reaches the door as text that
    // cannot be read, and gets the same answer as any other unreadable text.
    client.socket.send(Buffer.from([0x00, 0x01, 0x02, 0xff]));
    expect(await client.nextError()).toEqual(BAD_MESSAGE);

    await stillServing(running);
  });

  it('a message over the size limit closes that socket and no other', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();

    client.sendText('x'.repeat(MAX_PAYLOAD + 1));
    expect(await client.closed()).toBe(CLOSE_TOO_LARGE);

    await stillServing(running);
  });

  it('a start before any hello is answered noSession, carrying the command id', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();

    client.send({ t: 'start', commandId: 'start-0001', pace: 1 });
    expect(await client.nextError()).toEqual({ t: 'error', code: 'noSession', commandId: 'start-0001' });

    await stillServing(running);
  });

  it('an invalid draft is refused, while a valid preview leaves the connection answering', async () => {
    const running = await boot();
    const client = running.connect();
    await client.opened();
    client.send(HELLO);
    const lobby = await client.nextFrame();

    client.sendText('{"t":"draft","contractId":5,"spendCents":-1}');
    expect(await client.nextError()).toEqual(BAD_MESSAGE);
    client.send({ t: 'draft', contractId: 5, spendCents: 5_000_000 });

    // The same connection is still served: a start is taken and answered.
    client.send({ t: 'start', commandId: 'start-0001', pace: 1 });
    const reply = await client.nextReply();
    expect(reply.receipt.outcome).toBe('accepted');
    expect(reply.frame.session).toBe(lobby.session);
    expect(reply.frame.draft).toMatchObject({ contractId: 5, spendCents: 5_000_000 });
    expect(reply.frame.draft?.costs).toHaveLength(reply.frame.quotes.length);
    expect(reply.frame.account.cashCents).toBe(lobby.account.cashCents);
    expect(reply.frame.receipts).toEqual([{ commandId: 'start-0001', kind: 'start', step: 0, outcome: 'accepted' }]);
    expect(reply.frame.rev).toBe(1); // Only Start is a command; neither draft creates an outcome.

    await stillServing(running);
  });

  it('two hundred malformed messages in a row leave the service answering', async () => {
    // The service refuses a socket that sends more than twenty in ten seconds
    // (proved in limits.test.ts). That guard is lifted here on purpose: what
    // is being exercised is the door itself, which must refuse two hundred
    // unreadable messages one by one without the service faltering.
    const running = await boot({ limits: { messagesPerWindow: 1000 } });
    const client = running.connect();
    await client.opened();

    const sent = 200;
    for (let i = 0; i < sent; i += 1) client.sendText(`{"t":"nope","n":${i}}`);
    for (let i = 0; i < sent; i += 1) expect(await client.nextError()).toEqual(BAD_MESSAGE);

    const health = await fetch(`${running.baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    await stillServing(running);
  });
});
