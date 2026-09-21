import { frameFor } from '@strike-desk/shared/engine';
import type { Frame, NewsView, Session } from '@strike-desk/shared/engine';

/** Public news beside the live board, without enabling account or trade sections. */
export function liveNewsFrameFor(session: Session, playerId: string, nowMs: number): { session: Session; frame: Frame } {
  const projected = frameFor(session, playerId, nowMs, { history: false, sections: 'full' });
  const source = projected.frame;
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
      return news;
    }),
    account: {
      cashCents: source.account.cashCents,
      worthCents: source.account.cashCents,
      capCents: source.account.capCents,
      canBuy: false,
    },
    positions: [],
    receipts: [],
    days: [],
    stress: source.stress,
  };
  return { session: projected.session, frame };
}
