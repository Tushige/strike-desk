import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { digitTravel, formatStudyNumber } from './numberMotion';
import type { NumberSpec } from './numberMotion';
import mark from '../assets/brand/ticket-p.svg';
import '../styles.css';
import '../screens/landing/community-stats.css';
import './landing-stats-study.css';
import './stats-motion-study.css';

type Treatment = 'odometer' | 'countup';
type Figures = [NumberSpec, NumberSpec, NumberSpec];
const games = (value: number): NumberSpec => ({ value, decimals: 0, prefix: '', suffix: '' });
const money = (value: number, suffix = 'M'): NumberSpec => ({ value, decimals: 2, prefix: '+$', suffix });
const EXAMPLES: { label: string; from: Figures; to: Figures }[] = [
  { label: 'Landing totals', from: [games(0), money(0, 'B'), money(0)], to: [games(24186), money(148, 'B'), money(1864)] },
  { label: 'Carry: 999 → 1,000', from: [games(999), money(999), money(999)], to: [games(1000), money(1000), money(1000)] },
  { label: 'Increasing totals', from: [games(24186), money(148, 'B'), money(1864)], to: [games(25342), money(162, 'B'), money(2138)] },
  { label: 'Decreasing values', from: [games(1200), money(142), money(1864)], to: [games(985), money(119), money(1425)] },
];
const LABELS = ['Games completed', 'Pretend profits earned', 'Best completed run'] as const;
const KINDS = ['games', 'profit', 'best'] as const;

function MovingNumber({ spec, initial, capacity, treatment, run, slow, delay }: {
  spec: NumberSpec; initial: number; capacity: number; treatment: Treatment; run: number; slow: boolean; delay: number;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const wheels = useRef<(HTMLSpanElement | null)[]>([]);
  const previous = useRef(initial);
  const previousRun = useRef(run);
  const digits = Math.max(String(Math.floor(capacity)).length, spec.decimals + 1);
  const parts: { place?: number; character?: string; groupPlace?: number }[] = [];
  for (let i = digits - 1; i >= 0; i--) {
    parts.push({ place: 10 ** i });
    if (i === spec.decimals && spec.decimals > 0) parts.push({ character: '.' });
    else if (i > spec.decimals && (i - spec.decimals) % 3 === 0) parts.push({ character: ',', groupPlace: 10 ** i });
  }
  const places = parts.filter(part => part.place !== undefined).map(part => part.place!);
  const full = formatStudyNumber(spec.value, spec);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const restart = run !== previousRun.current;
    previousRun.current = run;
    const model = { value: restart ? initial : previous.current };
    previous.current = spec.value;
    const showPlaces = (value: number) => {
      places.forEach((place, index) => {
        const window = wheels.current[index]?.parentElement;
        if (window) window.style.visibility = place > 10 ** spec.decimals && value < place ? 'hidden' : 'visible';
      });
      element.querySelectorAll<HTMLElement>('[data-group-place]').forEach(separator => {
        separator.style.visibility = value < Number(separator.dataset.groupPlace) ? 'hidden' : 'visible';
      });
    };
    const timeline = gsap.timeline({ paused: true, delay });
    let resize: ResizeObserver | undefined;
    const context = gsap.context(() => {
      if (treatment === 'countup') {
        const draw = () => {
          if (text.current) text.current.textContent = formatStudyNumber(model.value, { ...spec, prefix: '', suffix: '' });
        };
        draw();
        timeline.to(model, { value: spec.value, duration: 2.2, ease: 'expo.out', onUpdate: draw });
      } else {
        showPlaces(Math.max(model.value, spec.value));
        const tracks = places.flatMap((place, index) => {
          const wheel = wheels.current[index];
          if (!wheel) return [];
          const { start, end } = digitTravel(model.value, spec.value, place);
          const digitHeight = wheel.firstElementChild!.getBoundingClientRect().height;
          // Direct strip motion: one uninterrupted tween, no per-frame modulo/reset.
          timeline.fromTo(wheel, { y: -start * digitHeight }, {
            y: -end * digitHeight, duration: 1.5, ease: 'power2.out',
          }, 0);
          return [{ wheel, end, digitHeight }];
        });
        timeline.eventCallback('onComplete', () => { showPlaces(spec.value); });
        resize = new ResizeObserver(() => {
          if (!tracks.some(track => track.wheel.firstElementChild!.getBoundingClientRect().height !== track.digitHeight)) return;
          // Resizing must not leave pixel-based strips between rows.
          timeline.progress(1).pause();
          for (const track of tracks) {
            track.digitHeight = track.wheel.firstElementChild!.getBoundingClientRect().height;
            gsap.set(track.wheel, { y: -track.end * track.digitHeight });
          }
        });
        resize.observe(element);
      }
    }, element);
    timeline.timeScale(slow ? .5 : 1);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { timeline.play(); observer.disconnect(); }
    }, { threshold: .15 });
    observer.observe(element.closest('.community-body') ?? element);
    return () => { observer.disconnect(); resize?.disconnect(); timeline.kill(); context.revert(); };
    // The numeric specification and play controls are the complete animation input.
  }, [spec.value, spec.decimals, spec.prefix, spec.suffix, initial, capacity, treatment, run, slow]);

  let wheelIndex = 0;
  return <span className={`numeric-study-value numeric-${treatment}`} ref={host} role="img" aria-label={full}>
    {treatment === 'countup' ? <span aria-hidden="true">{spec.prefix}<span className="numeric-count-slot">
      <span className="numeric-width-guide">{formatStudyNumber(capacity, { ...spec, prefix: '', suffix: '' })}</span>
      <span className="numeric-count-text" ref={text}>{formatStudyNumber(initial, { ...spec, prefix: '', suffix: '' })}</span>
    </span>{spec.suffix}</span> : <span className="numeric-drum" aria-hidden="true"><span>{spec.prefix}</span>{parts.map((part, index) => {
      if (!part.place) return <span className="numeric-separator" data-group-place={part.groupPlace} key={index}>{part.character}</span>;
      const currentWheel = wheelIndex++;
      return <span className="numeric-wheel-window" key={index}><span className="numeric-wheel" ref={node => { wheels.current[currentWheel] = node; }}>
        {Array.from({ length: 20 }, (_, digit) => <span key={digit}>{digit % 10}</span>)}
      </span></span>;
    })}<span>{spec.suffix}</span></span>}
  </span>;
}

