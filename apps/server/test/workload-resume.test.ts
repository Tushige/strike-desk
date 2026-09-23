import { afterEach, expect, it } from 'vitest';
import { startHarness } from './harness';
import type { Harness } from './harness';

let server: Harness | undefined;
afterEach(async () => { await server?.close(); });

it('keeps the requested workload when a saved session has expired', async () => {
  server = await startHarness();
  const client = server.connect();
  await client.opened();
  client.send({ t: 'hello', v: 1, session: 'expired-workload-session', board: 2500 });
  const error = await client.nextError();
  expect(error.code).toBe('noSession');
  const lobby = await client.nextFrame();
  expect(lobby.stress).toBe(true);
  client.send({ t: 'start', commandId: 'start-restored-workload', pace: 1 });
  const reply = await client.nextReply();
  expect(reply.frame.quotes).toHaveLength(2508);
});
