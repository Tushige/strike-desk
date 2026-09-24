import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArcadeMascot } from '../screens/landing/ArcadeMascot';
import { CommunityStats } from '../screens/landing/CommunityStats';
import type { StatsState } from '../screens/landing/CommunityStats';
import { GameHelp } from '../screens/GameHelp';
import { CompanyTile, LogoMark } from '../screens/ui';
import { PACE_WORDS, startWords } from '../screens/words';
import '../styles.css';
import '../screens/landing/landing-v2.css';
import './landing-aurora-study.css';

/** The live roster comes from the server; the study holds it still so the
 * atmosphere is the only thing changing between takes. */
const COMPANIES = [
  { name: 'RoboPup', product: 'Robot pets' },
  { name: 'Fizzly', product: 'Fizzy drinks' },
  { name: 'JetKicks', product: 'Jet sneakers' },
  { name: 'MoonMunch', product: 'Space snacks' },
  { name: 'PixelPals', product: 'Video games' },
  { name: 'ZapCharge', product: 'Super batteries' },
] as const;

const PACES = [1, 3, 7.5] as const;
type Pace = (typeof PACES)[number];

const STATS: StatsState = {
  status: 'ready',
  data: { completedGames: '1284', pretendProfitsEarnedCents: '48230600', bestNetProfitCents: '91400000' },
};

const LESSONS = [
  { title: 'Read the news', question: 'Rumor or reality?', body: startWords.steps[0].body,
    detail: 'A headline is a clue. It is never a guarantee.', words: ['Solid news', 'Could be true', 'Wild rumor'] },
  { title: 'Buy a ticket', question: 'Which way will it go?', body: startWords.steps[1].body,
    detail: 'Choose your target and your budget. You can also sit the day out.', words: ['Direction', 'Target', 'Budget'] },
  { title: 'Beat the bell', question: 'Cash out or hold?', body: startWords.steps[2].body,
    detail: 'A ticket can pay out and still lose money after its cost.', words: ['Watch the price', 'Make your call', 'Review your day'] },
] as const;

const TAKES = {
  stage: { label: 'Stage', note: 'One lamp aimed at the mascot, a cool pool behind the community ticket, a violet rise under the lessons. Every edge stays deep.' },
  spectrum: { label: 'Spectrum', note: 'The same lamp with the six company tints washing in from the edges — the reference sheet’s red, blue and green cards read as light instead of as cards.' },
  deep: { label: 'Deep', note: 'The same light held two stops down. Closest to the landing as it ships; use it to judge how far the other two travel.' },
} as const;
type Take = keyof typeof TAKES;

function HowToPlay() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % LESSONS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + LESSONS.length - 1) % LESSONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = LESSONS.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }
  return <section className="v2-how" id="how-to-play" aria-labelledby={`${id}-heading`}>
    <div className="v2-section-intro">
      <h2 id={`${id}-heading`}>A little news.<br />A lot of possibility.</h2>
      <p>Learn the decisions behind an options trade, one fictional day at a time.</p>
    </div>
    <div className="v2-lesson-book">
      <div className="v2-lesson-tabs" role="tablist" aria-label="How to play">
        {LESSONS.map((lesson, index) => <button key={lesson.title} type="button" role="tab"
          id={`${id}-tab-${String(index)}`} aria-controls={`${id}-panel-${String(index)}`}
          aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
          ref={element => { tabs.current[index] = element; }} onKeyDown={event => { navigate(event, index); }}
          onClick={() => { setSelected(index); }}>{lesson.title}</button>)}
      </div>
      <div className="v2-lesson-panels">
        {LESSONS.map((lesson, index) => <div key={lesson.title} role="tabpanel"
          id={`${id}-panel-${String(index)}`} aria-labelledby={`${id}-tab-${String(index)}`}
          className="v2-lesson-panel" data-active={selected === index} aria-hidden={selected !== index}
          inert={selected !== index} tabIndex={selected === index ? 0 : -1}>
          <div>
            <h3>{lesson.question}</h3>
            <p>{lesson.body}</p>
            <p className="v2-lesson-detail">{lesson.detail}</p>
          </div>
          <ol className="v2-lesson-words" aria-label={index === 0 ? 'News confidence levels' : 'Your decisions'}>
            {lesson.words.map(word => <li key={word}>{word}</li>)}
          </ol>
        </div>)}
      </div>
    </div>
  </section>;
}

/**
 * Three layers, drawn in the order light actually reaches the eye: the core
 * bloom, the coloured wash around it, then the falloff that keeps every edge
 * of the page deep. Fixed to the viewport, so scrolling moves the page
 * through the light rather than dragging a painted backdrop along with it.
 */
function Atmosphere() {
  return <div className="v2-atmosphere" aria-hidden="true">
    <span className="aurora-core" /><span className="aurora-wash" /><span className="aurora-falloff" />
  </div>;
}

