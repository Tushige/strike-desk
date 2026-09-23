import { expect, it } from 'vitest';
import { createConnection, resendNever } from '../src/modules/connection';
import { createFakeTransport } from '../src/modules/connection/fake';

it('includes the workload size when resuming, in case the saved session has expired', () => {
  const transport = createFakeTransport({ session: 'saved-workload' });
  const connection = createConnection({ seam: transport.seam, sessionKey: 'workload', board: 2500, resendOnResume: resendNever });
  connection.connect();
  transport.last().fireOpen();
  expect(JSON.parse(transport.last().sent[0]!)).toEqual({ t: 'hello', v: 1, session: 'saved-workload', board: 2500 });
  connection.close();
});

it('retries a refused size without discarding the saved session', () => {
  const transport = createFakeTransport({ session: 'existing-workload' });
  const connection = createConnection({ seam: transport.seam, sessionKey: 'workload', board: 2500, resendOnResume: resendNever });
  connection.connect();
  transport.last().fireOpen();
  transport.last().fireMessage(JSON.stringify({ t: 'error', code: 'badMessage' }));
  expect(transport.last().sent.map(text => JSON.parse(text) as unknown)).toEqual([
    { t: 'hello', v: 1, session: 'existing-workload', board: 2500 },
    { t: 'hello', v: 1, session: 'existing-workload' },
  ]);
  expect(transport.stored()).toBe('existing-workload');
  connection.close();
});
