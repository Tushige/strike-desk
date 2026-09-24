import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LessonVisual } from '../screens/landing/lessons/LessonVisual';
import { ArcadeMascot } from '../screens/landing/hero/ArcadeMascot';
import { ArrowUp, CompanyTile, LogoMark } from '../screens/ui';
import { startWords } from '../screens/words';
import '../styles.css';
import './landing-contrast-study.css';

const PALETTES = {
  sun: { label: 'Sun', color: '#ffd447', note: 'Our ticket yellow, turned all the way up.' },
  mint: { label: 'Mint', color: '#82ebbd', note: 'A fresh mint field against the same deep ink.' },
  lilac: { label: 'Lilac', color: '#b6a0ff', note: 'RoboPup’s violet, softened into a solid color field.' },
} as const;
type Palette = keyof typeof PALETTES;

const COMPANIES = [
  ['RoboPup', 'Robot pets'], ['Fizzly', 'Fizzy drinks'], ['JetKicks', 'Jet sneakers'],
  ['MoonMunch', 'Space snacks'], ['PixelPals', 'Video games'], ['ZapCharge', 'Super batteries'],
] as const;
const LESSONS = [
  { title: 'Read the news.', body: startWords.steps[0].body, note: 'A headline is a clue. Never a guarantee.' },
  { title: 'Make your move.', body: startWords.steps[1].body, note: 'You can also sit the day out.' },
  { title: 'Beat the bell.', body: startWords.steps[2].body, note: 'A paying ticket can still lose money after its cost.' },
] as const;


function Landing({ palette }: { palette: Palette }) {
  const [minutes, setMinutes] = useState(15);
  const [previewed, setPreviewed] = useState(false);
  const [step, setStep] = useState(0);
  return <div className="contrast-page" data-palette={palette}>
    <a className="contrast-skip" href="#contrast-start">Skip to game setup</a>
    <div className="contrast-color-field">
      <header className="contrast-header contrast-width">
        <a className="contrast-brand" href="#" aria-label="Strike Desk home"><LogoMark /><span className="brand-wordmark">Strike Desk</span></a>
        <nav aria-label="Landing navigation"><a href="#how-to-play">How to play</a><a href="#companies">The companies</a></nav>
        <a className="contrast-header-action" href="#contrast-start">Take a seat <ArrowUp /></a>
      </header>
      <main>
        <section className="contrast-hero contrast-width" aria-labelledby="contrast-title">
          <div className="contrast-hero-copy">
            <h1 id="contrast-title">Grow it.<br /><span>Or blow it.</span></h1>
            <p>$1,000,000 of pretend money. Five trading days to read the news, pick a direction, and make your move.</p>
            <div className="contrast-start" id="contrast-start" tabIndex={-1}>
              <fieldset><legend>Game length</legend><div>{[15, 5, 2].map(value => <button key={value} type="button" aria-pressed={value === minutes} onClick={() => { setMinutes(value); setPreviewed(false); }}>{value} min</button>)}</div></fieldset>
              <button className="contrast-play" type="button" onClick={() => { setPreviewed(true); }}><span>{startWords.action}</span><ArrowUp /></button>
              <p className="contrast-start-status" role="status">{previewed ? `${String(minutes)}-minute game selected. This sketch doesn’t start a live game.` : 'A trading game. No real money involved.'}</p>
            </div>
          </div>
          <div className="contrast-hero-visual"><ArcadeMascot /></div>
        </section>
        <div className="contrast-facts-wrap">
          <dl className="contrast-facts contrast-width">
            <div><dt>Pretend starting cash</dt><dd>$1M</dd></div>
            <div><dt>Trading days</dt><dd>05</dd></div>
            <div><dt>Fictional companies</dt><dd>06</dd></div>
            <div><dt>Minutes to play</dt><dd>2–15</dd></div>
          </dl>
        </div>
      </main>
    </div>
    <div className="contrast-lower">
      <section className="contrast-companies contrast-width" id="companies" aria-labelledby="companies-title">
        <h2 id="companies-title">Fictional companies. <span>Real decisions.</span></h2>
        <ul>{COMPANIES.map(([name, product], index) => <li key={name}><CompanyTile companyId={index} size="md" /><div><h3>{name}</h3><p>{product}</p></div></li>)}</ul>
      </section>
      <section className="contrast-how contrast-width" id="how-to-play" aria-labelledby="how-title">
        <div className="contrast-how-copy">
          <h2 id="how-title">A little news.<br /><span>A lot of possibility.</span></h2>
          <p>Learn the decisions behind an options trade, one fictional day at a time.</p>
          <div className="contrast-steps">{LESSONS.map((lesson, index) => <div className="contrast-step" key={lesson.title} data-active={step === index}>
            <h3><button type="button" aria-expanded={step === index} aria-controls={`lesson-${String(index)}`} onClick={() => { setStep(index); }}><span className="contrast-step-number">0{index + 1}</span><span>{lesson.title}</span><ArrowUp /></button></h3>
            <div id={`lesson-${String(index)}`} hidden={step !== index}><p>{lesson.body}</p><p className="contrast-step-note">{lesson.note}</p></div>
          </div>)}</div>
        </div>
        <LessonVisual step={step} />
      </section>
      <section className="contrast-rules contrast-width" aria-label="Game details">
        <details><summary>The rules, in plain English <span aria-hidden="true">+</span></summary><div><p>{startWords.footer}</p><p>{startWords.example}</p></div></details>
      </section>
      <footer className="contrast-footer contrast-width"><a className="contrast-brand" href="#"><LogoMark /><span className="brand-wordmark">Strike Desk</span></a><p>Made for curious minds.</p><a href="/">View the current landing <ArrowUp /></a></footer>
    </div>
  </div>;
}

