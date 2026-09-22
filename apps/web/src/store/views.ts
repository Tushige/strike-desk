import type { Frame } from '@strike-desk/shared/protocol';
import type { GameStore } from './gameStore';
import { deriveSlice, sameFields } from './derive';

function records<T extends object>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || a.length === b.length && a.every((value, i) => sameFields(value, b[i] ?? null));
}
function numbers(a: readonly number[], b: readonly number[]): boolean {
  return a === b || a.length === b.length && a.every((value, i) => value === b[i]);
}
function board(a: Frame['board'], b: Frame['board']): boolean {
  return a === b || a !== null && b !== null && a.targetsPerCompany === b.targetsPerCompany &&
    a.companies.length === b.companies.length && a.companies.every((c, i) => {
      const d = b.companies[i];
      return d !== undefined && c.lowestUpIndex === d.lowestUpIndex && c.highestDownIndex === d.highestDownIndex &&
        numbers(c.targets, d.targets) && numbers(c.simpleUp, d.simpleUp) && numbers(c.simpleDown, d.simpleDown);
    });
}
function positions(a: Frame['positions'], b: Frame['positions']): boolean {
  return a === b || a.length === b.length && a.every((p, i) => {
    const q = b[i];
    if (q === undefined || !sameFields(p.exit ?? null, q.exit ?? null)) return false;
    return sameFields({ ...p, exit: undefined }, { ...q, exit: undefined });
  });
}
function draft(a: Frame['draft'], b: Frame['draft']): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.contractId !== b.contractId || a.spendCents !== b.spendCents) return false;
  const x = a.ticket, y = b.ticket;
  if (x === y) return true;
  return x !== undefined && y !== undefined && records(x.whatIf, y.whatIf) &&
    sameFields({ ...x, whatIf: undefined }, { ...y, whatIf: undefined });
}
export function createGameViews(store: GameStore) {
  const screen = (same: (a: Frame, b: Frame) => boolean) => deriveSlice(store.frame, (f) => f,
    (a, b) => a === b || a !== null && b !== null && same(a, b));
  const identity = (a: Frame, b: Frame) => a.session === b.session && a.clock.phase === b.clock.phase && a.clock.day === b.clock.day && a.stress === b.stress;
  return {
    routing: deriveSlice(store.frame, (f) => f === null ? null : { session: f.session, phase: f.clock.phase }, sameFields),
    clock: deriveSlice(store.frame, (f) => f?.clock ?? null, sameFields),
    account: deriveSlice(store.frame, (f) => f?.account ?? null, sameFields),
    news: deriveSlice(store.frame, (f) => f?.news ?? [], records),
    days: deriveSlice(store.frame, (f) => f?.days ?? [], records),
    final: deriveSlice(store.frame, (f) => f?.final ?? null, sameFields),
    // Screens get stable authoritative snapshots of only the fields they consume.
    desk: screen((a, b) => identity(a, b) && board(a.board, b.board) && records(a.news, b.news) &&
      a.positions.length === b.positions.length && a.positions.every((p, i) => p.id === b.positions[i]?.id && p.status === b.positions[i]?.status)),
    comparison: screen((a, b) => identity(a, b) && board(a.board, b.board) && sameFields(a.account, b.account)),
    ticket: screen((a, b) => identity(a, b) && board(a.board, b.board) && numbers(a.quotes, b.quotes) &&
      draft(a.draft, b.draft) && sameFields(a.account, b.account) && positions(a.positions, b.positions) && records(a.days, b.days) && records(a.news, b.news)),
    chart: screen((a, b) => identity(a, b) && a.clock.priceIndex === b.clock.priceIndex && board(a.board, b.board) &&
      numbers(a.prices, b.prices) && numbers(a.quoteBreakEvens, b.quoteBreakEvens) && positions(a.positions, b.positions) && records(a.news, b.news)),
    top: screen((a, b) => identity(a, b) && a.step === b.step && a.clock.pace === b.clock.pace && sameFields(a.account, b.account) && records(a.days, b.days)),
    review: screen((a, b) => identity(a, b) && sameFields(a.final ?? null, b.final ?? null) && records(a.days, b.days) && positions(a.positions, b.positions)),
  };
}
