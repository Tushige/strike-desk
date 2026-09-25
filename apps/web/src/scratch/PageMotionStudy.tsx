import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { CompanyTile } from '../screens/ui';
import mark from '../assets/brand/ticket-p.svg';
import '../styles.css';
import './landing-stats-study.css';
import './page-motion-study.css';

gsap.registerPlugin(DrawSVGPlugin);

const COMPANIES = [
  ['RoboPup', 'RPUP', 'Robot pets', '84.00'], ['Fizzly', 'FIZZ', 'Fizzy drinks', '60.00'],
  ['JetKicks', 'JETK', 'Jet sneakers', '120.00'], ['MoonMunch', 'MUNC', 'Space snacks', '58.00'],
  ['PixelPals', 'PIXL', 'Video games', '65.00'], ['ZapCharge', 'ZAPP', 'Super batteries', '150.00'],
] as const;
const BALANCES = [1_000_000, 1_094_400, 947_400, 697_400, 1_120_600, 1_280_000];
const usd = (value: number) => '$' + value.toLocaleString('en-US');
const delta = (value: number) => (value < 0 ? '−' : '+') + usd(Math.abs(value));
type Scene = 'journey' | 'companies' | 'desk';

/** All geometry uses rendered pixels. Nonuniform SVG scaling would make DrawSVG
 * mismeasure a path with non-scaling-stroke and can leave its last segment short. */
function JourneyChart({ run, slow, selected, compact = false }: { run: number; slow: boolean; selected: number; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current!;
    const svg = element.querySelector('svg')!;
    const path = element.querySelector<SVGPathElement>('.motion-trace')!;
    const baseline = element.querySelector('line')!;
    const dots = [...element.querySelectorAll<SVGCircleElement>('circle')];
    let width = 0;
    const height = compact ? 170 : 220;
    const layout = () => {
      width = element.clientWidth;
      svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
      const low = Math.min(...BALANCES), high = Math.max(...BALANCES);
      const xy = BALANCES.map((value, index) => ({
        x: index === 0 ? 9 : 9 + (index - .5) / 5 * (width - 18),
        y: 22 + (high - value) / (high - low) * (height - 48),
      }));
      path.setAttribute('d', xy.map((p, index) => `${index ? 'L' : 'M'}${String(p.x)},${String(p.y)}`).join(' '));
      baseline.setAttribute('x2', String(width - 9));
      baseline.setAttribute('y1', String(xy[0]!.y));
      baseline.setAttribute('y2', String(xy[0]!.y));
      dots.forEach((dot, index) => { dot.setAttribute('cx', String(xy[index]!.x)); dot.setAttribute('cy', String(xy[index]!.y)); });
      const lengths = [0];
      for (let i = 1; i < xy.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(xy[i]!.x - xy[i - 1]!.x, xy[i]!.y - xy[i - 1]!.y));
      return lengths;
    };
    const lengths = layout();
    const timeline = gsap.timeline({ delay: .2 });
    const context = gsap.context(() => {
      timeline.fromTo(path, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.5, ease: 'power2.out' }, 0);
      dots.forEach((dot, index) => {
        const fraction = lengths[index]! / lengths[lengths.length - 1]!;
        // Inverse of power2.out: dots arrive exactly as the drawing reaches them.
        const arrival = 1.5 * (1 - Math.cbrt(1 - fraction));
        timeline.fromTo(dot, { opacity: 0, scale: .25, transformOrigin: '50% 50%' },
          { opacity: 1, scale: 1, duration: .24, ease: 'back.out(1.3)' }, arrival);
      });
      timeline.set(path, { strokeDasharray: 'none', strokeDashoffset: 0 }, 1.5);
    }, element);
    timeline.timeScale(slow ? .5 : 1);
    const resize = new ResizeObserver(() => {
      if (Math.abs(element.clientWidth - width) < 1) return;
      timeline.progress(1).pause();
      layout();
    });
    resize.observe(element);
    return () => { resize.disconnect(); timeline.kill(); context.revert(); };
  }, [run, slow, compact]);
  return <div ref={host} className={`motion-chart ${compact ? 'is-compact' : ''}`} role="img"
    aria-label={`Illustrative five-day balance: ${BALANCES.map(usd).join(', ')}`}>
    <svg viewBox="0 0 1000 220" aria-hidden="true">
      <line x1="9" x2="991" className="motion-baseline" />
      <path className="motion-trace" />
      {BALANCES.map((_, index) => <circle className={index === selected ? 'is-selected' : ''} r="4" key={index} />)}
    </svg>
  </div>;
}