function Study() {
  const query = new URLSearchParams(window.location.search);
  const asked = query.get('palette');
  const initial = asked !== null && Object.hasOwn(PALETTES, asked) ? asked as Palette : 'sun';
  const [palette, setPalette] = useState<Palette>(initial);
  const [mobile, setMobile] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const framed = query.get('frame') === '1';
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES[palette].color);
    const url = new URL(window.location.href);
    url.searchParams.set('palette', palette);
    window.history.replaceState(null, '', url);
  }, [palette]);
  return <div className="contrast-study" data-mobile={mobile}>
    {mobile ? <iframe className="contrast-phone" title="Mobile sketch at 390 pixels" src={`/scratch/landing-motion.html?frame=1&palette=${palette}`} /> : <Landing palette={palette} />}
    {!framed && <aside className="contrast-tools" aria-label="Sketch controls">
      <button className="contrast-tools-toggle" type="button" aria-expanded={toolsOpen} aria-controls="contrast-tools-body" onClick={() => { setToolsOpen(value => !value); }}><span>Contrast sketch</span><span>{toolsOpen ? 'Hide' : 'Edit palette'}</span></button>
      <div id="contrast-tools-body" hidden={!toolsOpen}>
        <div className="contrast-palette-options" role="group" aria-label="Accent palette">{(Object.keys(PALETTES) as Palette[]).map(key => <button key={key} type="button" aria-pressed={key === palette} onClick={() => { setPalette(key); }}><span style={{ background: PALETTES[key].color }} />{PALETTES[key].label}</button>)}</div>
        <p>{PALETTES[palette].note}</p>
        <button className="contrast-mobile-toggle" type="button" aria-pressed={mobile} onClick={() => { setMobile(value => !value); }}>{mobile ? 'Show full width' : 'Preview mobile'}</button>
      </div>
    </aside>}
  </div>;
}

const element = document.getElementById('root');
if (element) {
  const root = createRoot(element);
  root.render(<Study />);
  import.meta.hot?.dispose(() => { root.unmount(); });
}
