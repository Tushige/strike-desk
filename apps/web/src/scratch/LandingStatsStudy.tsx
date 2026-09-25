import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommunityStats } from '../screens/landing/stats/CommunityStats';
import type { StatsState, StatsStyle } from '../screens/landing/stats/CommunityStats';
import { parseLandingStats } from '../screens/landing/stats/publicStats';
import { ArcadeMascot } from '../screens/landing/hero/ArcadeMascot';
import mark from '../assets/brand/ticket-s.svg';
import '../styles.css';
import '../screens/landing/landing-v2.css';
import './landing-stats-study.css';

const DESIGNS: { id: StatsStyle; name: string; detail: string }[] = [
  { id: 'ribbon', name: 'Market ribbon', detail: 'A compact, open band. The numbers roll into place, then settle.' },
  { id: 'ticket', name: 'Community ticket', detail: 'Selected for the landing. The profit digits arrive first, followed by games completed and the best run.' },
  { id: 'ledger', name: 'Closing ledger', detail: 'A quieter editorial layout. Three rows arrive like entries on the desk.' },
];
const SAMPLE: StatsState = { status: 'ready', data: { completedGames: '24186', pretendProfitsEarnedCents: '147532000000', bestNetProfitCents: '1864250000' } };
const EMPTY: StatsState = { status: 'ready', data: { completedGames: '0', pretendProfitsEarnedCents: '0', bestNetProfitCents: null } };
const LOSSES: StatsState = { status: 'ready', data: { completedGames: '18', pretendProfitsEarnedCents: '0', bestNetProfitCents: '-1857500' } };
const LARGE: StatsState = { status: 'ready', data: { completedGames: '2418693', pretendProfitsEarnedCents: '501728953729911', bestNetProfitCents: '248916231150' } };

function Study() {
  const [mobile, setMobile] = useState(false);
  const [context, setContext] = useState<StatsStyle | null>(null);
  const [scenario, setScenario] = useState('sample');
  const [state, setState] = useState<StatsState>(SAMPLE);
  const [entrance, setEntrance] = useState(0);
  const request = useRef(0);
  const [sourceNote, setSourceNote] = useState('Sample figures for design review.');

  async function scenarioChange(value: string) {
    setScenario(value);
    const current = ++request.current;
    if (value === 'live') {
      setSourceNote('Reading the local game statistics API.');
      setState({ status: 'loading' });
      try {
        const response = await fetch('/api/stats', { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('unavailable');
        const data = parseLandingStats(await response.json());
        if (request.current !== current) return;
        setState({ status: 'ready', data });
        setSourceNote('Local API data. These are this server’s totals, not sample figures.');
      } catch {
        if (request.current !== current) return;
        setState({ status: 'error' });
        setSourceNote('The local statistics API is unavailable. Sample figures have not been substituted.');
      }
      return;
    }
    setSourceNote(value === 'sample' || value === 'large' ? 'Sample figures for design review.' : 'Simulated state for design review.');
    setState(value === 'empty' ? EMPTY : value === 'losses' ? LOSSES : value === 'large' ? LARGE :
      value === 'loading' ? { status: 'loading' } : value === 'offline' ? { status: 'error' } : SAMPLE);
  }
  const retry = () => { void scenarioChange(scenario === 'live' ? 'live' : 'sample'); };
  const stats = (variant: StatsStyle) => <CommunityStats key={`${variant}-${String(entrance)}`} variant={variant} state={state} onRetry={retry} />;

  return <main className="stats-workbench" data-mobile={mobile}>
    <header className="stats-study-heading"><a className="stats-study-brand" href="/"><img src={mark} alt="" /><span>Strike Desk</span></a>
      <h1>A few numbers.<br /><span>A whole lot of decisions.</span></h1>
      <p>Three ways to show what players have done. Preview each beneath the existing hero before choosing.</p>
    </header>
    <div className="stats-study-tools">
      <button type="button" aria-pressed={mobile} onClick={() => { setMobile(!mobile); }}>Mobile width</button>
      <label>Preview data <select value={scenario} onChange={event => { void scenarioChange(event.target.value); }}>
        <option value="sample">Sample figures</option><option value="empty">No completed games</option><option value="losses">Only losing runs</option>
        <option value="large">Trillion-dollar totals</option><option value="loading">Loading</option><option value="offline">Unavailable</option><option value="live">Local API data</option>
      </select></label>
      <button type="button" onClick={() => { setEntrance(entrance + 1); }}>Replay entrance</button>
      {context !== null && <button type="button" onClick={() => { setContext(null); }}>Compare all three</button>}
    </div>
    <p className="stats-study-source" role="status">{sourceNote}</p>
    {context === null ? <div className="stats-studies">{DESIGNS.map(design => <section className="stats-study" key={design.id} id={design.id}>
      <div className="stats-study-caption"><div><h2>{design.name}</h2><p>{design.detail}</p></div>
        <button type="button" onClick={() => { setContext(design.id); }}>See below the hero</button></div>
      <div className="stats-study-preview">{stats(design.id)}</div>
    </section>)}</div> : <>
      <div className="stats-context-choices" role="group" aria-label="Stats design">{DESIGNS.map(design => <button type="button" key={design.id}
        aria-pressed={context === design.id} onClick={() => { setContext(design.id); }}>{design.name}</button>)}</div>
      <div className="stats-study-preview stats-landing-context landing-v2">
        <header className="v2-header"><a className="stats-study-brand" href="/"><img src={mark} alt="" /><span>Strike Desk</span></a>
          <nav aria-label="Landing preview navigation"><a href="/#how-to-play">How to play</a><a href="/#meet-the-market">The companies</a></nav></header>
        <section className="v2-hero"><div className="v2-hero-copy"><h2>Grow it.<br /><span>Or blow it.</span></h2>
          <p>$1,000,000 of pretend money. Five trading days to read the news, pick a direction, and make your move.</p>
          <a className="stats-context-play" href="/">Open the desk</a></div><ArcadeMascot /></section>
        <div className="stats-context-section">{stats(context)}</div>
        <section className="stats-context-next"><h2>Fictional companies. Real decisions.</h2><p>The existing company roster continues here.</p></section>
      </div>
    </>}
    <footer className="stats-study-math"><h2>What the numbers mean</h2><p><strong>Games completed</strong> counts finished five-day games, not unique players.</p>
      <p><strong>Pretend profits earned</strong> adds up positive results after subtracting each game’s starting $1,000,000. Losing games do not reduce this total.</p>
      <p><strong>Best completed run</strong> is the largest final balance minus its starting $1,000,000. A $2.4M finish is shown as <strong>+$1.4M</strong>, not $2.4M.</p>
      <p>Community ticket is now on the landing page. The other designs remain here for reference.</p></footer>
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Study />);
