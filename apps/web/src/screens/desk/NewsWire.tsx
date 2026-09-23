import type { Frame } from '@strike-desk/shared/protocol';
import { TRUST_NAMES } from '../words';
import { NewsUpdate } from './NewsUpdate';

/** News is readable on its own; its explicit action opens the company. */
export function NewsWire({ frame, selected, disabled, onSelect }: {
  frame: Frame; selected: number; disabled: boolean; onSelect: (companyId: number) => void;
}) {
  const headlines = frame.news.filter(item => item.day === frame.clock.day);
  return <section id="desk-news" className="news-wire" aria-label="Today's news">
    <div className="news-wire-heading"><h2>Today's news</h2><span>Day {frame.clock.day}</span></div>
    <div className="news-wire-stories">
      {headlines.length === 0 && <p className="news-wire-empty">No headlines today. All six companies are still tradable.</p>}
      {headlines.map(news => <article key={news.id} className="news-story" data-related={news.companyId === selected}>
        <div className="news-story-meta"><span>{frame.companies[news.companyId]?.ticker}</span><span>{TRUST_NAMES[news.trust]}</span></div>
        <h3>{news.title}</h3>
        <p>{news.body}</p>
        {news.updateBody ? <NewsUpdate news={news} /> : news.wasTrue !== undefined && <p className="news-outcome">{news.wasTrue ? 'The report held up.' : 'The report was overturned.'}</p>}
        <div className="news-story-source"><span aria-label={`Trust ${String(news.trust)} of 3`} className="news-trust-dots">{[1, 2, 3].map(dot => <i key={dot} data-filled={dot <= news.trust} />)}</span><span>{news.source}</span></div>
        <button type="button" disabled={disabled} onClick={() => { onSelect(news.companyId); }}>View {frame.companies[news.companyId]?.name} chart <span aria-hidden="true">→</span></button>
      </article>)}
    </div>
  </section>;
}