function Journey({ run, slow }: { run: number; slow: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(5);
  useLayoutEffect(() => {
    const context = gsap.context(() => {
      const timeline = gsap.timeline();
      timeline.from('.motion-verdict', { opacity: 0, duration: .5, ease: 'power2.out' }, 0)
        .from('.motion-days button', { opacity: 0, duration: .28, stagger: .065 }, .6)
        .from('.motion-day-detail', { opacity: 0, duration: .4 }, 1.6);
      timeline.timeScale(slow ? .5 : 1);
    }, host);
    return () => { context.revert(); };
  }, [run, slow]);
  const change = BALANCES[selected]! - BALANCES[selected - 1]!;
  return <div className="motion-summary" ref={host}>
    <header className="motion-summary-heading"><div className="motion-verdict"><h2>A comeback worth keeping.</h2><p>Five days. A rough middle. A strong finish.</p></div>
      <div className="motion-final"><span>You finished with</span><strong>{usd(BALANCES[5]!)}</strong><p>+$280,000 on your starting $1M</p></div></header>
    <div className="motion-chart-labels"><span>Started with $1,000,000</span><span>Your balance journey</span></div>
    <JourneyChart run={run} slow={slow} selected={selected} />
    <div className="motion-days" aria-label="Review a day">{BALANCES.slice(1).map((value, index) => {
      const dayChange = value - BALANCES[index]!;
      return <button type="button" key={index} aria-pressed={selected === index + 1} onClick={() => { setSelected(index + 1); }}>
        <span>Day {index + 1}</span><strong className={dayChange < 0 ? 'motion-loss' : 'motion-gain'}>{delta(dayChange)}</strong></button>;
    })}</div>
    <div className="motion-day-detail"><strong>Day {selected}</strong><span>Closing balance <b>{usd(BALANCES[selected]!)}</b></span><span>Daily profit / loss <b className={change < 0 ? 'motion-loss' : 'motion-gain'}>{delta(change)}</b></span></div>
    <footer className="motion-summary-footer">Selecting a day keeps the completed line in place.</footer>
  </div>;
}

function CompanyGrid({ run, slow, bold }: { run: number; slow: boolean; bold: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  useLayoutEffect(() => {
    const context = gsap.context(() => {
      // Authored irregular order makes repeated comparisons reproducible.
      const cards = [...host.current!.querySelectorAll('.motion-company')];
      const order = [0, 3, 1, 4, 2, 5];
      const rotations = [-2, 1.5, -.9, 1.8, -1.4, .8];
      const timeline = gsap.timeline({ delay: .15 });
      order.forEach((cardIndex, index) => {
        timeline.fromTo(cards[cardIndex]!, { opacity: 0, y: bold ? 60 : 28, scale: bold ? .8 : .94,
          rotation: rotations[cardIndex]! * (bold ? 5 : 1) },
        { opacity: 1, y: 0, scale: 1, rotation: 0, duration: bold ? .85 : .7, ease: 'back.out(1.4)' }, index * (bold ? .16 : .085));
      });
      timeline.timeScale(slow ? .5 : 1);
    }, host);
    return () => { context.revert(); };
  }, [run, slow, bold]);
  return <div className="motion-cast" ref={host}><h2>Six companies. Plenty of character.</h2><p>Pick a company to explore.</p>
    <div className="motion-company-grid">{COMPANIES.map((company, index) => <button type="button" className="motion-company" key={company[0]}
      aria-pressed={selected === index} onClick={() => { setSelected(index); }}>
      <CompanyTile companyId={index} size="lg" /><span className="motion-company-ticker">{company[1]}</span><strong>{company[0]}</strong><span>{company[2]}</span>
    </button>)}</div>
    <p className="motion-company-selection"><strong>{COMPANIES[selected]![0]}</strong> selected · Company selection does not replay the entrance.</p>
  </div>;
}

function DeskGrid({ run, slow, loading }: { run: number; slow: boolean; loading: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  useLayoutEffect(() => {
    if (loading) return;
    const context = gsap.context(() => {
      gsap.fromTo('.motion-desk-panel', { opacity: 0, y: 20, scale: .98 },
        { opacity: 1, y: 0, scale: 1, duration: .65, stagger: .12, ease: 'power3.out' }).timeScale(slow ? .5 : 1);
    }, host);
    return () => { context.revert(); };
  }, [run, slow, loading]);
  return <div className="motion-desk" ref={host} aria-busy={loading}>
    <div className="motion-desk-heading"><h2>Your trading desk</h2><span>Day 3 of 5</span></div>
    <div className="motion-desk-grid" data-loading={loading}>
      <section className="motion-desk-panel motion-roster"><h3>Market</h3>{COMPANIES.map((company, index) => <button type="button" key={company[0]} aria-pressed={selected === index} onClick={() => { setSelected(index); }}><CompanyTile companyId={index} size="sm" /><span><b>{company[0]}</b><small>{company[1]}</small></span><strong>${company[3]}</strong></button>)}</section>
      <section className="motion-desk-panel motion-market"><div className="motion-market-heading"><div><h3>{COMPANIES[selected]![0]}</h3><span>Illustrative market view</span></div><strong>${COMPANIES[selected]![3]}</strong></div>
        <svg className="motion-market-plot" viewBox="0 0 400 180" role="img" aria-label="Illustrative price movement"><path className="motion-baseline" d="M0 145H400M0 95H400M0 45H400" /><path className="motion-trace" d="M0 120L28 116L45 124L65 94L88 105L112 82L143 90L172 65L196 86L229 59L249 65L270 35L299 48L320 30L351 42L376 24L400 28" /></svg>
        <div className="motion-market-labels"><span>Market open</span><span>Closing bell</span></div><div className="motion-news"><h3>Today's news</h3><p>Headlines and plot-twist updates stay readable while the desk arrives.</p></div></section>
      <section className="motion-desk-panel motion-ticket"><h3>Make your move</h3><div className="motion-ticket-company"><CompanyTile companyId={selected} size="sm" /><strong>{COMPANIES[selected]![0]}</strong></div><div className="motion-ticket-directions"><span>Going up</span><span>Going down</span></div><dl><div><dt>Target price</dt><dd>$92.00</dd></div><div><dt>Contracts</dt><dd>100</dd></div><div><dt>Maximum loss</dt><dd>$2,400</dd></div></dl><p>Trading controls are illustrative in this motion study.</p></section>
      {loading && <div className="motion-loading" role="status"><span className="sr-only">Loading preview desk</span>{[0, 1, 2].map(index => <div className="motion-skeleton" key={index}><i /><i /><i /><i /></div>)}</div>}
    </div>
  </div>;
}

function Study() {
  const [scene, setScene] = useState<Scene>('journey');
  const [run, setRun] = useState(0);
  const [slow, setSlow] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [bold, setBold] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => () => { clearTimeout(loadTimer.current); }, []);
  function replay(withLoading = false) {
    clearTimeout(loadTimer.current);
    setLoading(withLoading);
    if (withLoading) loadTimer.current = setTimeout(() => { setLoading(false); setRun(value => value + 1); }, 900);
    else setRun(value => value + 1);
  }
  function choose(next: Scene) { clearTimeout(loadTimer.current); setLoading(false); setScene(next); setRun(value => value + 1); }
  const labels: Record<Scene, string> = { journey: 'Balance journey', companies: 'Company cards', desk: 'Trading desk' };
  return <main className="stats-workbench page-motion-study" data-mobile={mobile}>
    <header className="stats-study-heading"><a className="stats-study-brand" href="/scratch/stats-motion.html"><img src={mark} alt="" /><span>Pupside</span></a><h1>Let the story move.</h1><p>Trace the journey. Deal in the companies. Settle into the desk.</p></header>
    <nav className="motion-scene-tabs" aria-label="Motion previews">{(Object.keys(labels) as Scene[]).map(key => <button type="button" key={key} aria-pressed={scene === key} onClick={() => { choose(key); }}>{labels[key]}</button>)}</nav>
    <div className="stats-study-tools"><button type="button" className="motion-replay" onClick={() => { replay(); }}>Replay animation</button><button type="button" aria-pressed={slow} onClick={() => { setSlow(!slow); }}>Half speed</button><button type="button" aria-pressed={mobile} onClick={() => { setMobile(!mobile); }}>Mobile width</button>
      {scene === 'companies' && <button type="button" aria-pressed={bold} onClick={() => { setBold(!bold); }}>Reference energy</button>}
      {scene === 'desk' && <button type="button" onClick={() => { replay(true); }}>Simulate loading</button>}</div>
    <p className="stats-study-source">Scratch preview · Illustrative data · Live pages unchanged</p>
    <section className="stats-study-preview motion-preview" aria-label={labels[scene]}>
      {scene === 'journey' ? <Journey run={run} slow={slow} /> : scene === 'companies' ? <CompanyGrid run={run} slow={slow} bold={bold} /> : <DeskGrid run={run} slow={slow} loading={loading} />}
    </section>
    <p className="motion-study-note">{scene === 'journey' ? 'A 1.5-second stroke draw. Each point meets the line as it arrives; the daily review follows. Resize or select a day without replaying the chart.' : scene === 'companies' ? 'A gently shuffled arrival with a small spring settle. Toggle Reference energy to compare the larger travel, scale and tilt from your example.' : 'Market, chart, then ticket. Space is reserved throughout loading; selecting a company leaves the panels in place.'}</p>
  </main>;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<Study />);
  import.meta.hot?.dispose(() => { root.unmount(); });
}
