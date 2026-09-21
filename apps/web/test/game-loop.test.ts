import { describe, expect, it } from 'vitest';
import type { Frame, ServerMessage } from '@strike-desk/shared/protocol';
import { createWsFeed } from '../src/feed/wsFeed';
import { createGameLoop } from '../src/gameplay/gameLoop';
import { createManualScheduler, createSocketFactory, testFrame } from './fakeSocket';

function harness() {
  const sockets = createSocketFactory();
  const scheduler = createManualScheduler();
  let ids = 0;
  const feed = createWsFeed({ url: 'ws://example.test/ws', createSocket: (url) => sockets.create(url),
    schedule: (run, ms) => scheduler.schedule(run, ms), random: () => 0.5 });
  const loop = createGameLoop(feed, () => `control-${String(++ids)}`);
  feed.connect(); sockets.last().fireOpen();
  const receive = (message: ServerMessage) => { sockets.last().fireMessage(JSON.stringify(message)); };
  const frame = (overrides: Partial<Frame> = {}) => testFrame({
    session: 'current-game', rev: 1, step: 10,
    clock: { phase: 'preBell', day: 1, priceIndex: 0, stepsLeft: 290, pace: 3 }, ...overrides,
  });
  return { feed, loop, sockets, scheduler, receive, frame };
}

