import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '@strike-desk/shared/protocol';
import { createFakeTransport, fakeFrameText } from '../src/modules/connection/fake';
import { createConnection } from '../src/modules/connection/index';
import { describeFeedContract } from './contracts/feed.contract';

/**
 * The connection is the feed the page runs on, and has to be one in full:
 * every case any feed must pass, over a transport driven entirely by hand.
 * It never resends by itself here, so every text a socket holds is one the
 * case asked for.
 */
describeFeedContract('the connection', (seam) =>
  createConnection({ seam, sessionKey: 'test.session', resendOnResume: () => false }),
);

describe('the hand-driven transport', () => {
  it('builds frame text the shared schema accepts', () => {
    const message = parseServerMessage(JSON.parse(fakeFrameText()));

    expect(message?.t).toBe('frame');
    expect(message?.t === 'frame' ? message.session : null).toBe('s-1');
  });

  it('builds frame text with the changes it is given', () => {
    const message = parseServerMessage(JSON.parse(fakeFrameText({ session: 's-2' })));

    expect(message?.t === 'frame' ? message.session : null).toBe('s-2');
  });

  it('refuses to turn its clock back', () => {
    const { clock } = createFakeTransport();
    clock.advance(250);

    expect(clock.now()).toBe(250);
    expect(() => {
      clock.advance(-1);
    }).toThrow('the clock never goes back');
  });

  it('runs waits oldest first and says when nothing is waiting', () => {
    const transport = createFakeTransport();
    const ran: string[] = [];
    transport.seam.schedule(() => ran.push('first'), 1000);
    const cancelSecond = transport.seam.schedule(() => ran.push('second'), 2000);
    transport.seam.schedule(() => ran.push('third'), 3000);
    cancelSecond();

    transport.runNextWait();
    transport.runNextWait();

    expect(ran).toEqual(['first', 'third']);
    expect(transport.waits()).toEqual([1000, 2000, 3000]);
    expect(transport.pendingWaits()).toBe(0);
    expect(() => {
      transport.runNextWait();
    }).toThrow('nothing is waiting');
  });

  it('says when no socket has been made', () => {
    expect(() => createFakeTransport().last()).toThrow('no socket has been made');
  });
});
