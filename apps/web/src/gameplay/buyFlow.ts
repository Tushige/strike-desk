import type { Feed } from '@strike-desk/shared/feed';
import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { BuyCommand, CashOutCommand, Frame, FrameOrder, PositionView, Receipt } from '@strike-desk/shared/protocol';
import type { LineState, OpenTicket, ReadSlice, SubmitOutcome } from '../modules/order-ticket/index';

export interface BuyPurchase {
  session: string;
  companyName: string;
  ticker: string;
  position: PositionView;
}
type TradeIntent = {
  session: string;
  originalDay: number;
  command: Readonly<BuyCommand> | Readonly<CashOutCommand>;
};
export interface BuyTransaction extends TradeIntent {
  interrupted: boolean;
  sent: boolean;
  retryAllowed: boolean;
  gameGone: boolean;
  afterBell?: boolean;
  outcome?: SubmitOutcome;
  purchase?: BuyPurchase;
}
export interface BuyAvailability {
  session: string | null;
  day: number;
  phase: Frame['clock']['phase'];
  stress: boolean;
  ready: boolean;
  retryAllowed: boolean;
}
export interface BuyFlow {
  submit(command: BuyCommand): Promise<SubmitOutcome>;
  submitCashOut(command: CashOutCommand): Promise<SubmitOutcome>;
  retry(): void;
  dispose(): void;
  transaction: ReadSlice<BuyTransaction | null>;
  purchase: ReadSlice<BuyPurchase | null>;
  cashOutPosition: ReadSlice<OpenTicket | null>;
  availability: ReadSlice<BuyAvailability>;
}