describe('clock-control recovery', () => {
  it('does not carry a refusal into a replacement game', () => {
    const h = harness(); h.receive(h.frame()); h.loop.nextDay();
    h.receive({ t: 'reply', frame: h.frame({ rev: 2 }), receipt: { commandId: 'control-1', kind: 'nextDay', step: 10, outcome: 'rejected', reason: 'wrongPhase' } });
    expect(h.loop.controls.get().reason).toBe('wrongPhase');
    h.receive(h.frame({ session: 'new-game', rev: 0 }));
    expect(h.loop.controls.get().reason).toBeNull();
    h.feed.close(); h.loop.dispose();
  });

  it('keeps screen snapshots stable on quote and clock updates while the top bar follows server time', () => {
    const h = harness(); h.receive(h.frame());
    const screen = h.loop.screen.get(); const bar = h.loop.topBar.get();
    h.receive(h.frame({ prices: [9000, 4200, 12000, 2800, 6500, 15000] }));
    expect(h.loop.screen.get()).toBe(screen); expect(h.loop.topBar.get()).toBe(bar);
    h.receive(h.frame({ step: 11, clock: { phase: 'preBell', day: 1, priceIndex: 0, stepsLeft: 289, pace: 3 } }));
    expect(h.loop.screen.get()).toBe(screen);
    expect(h.loop.topBar.get()?.stepsLeft).toBe(289);
    h.loop.dispose();
    h.receive(h.frame({ step: 12 }));
    expect(h.loop.topBar.get()?.stepsLeft).toBe(289);
    h.feed.close();
  });

  it('ignores incompatible quote batches when judging a resumed whole frame', () => {
    const h = harness(); h.receive(h.frame()); h.loop.openBell();
    for (const change of [{ session: 'other' }, { day: 2 }, { rev: 2 }]) {
      h.receive({ t: 'quotes', session: 'current-game', day: 1, rev: 1, step: 100, priceIndex: 0, prices: [], changes: [], ...change });
    }
    h.feed.simulateDrop(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    h.receive(h.frame({ step: 11 }));
    expect(h.loop.controls.get()).toMatchObject({ ready: true, retryAllowed: true });
    h.feed.close(); h.loop.dispose();
  });

  it.each(['start', 'openBell', 'skipToBell', 'nextDay'] as const)('reconciles %s receipts before offering retry, including an equal frame', (kind) => {
    const h = harness();
    const phase = kind === 'start' ? 'lobby' : kind === 'skipToBell' ? 'open' : kind === 'nextDay' ? 'debrief' : 'preBell';
    h.receive(h.frame({ clock: { phase, day: kind === 'start' ? 0 : 1, priceIndex: 0, stepsLeft: 100, pace: kind === 'start' ? null : 3 } }));
    if (kind === 'start') h.loop.start(7.5); else h.loop[kind]();
    const command = JSON.parse(h.sockets.last().sent.at(-1)!) as { commandId: string };
    h.feed.simulateDrop(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    const retryOffered: boolean[] = [];
    h.loop.controls.subscribe(() => { retryOffered.push(h.loop.controls.get().retryAllowed); });
    h.receive(h.frame({ receipts: [{ commandId: command.commandId, kind, step: 10, outcome: 'accepted' }] }));
    expect(h.loop.controls.get()).toMatchObject({ ready: true, checking: false, retryAllowed: false, reason: null });
    expect(retryOffered).not.toContain(true);
    expect(h.sockets.last().sent).toHaveLength(1);
    h.feed.close(); h.loop.dispose();
  });

  it.each(['start', 'openBell', 'skipToBell', 'nextDay'] as const)('retains the original %s payload when its delayed retry is refused', (kind) => {
    const h = harness(); h.receive(h.frame());
    if (kind === 'start') h.loop.start(7.5); else h.loop[kind]();
    const original = h.sockets.last().sent.at(-1)!;
    const command = JSON.parse(original) as { commandId: string };
    h.loop.openBell(); h.loop.start(1); // unresolved intent blocks conflicting controls
    expect(h.sockets.last().sent).toHaveLength(2);
    h.feed.simulateDrop(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    const tomorrow = h.frame({ step: 950, clock: { phase: 'preBell', day: 2, priceIndex: 0, stepsLeft: 250, pace: 3 } });
    h.receive(tomorrow);
    h.loop.retry(); h.loop.retry();
    expect(h.sockets.last().sent).toHaveLength(2);
    expect(h.sockets.last().sent.at(-1)).toBe(original);
    h.receive({ t: 'reply', frame: tomorrow, receipt: { commandId: command.commandId, kind, step: 950, outcome: 'rejected', reason: kind === 'start' ? 'alreadyStarted' : 'wrongDay' } });
    expect(h.loop.controls.get()).toMatchObject({ checking: false, retryAllowed: false, reason: kind === 'start' ? 'alreadyStarted' : 'wrongDay' });
    h.feed.close(); h.loop.dispose();
  });

  it('keeps a false send unresolved and ignores stale or mismatching receipts', () => {
    const h = harness(); h.receive(h.frame());
    h.sockets.last().readyState = 3; // dying socket, before its close event
    h.loop.openBell();
    expect(h.sockets.last().sent).toHaveLength(1);
    expect(h.loop.controls.get()).toMatchObject({ ready: false, checking: true });
    h.sockets.last().fireClose(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    h.receive(h.frame({ step: 9, receipts: [{ commandId: 'control-1', kind: 'openBell', step: 9, outcome: 'accepted' }] }));
    expect(h.loop.controls.get()).toMatchObject({ ready: false, checking: true });
    h.receive(h.frame({ receipts: [{ commandId: 'control-1', kind: 'start', step: 10, outcome: 'accepted' }] }));
    expect(h.loop.controls.get()).toMatchObject({ ready: true, checking: true, retryAllowed: true });
    h.loop.retry();
    expect(JSON.parse(h.sockets.last().sent.at(-1)!)).toEqual({ t: 'openBell', commandId: 'control-1', day: 1 });
    h.feed.close(); h.loop.dispose();
  });

  it('keeps server errors uncertain until current state arrives and never enables on socket open alone', () => {
    const h = harness(); h.loop.start(3);
    expect(h.sockets.last().sent).toHaveLength(1);
    expect(h.loop.screen.get()).toBeNull();
    h.receive(h.frame()); h.loop.openBell();
    h.receive({ t: 'error', code: 'tooManyCommands', commandId: 'control-1' });
    expect(h.loop.controls.get()).toMatchObject({ ready: false, checking: true, reason: null });
    h.loop.retry(); expect(h.sockets.last().sent).toHaveLength(2);
    h.receive(h.frame());
    expect(h.loop.controls.get()).toMatchObject({ ready: true, checking: true, retryAllowed: true, reason: null });
    h.feed.close(); h.loop.dispose();
  });

  it('drops an old intent when a new session arrives without an error', () => {
    const h = harness(); h.receive(h.frame()); h.loop.openBell();
    h.feed.simulateDrop(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    h.receive(h.frame({ session: 'another-game' })); h.loop.retry();
    expect(h.loop.controls.get()).toMatchObject({ ready: true, checking: false, retryAllowed: false });
    expect(h.sockets.last().sent).toHaveLength(1);
    h.feed.close(); h.loop.dispose();
  });

  it('clears old intent on noSession and waits for a replacement frame', () => {
    const h = harness(); h.receive(h.frame()); h.loop.openBell();
    h.receive({ t: 'error', code: 'noSession' });
    expect(h.loop.controls.get()).toMatchObject({ ready: false, checking: false, retryAllowed: false });
    h.receive(h.frame({ step: 11 }));
    expect(h.loop.controls.get().ready).toBe(false);
    h.receive(h.frame({ session: 'replacement-game', rev: 0, step: 0, clock: { phase: 'lobby', day: 0, priceIndex: 0, stepsLeft: 0, pace: null } }));
    expect(h.loop.screen.get()?.phase).toBe('lobby');
    expect(h.loop.controls.get()).toMatchObject({ ready: true, checking: false, retryAllowed: false });
    const sent = h.sockets.last().sent.length;
    h.loop.retry(); expect(h.sockets.last().sent).toHaveLength(sent);
    h.feed.close(); h.loop.dispose();
  });

  it('does not accept a whole frame behind a compatible quote watermark as resumed state', () => {
    const h = harness(); h.receive(h.frame()); h.loop.openBell();
    h.receive({ t: 'quotes', session: 'current-game', day: 1, rev: 1, step: 20, priceIndex: 0, prices: [], changes: [] });
    h.feed.simulateDrop(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    h.receive(h.frame({ step: 19 }));
    expect(h.loop.controls.get()).toMatchObject({ ready: false, checking: true, retryAllowed: false });
    h.receive({ t: 'quotes', session: 'current-game', day: 1, rev: 1, step: 21, priceIndex: 0, prices: [], changes: [] });
    expect(h.loop.controls.get().ready).toBe(false);
    h.receive(h.frame({ step: 21 }));
    expect(h.loop.controls.get().retryAllowed).toBe(true);
    h.feed.close(); h.loop.dispose();
  });

  it('offers explicit retry only after a fresh whole frame and resends the original command', () => {
    const h = harness();
    h.receive(h.frame()); h.loop.openBell();
    const original = h.sockets.last().sent.at(-1);
    h.feed.simulateDrop(); h.scheduler.runNext(); h.sockets.last().fireOpen();
    expect(h.loop.controls.get()).toMatchObject({ ready: false, checking: true });
    expect(h.sockets.last().sent).toHaveLength(1); // hello only
    h.receive(h.frame({ step: 11 }));
    expect(h.loop.controls.get()).toMatchObject({ ready: true, checking: true, retryAllowed: true });
    h.loop.retry();
    expect(h.sockets.last().sent.at(-1)).toBe(original);
    expect(h.loop.controls.get()).toMatchObject({ retryAllowed: false, checking: true });
    h.feed.close(); h.loop.dispose();
  });
});
