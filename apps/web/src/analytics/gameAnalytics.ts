import type { Frame } from '@strike-desk/shared/protocol';
import type { AnalyticsData, AnalyticsEvent } from './umami';

/** Local deduplication only. Session and command identifiers never go to Umami. */
export function createGameAnalytics(send: (event: AnalyticsEvent, data: AnalyticsData) => void,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const key = 'strike-desk.analytics';
  let session = '';
  let seen = new Set<string>();
  function once(id: string, event: AnalyticsEvent, data: AnalyticsData): void {
    if (seen.has(id)) return;
    seen.add(id);
    try { storage?.setItem(key, JSON.stringify({ session, seen: [...seen] })); } catch { /* optional */ }
    send(event, data);
  }
  return {
    observe(frame: Frame): void {
      if (frame.stress) return;
      if (session !== frame.session) {
        session = frame.session;
        seen = new Set();
        try {
          const saved: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
          if (saved && typeof saved === 'object' && 'session' in saved && saved.session === session &&
              'seen' in saved && Array.isArray(saved.seen)) {
            seen = new Set(saved.seen.filter((id): id is string => typeof id === 'string').slice(0, 100));
          }
        } catch { /* storage is optional */ }
      }
      const pace = frame.clock.pace ?? 1;
      if (frame.clock.phase !== 'lobby') once('started', 'game_started', { pace });
      // Authoritative positions survive receipt eviction and represent accepted purchases only.
      const counts = new Map<number, number>();
      for (const position of frame.positions) {
        const purchaseNumber = (counts.get(position.day) ?? 0) + 1;
        counts.set(position.day, purchaseNumber);
        once(`buy:${position.id}`, 'purchase_accepted', { day: position.day, purchaseNumber, direction: position.side, pace });
        if (position.exit?.kind === 'cashOut') once(`exit:${position.id}`, 'cash_out_accepted', { day: position.day, pace });
      }
      if (frame.clock.phase === 'final') once('completed', 'game_completed', { pace, purchases: frame.positions.length });
    },
  };
}
