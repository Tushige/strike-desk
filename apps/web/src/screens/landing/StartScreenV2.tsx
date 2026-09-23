import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Pace } from '@strike-desk/shared/time';
import { PACES } from '@strike-desk/shared/time';
import { connection } from '../../boot';
import { lineStateOf } from '../../modules/connection/index';
import { useCompanies, useConnectionState } from '../../store/hooks';
import { startGame } from '../commands';
import { CompanyTile, LogoMark } from '../ui';
import { GameHelp } from '../GameHelp';
import { CompanyRosterSkeleton } from '../LoadingSkeleton';
import { PACE_WORDS, startWords } from '../words';
import heroArt from '../../assets/landing-v2/trading-desk.jpg';
import './landing-v2.css';

const LESSONS = [
  { title: 'Read the news', question: 'Rumor or reality?', body: startWords.steps[0].body,
    detail: 'A headline is a clue. It is never a guarantee.', words: ['Solid news', 'Could be true', 'Wild rumor'] },
  { title: 'Buy a ticket', question: 'Which way will it go?', body: startWords.steps[1].body,
    detail: 'Choose your target and your budget. You can also sit the day out.', words: ['Direction', 'Target', 'Budget'] },
  { title: 'Beat the bell', question: 'Cash out or hold?', body: startWords.steps[2].body,
    detail: 'A ticket can pay out and still lose money after its cost.', words: ['Watch the price', 'Make your call', 'Review your day'] },
] as const;

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
          className="v2-lesson-panel" data-active={selected === index} aria-hidden={selected !== index} inert={selected !== index} tabIndex={selected === index ? 0 : -1}>
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

/** The primary landing composition. The original StartScreen stays independent. */
export default function StartScreenV2({ connected }: { connected: boolean }) {
  const [pace, setPace] = useState<Pace>(1);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const state = useConnectionState();
  const companies = useCompanies();
  const live = connected && lineStateOf(state.phase) === 'live';
  const paceId = useId();

  async function open() {
    if (!live || submitting.current) return;
    submitting.current = true;
    if (state.gameGone) connection.dismissGameGone();
    setOpening(true);
    setFailed(false);
    try {
      const outcome = await startGame(pace);
      if (outcome.outcome !== 'accepted') {
        submitting.current = false;
        setOpening(false);
        setFailed(true);
      }
    } catch {
      submitting.current = false;
      setOpening(false);
      setFailed(true);
    }
  }

  return <div className="landing-v2">
    <a className="v2-skip" href="#v2-start">Skip to the game setup</a>
    <header className="v2-header">
        <a className="v2-brand" href="/" aria-label="Strike Desk home"><LogoMark /><span className="brand-wordmark">Strike Desk</span></a>
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
                {PACES.map(option => <button type="button" key={option} aria-pressed={option === pace} disabled={opening}
                  onClick={() => { setPace(option); }}>{PACE_WORDS[option]}</button>)}
              <span className="v2-pace-indicator" data-pace={pace} aria-hidden="true" />
              </div>
            </div>
            <button className="v2-play" type="button" disabled={!live || opening} onClick={() => { void open(); }}>
              <span>{opening ? startWords.opening : live ? startWords.action : startWords.connecting}</span>
              <span className="v2-play-arrow" aria-hidden="true" />
            </button>
            <div className="v2-start-status" role="status">
              {state.serverFull ? startWords.serverFull : state.gameGone ? startWords.gameGone : failed ? 'The desk did not open. Try again when connected.' : null}
            </div>
          </div>
        </div>
        <div className="v2-hero-art">
          <img src={heroArt} width={1254} height={1254} fetchPriority="high" decoding="async"
            alt="RoboPup beside a yellow market bell and two paper tickets pointing up and down." />
        </div>
      </section>

      <section className="v2-cast" id="meet-the-market" aria-labelledby="v2-cast-title">
        <h2 id="v2-cast-title">Made-up companies. Real decisions.</h2>
        <div className="v2-cast-space">
          {companies.length > 0 ? <ul>{companies.map((company, index) => <li key={company.ticker}>
            <CompanyTile companyId={index} size="md" />
            <div><h3>{company.name}</h3><p>{company.product}</p></div>
          </li>)}</ul> : <CompanyRosterSkeleton />}
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