function MotionTicket({ treatment, example, slow }: { treatment: Treatment; example: number; slow: boolean }) {
  const [run, setRun] = useState(0);
  const [updated, setUpdated] = useState(false);
  const id = useId();
  const scenario = EXAMPLES[example]!;
  const selected = updated ? scenario.to : scenario.from;
  // The landing sample plays on first view. Other examples wait for a deliberate update.
  const values = example === 0 ? scenario.to : selected;
  function play() { setUpdated(true); setRun(value => value + 1); }
  return <section className="stats-study" aria-labelledby={id}>
    <div className="stats-study-caption"><div><h2 id={id}>{treatment === 'odometer' ? 'Odometer' : 'Eased count-up'}</h2>
      <p>{treatment === 'odometer' ? 'Each digit strip glides straight to its target. 1.5 seconds, power2.out, no rebound.' : 'The value climbs quickly, then spends its last beat easing into the total.'}</p></div>
      <button type="button" onClick={play}>{example === 0 || updated ? 'Replay' : 'Animate change'} {treatment === 'odometer' ? 'odometer' : 'count-up'}</button>
    </div>
    <div className="stats-study-preview"><div className="community-stats community-ticket"><div className="community-body">
      <dl className="community-metrics">{values.map((spec, index) => <div className={`community-metric community-${KINDS[index]!}`} key={index}>
        <dt>{LABELS[index]}</dt><dd><MovingNumber spec={spec} initial={scenario.from[index]!.value} treatment={treatment}
          capacity={Math.max(scenario.from[index]!.value, scenario.to[index]!.value)}
          run={run} slow={slow} delay={index === 1 ? 0 : index === 0 ? .2 : .4} /></dd>
      </div>)}</dl>
      <div className="community-note"><p>Starting $1M excluded. Total profits count winning runs only.</p><span>All money is pretend.</span></div>
    </div></div></div>
  </section>;
}

function Study() {
  const [example, setExample] = useState(0);
  const [slow, setSlow] = useState(false);
  const [mobile, setMobile] = useState(false);
  return <main className="stats-workbench number-motion-study" data-mobile={mobile}>
    <header className="stats-study-heading"><a className="stats-study-brand" href="/scratch/stats.html"><img src={mark} alt="" /><span>Pupside</span></a>
      <h1>Give the numbers<br /><span>some momentum.</span></h1>
      <p>Same ticket. Two ways to move through a value. Watch the digits, then replay the one that feels right.</p></header>
    <div className="stats-study-tools"><label>Example <select value={example} onChange={event => { setExample(Number(event.target.value)); }}>
      {EXAMPLES.map((entry, index) => <option value={index} key={entry.label}>{entry.label}</option>)}</select></label>
      <button type="button" aria-pressed={slow} onClick={() => { setSlow(!slow); }}>Half speed</button>
      <button type="button" aria-pressed={mobile} onClick={() => { setMobile(!mobile); }}>Mobile width</button></div>
    <p className="stats-study-source">Illustrative figures for motion review. {example === 3 ? 'Decreasing values are a motion test, not a claim that completed-game totals go down.' : 'No live totals are changed.'}</p>
    <MotionTicket key={`odometer-${String(example)}-${String(slow)}`} treatment="odometer" example={example} slow={slow} />
    <MotionTicket key={`countup-${String(example)}-${String(slow)}`} treatment="countup" example={example} slow={slow} />
    <footer className="stats-study-math"><p>Both use GSAP. The ticket, labels, currency symbols and units stay in place. Numbers resolve to the same target, with space reserved throughout.</p>
      <p>This page is a motion study. Neither treatment has replaced the landing-page animation.</p></footer>
  </main>;
}

const root = document.getElementById('root');
if (root) {
  const studyRoot = createRoot(root);
  studyRoot.render(<Study />);
  import.meta.hot?.dispose(() => { studyRoot.unmount(); });
}