function Landing({ take }: { take: Take }) {
  const [pace, setPace] = useState<Pace>(1);
  const paceId = useId();
  // The page ground reaches past the layout: overscroll, the scrollbar track.
  useEffect(() => { document.documentElement.dataset.auroraTake = take; }, [take]);
  return <div className="landing-v2 landing-aurora" data-take={take}>
    <Atmosphere />
    <a className="v2-skip" href="#v2-start">Skip to the game setup</a>
    <header className="v2-header">
      <a className="v2-brand" href="/scratch/landing-aurora.html" aria-label="Strike Desk home"><LogoMark /><span className="brand-wordmark">Strike Desk</span></a>
      <nav aria-label="Landing navigation"><a href="#how-to-play">How to play</a><a href="#meet-the-market">The companies</a></nav>
    </header>
    <main>
      <section className="v2-hero" aria-labelledby="v2-title">
        <div className="v2-hero-copy">
          <h1 id="v2-title"><span className="v2-title-line"><span>Grow it.</span></span><span className="v2-title-line"><span>Or blow it.</span></span></h1>
          <p>$1,000,000 of pretend money. Five trading days to read the news, pick a direction, and make your move.</p>
          <div className="v2-start" id="v2-start" tabIndex={-1}>
            <div className="v2-pace">
              <span id={paceId}>{startWords.paceLabel}</span>
              <div role="group" aria-labelledby={paceId}>
                {PACES.map(option => <button type="button" key={option} aria-pressed={option === pace}
                  onClick={() => { setPace(option); }}>{PACE_WORDS[option]}</button>)}
                <span className="v2-pace-indicator" data-pace={pace} aria-hidden="true" />
              </div>
            </div>
            <button className="v2-play" type="button">
              <span>{startWords.action}</span>
              <span className="v2-play-arrow" aria-hidden="true" />
            </button>
            <div className="v2-start-status">Scratch preview. This button does not open a game.</div>
          </div>
        </div>
        <ArcadeMascot />
      </section>

      <div className="v2-community"><CommunityStats variant="ticket" state={STATS} onRetry={() => undefined} /></div>

      <section className="v2-cast" id="meet-the-market" aria-labelledby="v2-cast-title">
        <h2 id="v2-cast-title">Made-up companies. Real decisions.</h2>
        <div className="v2-cast-space">
          <ul>{COMPANIES.map((company, index) => <li key={company.name}>
            <CompanyTile companyId={index} size="md" />
            <div><h3>{company.name}</h3><p>{company.product}</p></div>
          </li>)}</ul>
        </div>
      </section>

      <HowToPlay />

      <section className="v2-rules" aria-label="Game details">
        <details>
          <summary>The rules, in plain English <span aria-hidden="true">+</span></summary>
          <div><p>{startWords.footer}</p><p>{startWords.example}</p></div>
        </details>
      </section>
    </main>
    <footer className="v2-footer"><span>Made for curious minds.</span><div><GameHelp /><GameHelp engineering /></div></footer>
  </div>;
}

function Study() {
  const [take, setTake] = useState<Take>('stage');
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(true);
  // Remounting the page replays the one authored moment: the bloom igniting.
  const [run, setRun] = useState(0);
  const stamp = `${take}-${String(run)}`;
  return <div className="aurora-study" data-mobile={mobile}>
    {/* A real nested viewport, so the landing's own media queries answer the
      * narrow width instead of a max-width faking it. */}
    {mobile
      ? <iframe className="aurora-phone" key={stamp} title="Mobile preview, 390px wide"
        src={`/scratch/landing-aurora.html?frame=1&take=${take}`} />
      : <div className="aurora-stage"><Landing take={take} key={stamp} /></div>}
    <div className="aurora-tools" data-open={open}>
      <button type="button" className="aurora-tools-toggle" aria-expanded={open}
        onClick={() => { setOpen(value => !value); }}>
        <span className="aurora-tools-dot" data-take={take} aria-hidden="true" />
        {open ? 'Hide study controls' : `Study controls · ${TAKES[take].label}`}
      </button>
      <div className="aurora-tools-body" inert={!open}>
        <div className="aurora-takes" role="group" aria-label="Gradient take">
          {(Object.keys(TAKES) as Take[]).map(key => <button type="button" key={key} aria-pressed={take === key}
            onClick={() => { setTake(key); }}>{TAKES[key].label}</button>)}
        </div>
        <p className="aurora-tools-note">{TAKES[take].note}</p>
        <div className="aurora-tools-row">
          <button type="button" aria-pressed={mobile} onClick={() => { setMobile(value => !value); }}>Mobile width</button>
          <button type="button" onClick={() => { setRun(value => value + 1); }}>Replay entrance</button>
        </div>
        <p className="aurora-tools-source">Scratch study · Illustrative stats · The live landing is untouched</p>
      </div>
    </div>
  </div>;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const search = new URLSearchParams(window.location.search);
  const asked = search.get('take');
  const framedTake: Take = asked !== null && asked in TAKES ? asked as Take : 'stage';
  const root = createRoot(rootElement);
  root.render(search.get('frame') === '1' ? <Landing take={framedTake} /> : <Study />);
  import.meta.hot?.dispose(() => { root.unmount(); });
}
