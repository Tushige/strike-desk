import { useEffect, useId, useRef, useState } from 'react';
import { finalWords } from '../words';
import './lesson-conveyor.css';

const TITLES = ['Reading the news', 'Choosing a target', 'Time value'];
const READING_MS = 8_000;
const count = finalWords.lessons.length;

export function LessonConveyor() {
  const heading = useId();
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const slides = useRef<(HTMLElement | null)[]>([]);
  const previous = useRef(0);
  const remaining = useRef(READING_MS);
  const [selection, setSelection] = useState({ index: 0, revision: 0, direction: 1 });
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [hidden, setHidden] = useState(document.hidden);
  const [announcement, setAnnouncement] = useState('');
  const held = paused || hover || focus || !visible || hidden;

  useEffect(() => {
    const update = () => { setHidden(document.hidden); };
    document.addEventListener('visibilitychange', update);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      setVisible(entries[0]?.isIntersecting ?? false);
    }, { threshold: .25 });
    if (root.current) observer?.observe(root.current);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  useEffect(() => {
    remaining.current = READING_MS;
    const old = slides.current[previous.current];
    const incoming = slides.current[selection.index];
    const changed = previous.current !== selection.index;
    previous.current = selection.index;
    if (!changed || !incoming?.animate || document.hidden) return;
    const exit = old?.animate([
      { visibility: 'visible', opacity: 1, transform: 'none' },
      { visibility: 'visible', opacity: 0, transform: `translateX(${String(-selection.direction * 65)}%)` },
    ], { duration: 240, easing: 'ease-in' });
    const enter = incoming.animate([
      { opacity: 0, transform: `translateX(${String(selection.direction * 65)}%)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 460, easing: 'cubic-bezier(.16,1,.3,1)' });
    return () => { exit?.cancel(); enter.cancel(); };
  }, [selection]);

  useEffect(() => {
    const left = remaining.current;
    const progress = track.current?.animate?.([
      { transform: `scaleX(${String(1 - left / READING_MS)})` }, { transform: 'scaleX(1)' },
    ], { duration: Math.max(1, left), fill: 'both', easing: 'linear' });
    progress?.pause();
    if (held) return () => { progress?.cancel(); };
    const started = performance.now();
    progress?.play();
    const timer = window.setTimeout(() => {
      setSelection(current => ({ index: (current.index + 1) % count, revision: current.revision + 1, direction: 1 }));
    }, left);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, left - (performance.now() - started));
      progress?.cancel();
    };
  }, [held, selection]);

  function choose(index: number, direction: number) {
    setSelection(current => ({ index, direction, revision: current.revision + 1 }));
    setAnnouncement(`Lesson ${String(index + 1)} of ${String(count)}. ${finalWords.lessons[index] ?? ''}`);
  }
  const next = (selection.index + 1) % count;
  return <section ref={root} className="lesson-conveyor" aria-labelledby={heading} aria-roledescription="carousel"
    onMouseEnter={() => { setHover(true); }} onMouseLeave={() => { setHover(false); }}
    onFocusCapture={() => { setFocus(true); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false); }}>
    <header className="lesson-conveyor-header"><h2 id={heading}>{finalWords.lessonsHeading}</h2><span>{paused ? 'Paused' : hover || focus ? 'Reading paused' : 'Auto · 8s'}</span></header>
    <div className="lesson-conveyor-window"><div className="lesson-conveyor-slides">
      {finalWords.lessons.map((text, index) => <article key={text} ref={element => { slides.current[index] = element; }}
        className={`lesson-conveyor-slide ${index === selection.index ? 'is-current' : ''}`} aria-hidden={index !== selection.index}
        aria-label={`Lesson ${String(index + 1)} of ${String(count)}`} aria-roledescription="slide">
        <span className="lesson-conveyor-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="lesson-conveyor-copy"><h3>{TITLES[index]}</h3><p>{text}</p></div>
      </article>)}
    </div><div className="lesson-conveyor-peek" aria-hidden="true"><span>{String(next + 1).padStart(2, '0')}</span><span>{TITLES[next]}</span></div></div>
    <div className="lesson-conveyor-controls"><div className="lesson-conveyor-select" role="group" aria-label="Choose lesson">
      {finalWords.lessons.map((text, index) => <button key={text} type="button" aria-label={`Show lesson ${String(index + 1)}: ${TITLES[index] ?? ''}`} aria-pressed={index === selection.index}
        onClick={() => { choose(index, index < selection.index ? -1 : 1); }}>{String(index + 1).padStart(2, '0')}</button>)}
    </div><div className="lesson-conveyor-actions">
      <button type="button" aria-label="Previous lesson" onClick={() => { choose((selection.index + count - 1) % count, -1); }}>Previous</button>
      <button type="button" aria-label={paused ? 'Resume rotation' : 'Pause rotation'} onClick={() => { setPaused(value => !value); }}>{paused ? 'Resume' : 'Pause'}</button>
      <button type="button" aria-label="Next lesson" onClick={() => { choose(next, 1); }}>Next</button>
    </div></div>
    <div className="lesson-conveyor-timer" aria-hidden="true"><span ref={track} /></div>
    <span className="sr-only" role="status">{announcement}</span>
  </section>;
}
