import type { NewsView } from '@strike-desk/shared/protocol';
import { price } from '../format';

/** The landed follow-up stays available; no toast, interruption, or repeated announcement. */
export function NewsUpdate({ news }: { news: NewsView }) {
  if (!news.revealed || !news.updateBody) return null;
  return (
    <span className="news-update">
      <strong>{news.updateTitle}</strong>
      <span>{news.updateBody}</span>
      {news.eventBeforeCents !== undefined && news.eventAfterCents !== undefined && (
        <span className="news-update-prices">
          At the update: {price(news.eventBeforeCents)} → {price(news.eventAfterCents)}
        </span>
      )}
    </span>
  );
}
