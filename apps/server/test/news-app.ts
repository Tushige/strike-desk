import { createInterface } from 'node:readline';
import { startHarness } from './harness';

// A child process controlled only by its test's stdin, never by a public route.
const harness = await startHarness({ sweepMs: 0 });
const input = createInterface({ input: process.stdin });
process.stdout.write(`${JSON.stringify({ url: harness.url })}\n`);
for await (const line of input) {
  if (line === 'close') break;
  const advanceMs = Number(line);
  if (!Number.isFinite(advanceMs) || advanceMs < 0) throw new Error('invalid clock advance');
  harness.clock.advance(advanceMs);
  harness.sample();
}
input.close();
await harness.close();
