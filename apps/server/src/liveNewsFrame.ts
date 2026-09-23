import { frameFor, quoteDraft } from '@strike-desk/shared/engine';
import type { DraftRequest, Frame, NewsView, Session } from '@strike-desk/shared/engine';

/** Decorate one connection's picture using its own already-projected prices. */
export function withDraft(frame: Frame, request: DraftRequest | undefined): Frame {
  if (request === undefined || frame.board === null) return frame;
  const draft = quoteDraft(request, frame.board, frame.quotes);
  return draft === null ? frame : { ...frame, draft };
}

/** Public news beside the live board and authoritative game results. */
export function liveNewsFrameFor(session: Session, playerId: string, nowMs: number, history = false): { session: Session; frame: Frame } {
  const projected = frameFor(session, playerId, nowMs, { history, sections: 'full' });
  return { session: projected.session, frame: previewFrame(projected.frame) };
}

/** Explicit public preview fields, shared by command answers and samples. */
export function previewFrame(source: Frame): Frame {
  const frame: Frame = {
    t: 'frame',
    session: source.session,
    rev: source.rev,
    step: source.step,
    clock: source.clock,
    companies: source.companies,
    prices: source.prices,
    minTicketCents: source.minTicketCents,
    board: source.board,
    quotes: source.quotes,
    quoteReals: source.quoteReals,
    quoteHopes: source.quoteHopes,
    quoteBreakEvens: source.quoteBreakEvens,
    news: source.news.map((item): NewsView => {
      const news: NewsView = {
        id: item.id,
        day: item.day,
        companyId: item.companyId,
        trust: item.trust,
        source: item.source,
        title: item.title,
        body: item.body,
        direction: item.direction,
        revealed: item.revealed,
      };
      if (item.revealed && item.revealIndex !== undefined) news.revealIndex = item.revealIndex;
      if (item.revealed) {
        if (item.updateTitle !== undefined) news.updateTitle = item.updateTitle;
        if (item.updateBody !== undefined) news.updateBody = item.updateBody;
        if (item.eventDirection !== undefined) news.eventDirection = item.eventDirection;
        if (item.eventBeforeCents !== undefined) news.eventBeforeCents = item.eventBeforeCents;
        if (item.eventAfterCents !== undefined) news.eventAfterCents = item.eventAfterCents;
      }
      const complete = item.day < source.clock.day || source.clock.phase === 'debrief' || source.clock.phase === 'final';
      if (complete && item.wasTrue !== undefined) news.wasTrue = item.wasTrue;
      return news;
    }),
    account: {
      cashCents: source.account.cashCents,
      worthCents: source.account.worthCents,
      capCents: source.account.capCents,
      canBuy: source.account.canBuy,
    },
    positions: source.positions,
    receipts: source.receipts,
    days: source.days,
    stress: source.stress,
  };
  if (source.clock.phase === 'final' && source.final !== undefined) frame.final = source.final;
  if (source.draft !== undefined) frame.draft = source.draft;
  if (source.history !== undefined) {
    frame.history = source.history;
    if (source.leadIn !== undefined) frame.leadIn = source.leadIn;
  }
  return frame;
}
