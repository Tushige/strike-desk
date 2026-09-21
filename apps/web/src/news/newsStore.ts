import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { FrameOrder, NewsView, ServerMessage } from '@strike-desk/shared/protocol';

export interface PublicNews extends Omit<NewsView, 'wasTrue'> {
  readonly companyName: string;
  readonly ticker: string;
}

export interface NewsSnapshot {
  readonly session: string | null;
  readonly day: number;
  readonly news: readonly PublicNews[];
}

export interface NewsStore {
  ingest(message: ServerMessage): void;
  readonly getSnapshot: () => NewsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

function sameNews(a: PublicNews, b: PublicNews): boolean {
  return a.id === b.id && a.day === b.day && a.companyId === b.companyId &&
    a.companyName === b.companyName && a.ticker === b.ticker && a.trust === b.trust &&
    a.source === b.source && a.title === b.title && a.body === b.body &&
    a.direction === b.direction && a.revealed === b.revealed && a.revealIndex === b.revealIndex;
}

/** Keeps public card data and an ordering watermark, never the frame or its money. */
export function createNewsStore(): NewsStore {
  let held: FrameOrder | null = null;
  let snapshot: NewsSnapshot = { session: null, day: 0, news: [] };
  const listeners = new Set<() => void>();

  function ingest(message: ServerMessage): void {
    if (message.t === 'quotes') {
      // A batch cannot establish a new session, day or account revision.
      if (held !== null && message.session === held.session && message.rev === held.rev &&
        message.day === snapshot.day && isNewerFrame(held, message)) {
        held = { session: message.session, rev: message.rev, step: message.step };
      }
      return;
    }
    const frame = message.t === 'frame' ? message : message.t === 'reply' ? message.frame : null;
    if (frame === null || !isNewerFrame(held, frame)) return;
    held = { session: frame.session, rev: frame.rev, step: frame.step };

    const news: PublicNews[] = [];
    for (const item of frame.news) {
      const company = frame.companies[item.companyId];
      if (item.day !== frame.clock.day || company === undefined) continue;
      const publicItem: PublicNews = {
        id: item.id,
        day: item.day,
        companyId: item.companyId,
        companyName: company.name,
        ticker: company.ticker,
        trust: item.trust,
        source: item.source,
        title: item.title,
        body: item.body,
        direction: item.direction,
        revealed: item.revealed,
      };
      if (item.revealed && item.revealIndex !== undefined && item.revealIndex <= frame.clock.priceIndex) {
        publicItem.revealIndex = item.revealIndex;
      }
      news.push(publicItem);
    }
    if (snapshot.session === frame.session && snapshot.day === frame.clock.day &&
      news.length === snapshot.news.length && news.every((item, index) => {
        const previous = snapshot.news[index];
        return previous !== undefined && sameNews(previous, item);
      })) return;
    snapshot = { session: frame.session, day: frame.clock.day, news };
    for (const listener of [...listeners]) listener();
  }

  return {
    ingest,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
