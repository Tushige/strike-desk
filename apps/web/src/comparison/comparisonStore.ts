import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { DraftMessage, Frame, FrameOrder, ServerMessage } from '@strike-desk/shared/protocol';
import type { FeedStatus } from '@strike-desk/shared/feed';
import type { ReadSlice, TicketAccount, TicketDraft, TicketQuote } from '../modules/order-ticket/index';

export interface ComparisonOverview {
  session: string | null;
  day: number;
  phase: Frame['clock']['phase'];
  board: Frame['board'];
  companies: Frame['companies'];
  status: FeedStatus;
}

export interface ComparisonStore {
  ingest: (message: ServerMessage) => void;
  setStatus: (status: FeedStatus) => void;
  setRequestedDraft: (draft: TicketDraft) => void;
  sendDraft: (draft: TicketDraft) => void;
  overview: ReadSlice<ComparisonOverview>;
  account: ReadSlice<TicketAccount>;
  quote: ReadSlice<TicketQuote | null>;
  requested: ReadSlice<TicketDraft>;
}

function slice<T>(initial: T): ReadSlice<T> & { set: (next: T) => void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(value, next)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

function sameBoard(a: Frame['board'], b: Frame['board']): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.targetsPerCompany !== b.targetsPerCompany || a.companies.length !== b.companies.length) return false;
  return a.companies.every((one, index) => {
    const other = b.companies[index];
    return other !== undefined && one.lowestUpIndex === other.lowestUpIndex && one.highestDownIndex === other.highestDownIndex &&
      one.targets.length === other.targets.length && one.targets.every((target, i) => target === other.targets[i]) &&
      one.simpleUp.every((target, i) => target === other.simpleUp[i]) && one.simpleDown.every((target, i) => target === other.simpleDown[i]);
  });
}

function sameDraft(a: TicketDraft, b: TicketDraft): boolean {
  return a.contractId === b.contractId && a.spendCents === b.spendCents;
}

/** Public selection data and one answer, fed by the page's existing transport. */
export function createComparisonStore(send: (message: DraftMessage) => boolean): ComparisonStore {
  let held: FrameOrder | null = null;
  let day = 0;
  const overview = slice<ComparisonOverview>({ session: null, day: 0, phase: 'lobby', board: null, companies: [], status: 'closed' });
  const account = slice<TicketAccount>({ cashCents: 0, capCents: 0, minTicketCents: 0, canBuy: false });
  const requested = slice<TicketDraft>({ contractId: null, spendCents: null });
  let pending: TicketDraft | null = null;
  let ready = false;
  let answer: TicketQuote | null = null;
  const listeners = new Set<() => void>();
  function setAnswer(next: TicketQuote | null): void {
    if (answer === next || (answer !== null && next !== null &&
      answer.contractId === next.contractId && answer.spendCents === next.spendCents && answer.priceCents === next.priceCents &&
      answer.costCents === next.costCents && answer.quantity === next.quantity && answer.limitPriceCents === next.limitPriceCents &&
      answer.breakEvenCents === next.breakEvenCents && answer.whatIf.length === next.whatIf.length &&
      answer.whatIf.every((stop, index) => stop.atCents === next.whatIf[index]?.atCents && stop.profitCents === next.whatIf[index]?.profitCents))) return;
    answer = next;
    listeners.forEach((fn) => { fn(); });
  }

  function flushDraft(): void {
    if (ready && pending !== null && send({ t: 'draft', ...pending })) pending = null;
  }

  function setRequestedDraft(draft: TicketDraft): void {
    if (sameDraft(requested.get(), draft)) return;
    pending = null;
    setAnswer(null);
    requested.set({ contractId: draft.contractId, spendCents: draft.spendCents });
  }

  return {
    overview,
    account,
    requested,
    setRequestedDraft,
    sendDraft(draft) {
      if (!sameDraft(requested.get(), draft)) return;
      pending = { contractId: draft.contractId, spendCents: draft.spendCents };
      flushDraft();
    },
    setStatus(status) {
      if (status !== 'live') ready = false;
      if (status !== overview.get().status) overview.set({ ...overview.get(), status });
    },
    ingest(message: ServerMessage): void {
      if (message.t === 'quotes') {
        if (held === null || message.session !== held.session || message.rev !== held.rev || message.day !== day || !isNewerFrame(held, message)) return;
        held = { session: message.session, rev: message.rev, step: message.step };
        for (const [id, price, , , breakEven] of message.changes) {
          if (answer !== null && id === answer.contractId && (price !== answer.priceCents || breakEven !== answer.breakEvenCents)) setAnswer(null);
        }
        return;
      }
      const frame = message.t === 'frame' ? message : message.t === 'reply' ? message.frame : null;
      if (frame === null || !isNewerFrame(held, frame)) return;
      if (held !== null && (held.session !== frame.session || day !== frame.clock.day)) {
        pending = null;
        setRequestedDraft({ contractId: null, spendCents: null });
        setAnswer(null);
      }
      held = { session: frame.session, rev: frame.rev, step: frame.step };
      day = frame.clock.day;
      ready = true;
      flushDraft();
      const previous = overview.get();
      const board = sameBoard(previous.board, frame.board) ? previous.board : frame.board;
      const companies = previous.companies.length === frame.companies.length && previous.companies.every((company, index) =>
        company.name === frame.companies[index]?.name && company.ticker === frame.companies[index]?.ticker) ? previous.companies : frame.companies;
      if (previous.session !== frame.session || previous.day !== day || previous.phase !== frame.clock.phase || previous.board !== board || previous.companies !== companies) {
        overview.set({ session: frame.session, day, phase: frame.clock.phase, board, companies, status: previous.status });
      }
      const before = account.get();
      if (before.cashCents !== frame.account.cashCents || before.capCents !== frame.account.capCents || before.canBuy !== frame.account.canBuy || before.minTicketCents !== frame.minTicketCents) {
        account.set({ cashCents: frame.account.cashCents, capCents: frame.account.capCents, canBuy: frame.account.canBuy, minTicketCents: frame.minTicketCents });
      }
      const draft = frame.draft;
      const ticket = draft?.ticket;
      if (draft === undefined || ticket === undefined || !sameDraft(draft, requested.get()) || ticket.contractId !== requested.get().contractId || ticket.priceCents !== frame.quotes[ticket.contractId] || ticket.breakEvenCents !== frame.quoteBreakEvens[ticket.contractId]) {
        setAnswer(null);
        return;
      }
      setAnswer({ contractId: ticket.contractId, spendCents: draft.spendCents, priceCents: ticket.priceCents, costCents: ticket.costCents, quantity: ticket.quantity, limitPriceCents: ticket.limitPriceCents, breakEvenCents: ticket.breakEvenCents, whatIf: ticket.whatIf });
    },
    quote: { get: (): TicketQuote | null => answer, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
  };
}
