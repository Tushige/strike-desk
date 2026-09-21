import type { Feed } from '@strike-desk/shared/feed';
import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { ClockCommand, Frame, FrameOrder, RejectReason, StartCommand } from '@strike-desk/shared/protocol';
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
  retryAllowed: boolean;
  reason: RejectReason | null;
}

export interface GameLoop {
  screen: ReadSlice<GameScreen | null>;
  topBar: ReadSlice<TopBarProps | null>;
  controls: ReadSlice<ControlState>;
  start: (pace: Pace) => void;
  openBell: () => void;
  skipToBell: () => void;
  nextDay: () => void;
  retry: () => void;
  dispose: () => void;
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
export function createGameLoop(feed: Feed, makeId: () => string): GameLoop {
  const screen = slice<GameScreen | null>(null);
  const topBar = slice<TopBarProps | null>(null);
  const controls = slice<ControlState>({ ready: false, checking: false, retryAllowed: false, reason: null });
  let held: FrameOrder | null = null;
  let pending: { session: string; command: Readonly<Control>; interrupted: boolean } | null = null;
  let ready = false;
  let reason: RejectReason | null = null;
  let lostSession: string | null = null;

  function publishControls(): void {
    controls.set({ ready, checking: pending !== null, retryAllowed: ready && pending?.interrupted === true, reason });
  }
  function send(command: Control): void {
    if (!ready || pending !== null || held === null) return;
    pending = { session: held.session, command: Object.freeze(command), interrupted: false };
    reason = null;
    publishControls();
    if (!feed.send(command)) {
      pending.interrupted = true;
      ready = false;
      publishControls();
    }
  }
  function clock(t: ClockCommand['t']): void {
    const current = screen.get();
    if (current === null || current.day < 1 || !ready || pending !== null) return;
    send({ t, day: current.day, commandId: makeId() });
  }
  const dispose = feed.subscribe((event) => {
    if (event.type === 'status') {
      if (event.status !== 'live') {
        ready = false;
        if (pending !== null) pending.interrupted = true;
      }
      const previous = topBar.get();
      if (previous !== null) topBar.set({ ...previous, line: ready ? 'live' : 'offline' });
      publishControls();
      return;
    }
    const message = event.message;
    if (message.t === 'error') {
      ready = false;
      if (message.code === 'noSession') {
        lostSession = held?.session ?? null;
        pending = null;
        reason = null;
      } else if (pending !== null) pending.interrupted = true;
      const previous = topBar.get();
      if (previous !== null) topBar.set({ ...previous, line: 'offline' });
      publishControls();
      return;
    }
    if (message.t === 'quotes') {
      if (held !== null && message.session === held.session && message.rev === held.rev &&
        message.day === screen.get()?.day && isNewerFrame(held, message)) {
        held = { session: message.session, rev: message.rev, step: message.step };
      }
      return;
    }
    if (message.t !== 'frame' && message.t !== 'reply') return;
    const frame = message.t === 'reply' ? message.frame : message;
    if (frame.session === lostSession || !isNewerFrame(held, frame)) return;
    if (held !== null && held.session !== frame.session) { pending = null; reason = null; }
    held = { session: frame.session, rev: frame.rev, step: frame.step };
    ready = true;
    const receipts = message.t === 'reply' ? [...frame.receipts, message.receipt] : frame.receipts;
    if (pending !== null && pending.session === frame.session) {
      const command = pending.command;
      const receipt = receipts.find((one) => one.commandId === command.commandId && one.kind === command.t);
      if (receipt !== undefined) {
        reason = receipt.outcome === 'rejected' ? receipt.reason ?? null : null;
        pending = null;
      }
    }
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
    retry: () => {
      if (!ready || pending === null || !pending.interrupted || pending.session !== held?.session) return;
      pending.interrupted = false;
      publishControls();
      if (!feed.send(pending.command)) { pending.interrupted = true; ready = false; publishControls(); }
    },
  };
}
