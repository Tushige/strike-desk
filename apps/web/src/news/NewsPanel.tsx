import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import { NewsCard, RevealBanner } from '../modules/desk/index';
import type { NewsStore, PublicNews } from './newsStore';

const SelectableCard = memo(function SelectableCard({ news, selected, onSelect }: {
  news: PublicNews;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const select = useCallback(() => onSelect(news.id), [news.id, onSelect]);
  return <NewsCard companyId={news.companyId} companyName={news.companyName} ticker={news.ticker}
    trust={news.trust} source={news.source} title={news.title} body={news.body}
    direction={news.direction} revealed={news.revealed} selected={selected} onSelect={select} />;
});

function Cards({ news }: { news: readonly PublicNews[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-1 items-start gap-2 p-1 md:grid-cols-3">
      {news.map((item) => <SelectableCard key={item.id} news={item} selected={selected === item.id} onSelect={setSelected} />)}
    </div>
  );
}

/** Only this region subscribes to news; prices and the page root stay independent. */
export const NewsPanel = memo(function NewsPanel({ store }: { store: NewsStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className="max-h-[38dvh] shrink-0 overflow-y-auto overscroll-contain">
      <div className={snapshot.bannerCompanyName === null ? '' : 'mb-2'}>
        <RevealBanner companyName={snapshot.bannerCompanyName} />
      </div>
      <Cards key={`${snapshot.session ?? ''}:${snapshot.day}`} news={snapshot.news} />
    </div>
  );
});
