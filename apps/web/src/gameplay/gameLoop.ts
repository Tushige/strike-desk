import type { Feed } from '@strike-desk/shared/feed';
import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { ClockCommand, Frame, FrameOrder, StartCommand } from '@strike-desk/shared/protocol';
import type { Pace } from '@strike-desk/shared/time';
import type { TopBarProps } from '../modules/desk/index';
import type { ReadSlice } from '../modules/order-ticket/index';

type Control = StartCommand | ClockCommand;
export interface GameScreen {
  session: string;
  phase: Frame['clock']['phase'];
  day: number;
  days: Frame['days'];
  final: NonNullable<Frame['final']> | null;
}
export interface ControlState {
  ready: boolean;
  checking: boolean;
}

/** Small structural snapshots; no quote arrays or browser clock enter them. */
function slice<T>(initial: T): ReadSlice<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (JSON.stringify(value) === JSON.stringify(next)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** One clock intent at a time, using the page's existing transport. */
export function createGameLoop(feed: Feed, makeId: () => string) {
  const screen = slice<GameScreen | null>(null);
  const topBar = slice<TopBarProps | null>(null);
  const controls = slice<ControlState>({ ready: false, checking: false });
  let held: FrameOrder | null = null;
  let pending: Control | null = null;
  let ready = false;

  function publishControls(): void { controls.set({ ready, checking: pending !== null }); }
  function send(command: Control): void {
    if (!ready || pending !== null) return;
    pending = command;
    publishControls();
    if (!feed.send(command)) { ready = false; publishControls(); }
  }
  function clock(t: ClockCommand['t']): void {
    const current = screen.get();
    if (current === null || current.day < 1 || !ready || pending !== null) return;
    send({ t, day: current.day, commandId: makeId() });
  }
  const dispose = feed.subscribe((event) => {
    if (event.type === 'status') {
      if (event.status !== 'live') ready = false;
      const previous = topBar.get();
      if (previous !== null) topBar.set({ ...previous, line: ready ? 'live' : 'offline' });
      publishControls();
      return;
    }
    const message = event.message;
    if (message.t !== 'frame' && message.t !== 'reply') return;
    const frame = message.t === 'reply' ? message.frame : message;
    if (!isNewerFrame(held, frame)) return;
    if (held !== null && held.session !== frame.session) pending = null;
    held = { session: frame.session, rev: frame.rev, step: frame.step };
    ready = true;
    const receipts = message.t === 'reply' ? [...frame.receipts, message.receipt] : frame.receipts;
    if (pending !== null && receipts.some((receipt) => receipt.commandId === pending?.commandId && receipt.kind === pending.t)) pending = null;
    screen.set({ session: frame.session, phase: frame.clock.phase, day: frame.clock.day, days: frame.days, final: frame.final ?? null });
    topBar.set({ worthCents: frame.account.worthCents, cashCents: frame.account.cashCents, day: frame.clock.day,
      phase: frame.clock.phase, stepsLeft: frame.clock.stepsLeft, pace: frame.clock.pace, line: 'live' });
    publishControls();
  });
  return {
    screen, topBar, controls, dispose,
    start: (pace: Pace) => { if (ready && pending === null) send({ t: 'start', pace, commandId: makeId() }); },
    openBell: () => { clock('openBell'); },
    skipToBell: () => { clock('skipToBell'); },
    nextDay: () => { clock('nextDay'); },
  };
}
export type GameLoop = ReturnType<typeof createGameLoop>;