function slice<T>(initial: T): ReadSlice<T> & { set(value: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return { get: () => value, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { if (JSON.stringify(next) === JSON.stringify(value)) return; value = next; listeners.forEach((listener) => { listener(); }); } };
}

/** One retained trade intent on the page's existing connection, never an automatic resend. */
export function createBuyFlow(feed: Feed, freshness: ReadSlice<{ line: LineState; waiting: boolean; ageSeconds: number | null }>): BuyFlow {
  const transaction = slice<BuyTransaction | null>(null);
  const purchase = slice<BuyPurchase | null>(null);
  const cashOutPosition = slice<OpenTicket | null>(null);
  const availability = slice<BuyAvailability>({ session: null, day: 0, phase: 'lobby', stress: false, ready: false, retryAllowed: false });
  let held: FrameOrder | null = null;
  let current: Frame | null = null;
  let recovered = false;
  let awaitingRecoveryData = false;
  let disposed = false;
  const retired = new Set<string>();
  let pending: { promise: Promise<SubmitOutcome>; resolve: (outcome: SubmitOutcome) => void } | null = null;

  function publish(): void {
    const record = transaction.get();
    const ready = recovered && !awaitingRecoveryData && held !== null && freshness.get().line === 'live' && !disposed;
    const retryAllowed = ready && record !== null && record.outcome === undefined && record.interrupted && record.session === held?.session;
    if (record !== null && record.retryAllowed !== retryAllowed) transaction.set({ ...record, retryAllowed });
    availability.set({ session: held?.session ?? null, day: current?.clock.day ?? 0,
      phase: current?.clock.phase ?? 'lobby', stress: current?.stress ?? false, ready, retryAllowed });
  }
  function finish(outcome: SubmitOutcome, gameGone = false, evidence?: Frame): void {
    const record = transaction.get();
    if (record === null || record.outcome !== undefined) return;
    const matches = (item: PositionView) => outcome.outcome === 'accepted' && item.id === outcome.receipt.positionId && item.day === record.originalDay;
    const source = current?.session === record.session && current.positions.some(matches) ? current : evidence;
    const position = source?.session === record.session ? source.positions.find(matches) : undefined;
    const afterBell = current?.session === record.session && (current.clock.day > record.originalDay ||
      (current.clock.day === record.originalDay && (current.clock.phase === 'debrief' || current.clock.phase === 'final')) || position?.status === 'settled');
    transaction.set({ ...record, outcome, retryAllowed: false, gameGone, afterBell,
      ...(position === undefined || source === undefined ? {} : { purchase: bought(source, position) }) });
    pending?.resolve(outcome);
    publish();
  }
  function interrupt(): void {
    recovered = false;
    const record = transaction.get();
    if (record !== null && record.outcome === undefined) transaction.set({ ...record, interrupted: true, retryAllowed: false });
    publish();
  }
  function answer(receipts: readonly Receipt[], session: string, evidence?: Frame): void {
    const record = transaction.get();
    if (record === null || record.session !== session || record.outcome !== undefined) return;
    const receipt = receipts.find((item) => item.kind === record.command.t && item.commandId === record.command.commandId &&
      (record.command.t !== 'cashOut' || item.outcome !== 'accepted' || item.positionId === record.command.positionId));
    if (receipt !== undefined) finish({ outcome: receipt.outcome, receipt }, false, evidence);
  }
  function bought(frame: Frame, position: PositionView): BuyPurchase {
    const company = frame.companies[position.companyId]!;
    return { session: frame.session, companyName: company.name, ticker: company.ticker, position };
  }
  function samePurchase(a: BuyPurchase | null, b: BuyPurchase | null): boolean {
    if (a === null || b === null) return a === b;
    const displayed = (item: BuyPurchase) => ({ session: item.session, companyName: item.companyName, ticker: item.ticker,
      id: item.position.id, day: item.position.day, side: item.position.side, target: item.position.targetCents,
      entry: item.position.entryPriceCents, quantity: item.position.quantity, cost: item.position.costCents,
      status: item.position.status, exit: item.position.exit,
      profit: item.position.status === 'open' ? null : item.position.profitCents });
    return JSON.stringify(displayed(a)) === JSON.stringify(displayed(b));
  }
  const unsubscribe = feed.subscribe((event) => {
    if (disposed) return;
    if (event.type === 'status') {
      if (event.status !== 'live') { awaitingRecoveryData = held !== null; interrupt(); }
      return;
    }
    const message = event.message;
    if (message.t === 'error') {
      interrupt();
      if (message.code === 'noSession') {
        if (held !== null) retired.add(held.session);
        finish({ outcome: 'lost' }, true);
      } else if (message.code === 'badMessage' && message.commandId === transaction.get()?.command.commandId) finish({ outcome: 'lost' });
      return;
    }
    if (message.t === 'quotes') {
      if (held !== null && message.session === held.session && message.rev === held.rev && message.day === current?.clock.day && isNewerFrame(held, message)) {
        held = { session: message.session, rev: message.rev, step: message.step };
        if (recovered) awaitingRecoveryData = false;
        publish();
      }
      return;
    }
    if (message.t !== 'frame' && message.t !== 'reply') return;
    const frame = message.t === 'reply' ? message.frame : message;
    if (retired.has(frame.session)) return;
    // Receipt evidence may arrive behind the current display watermark, but
    // the answer's presentation always uses the newest accepted state.
    if (!isNewerFrame(held, frame)) {
      if (message.t === 'reply') answer([message.receipt], frame.session, frame);
      return;
    }
    if (held !== null && held.session !== frame.session) {
      retired.add(held.session);
      finish({ outcome: 'lost' });
    }
    held = { session: frame.session, rev: frame.rev, step: frame.step };
    current = frame;
    if (message.t === 'reply') answer([message.receipt], frame.session);
    answer(frame.receipts, frame.session);
    const position = frame.positions.find((item) => item.day === frame.clock.day);
    cashOutPosition.set(position?.status === 'open' && !frame.stress ? {
      positionId: position.id, companyName: frame.companies[position.companyId]!.name, ticker: frame.companies[position.companyId]!.ticker,
      side: position.side, targetCents: position.targetCents, quantity: position.quantity, costCents: position.costCents,
      valueCents: position.valueCents, profitCents: position.profitCents, realCents: position.realCents,
      hopeCents: position.hopeCents, breakEvenCents: position.breakEvenCents,
    } : null);
    const nextPurchase = position === undefined ? null : bought(frame, position);
    if (!samePurchase(purchase.get(), nextPurchase)) purchase.set(nextPurchase);
    const record = transaction.get();
    if (record?.session === frame.session && record.outcome?.outcome === 'accepted') {
      const positionId = record.outcome.receipt.positionId;
      const original = frame.positions.find((item) => item.day === record.originalDay && item.id === positionId);
      if (original !== undefined) {
        const retained = bought(frame, original);
        if (!samePurchase(record.purchase ?? null, retained)) transaction.set({ ...record, purchase: retained });
      }
    }
    if (recovered) awaitingRecoveryData = false;
    recovered = true;
    publish();
  });
  const unsubscribeFreshness = freshness.subscribe(() => {
    // Freshness runs before this listener's frame reconciliation. Only incoming
    // accepted data may enable retry, after its receipts have been checked.
    if (freshness.get().line !== 'live') interrupt();
  });
  function send(): void {
    const record = transaction.get();
    if (record === null) return;
    const sent = feed.send(record.command);
    if (transaction.get()?.outcome === undefined) transaction.set({ ...transaction.get()!, sent: record.sent || sent });
    if (!sent) interrupt();
  }
  function submit(command: BuyCommand | CashOutCommand): Promise<SubmitOutcome> {
      const record = transaction.get();
      if (record !== null && record.command.t === command.t && record.command.commandId === command.commandId && pending !== null) return pending.promise;
      if (disposed || held === null || retired.has(held.session) || (record !== null && record.outcome === undefined)) return Promise.resolve({ outcome: 'lost' });
      const originalDay = command.t === 'buy' ? command.day : current?.positions.find((item) => item.id === command.positionId)?.day;
      if (originalDay === undefined) return Promise.resolve({ outcome: 'lost' });
      let resolve!: (outcome: SubmitOutcome) => void;
      const promise = new Promise<SubmitOutcome>((done) => { resolve = done; });
      pending = { promise, resolve };
      transaction.set({ session: held.session, originalDay, command: Object.freeze({ ...command }), interrupted: false, sent: false, retryAllowed: false, gameGone: false });
      publish(); send(); return promise;
  }
  return { transaction, purchase, cashOutPosition, availability, submit, submitCashOut: submit,
    retry() {
      const record = transaction.get();
      if (record === null || !record.retryAllowed || record.session !== held?.session || disposed) return;
      transaction.set({ ...record, interrupted: false, retryAllowed: false });
      publish(); send();
    },
    dispose() { if (disposed) return; disposed = true; unsubscribe(); unsubscribeFreshness(); finish({ outcome: 'lost' }); publish(); },
  };
}
