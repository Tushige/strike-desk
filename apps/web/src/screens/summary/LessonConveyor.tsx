import { useId } from 'react';
import { finalWords } from '../words';
import { useLessonRotation } from './useLessonRotation';

const TITLES = ['Reading the news', 'Choosing a target', 'Time value'];

export function LessonConveyor() {
  const heading = useId();
  const count = finalWords.lessons.length;
  const {
    root,
    track,
    slides,
    selection,
    paused,
    readingPaused,
    announcement,
    next,
    choose,
    toggleRotation,
    readingEvents,
  } = useLessonRotation(finalWords.lessons);
  return (
    <section
      ref={root}
      className="lesson-conveyor border-t border-line px-5 pt-5 @reading:px-7.5 @reading:pt-5.5"
      aria-labelledby={heading}
      aria-roledescription="carousel"
      {...readingEvents}
    >
      <header className="lesson-conveyor-header mb-4.5 flex items-start justify-between gap-2.5 @reading:mb-5.5 @reading:items-baseline @reading:gap-4 [&>h2]:max-w-[24ch] [&>h2]:text-sm [&>h2]:font-medium [&>span]:min-w-16 [&>span]:flex-none [&>span]:text-right [&>span]:text-2xs [&>span]:text-muted @reading:[&>span]:min-w-24">
        <h2 id={heading}>{finalWords.lessonsHeading}</h2>
        <span>{paused ? 'Paused' : readingPaused ? 'Reading paused' : 'Auto · 8s'}</span>
      </header>
      <div className="lesson-conveyor-window relative overflow-hidden pr-6.5 @reading:pr-14.5">
        <div className="lesson-conveyor-slides relative grid">
          {finalWords.lessons.map((text, index) => (
            <article
              key={text}
              ref={(element) => {
                slides.current[index] = element;
              }}
              className={`lesson-conveyor-slide relative col-start-1 row-start-1 flex min-h-46 min-w-0 items-start rounded-lg bg-receipt-bg py-4.5 pr-3.5 text-receipt-text @reading:min-h-29 @reading:items-center @reading:py-5 @reading:pr-6 before:absolute before:-top-1.5 before:left-8.5 before:size-3 before:rounded-full before:bg-panel after:absolute after:-bottom-1.5 after:left-8.5 after:size-3 after:rounded-full after:bg-panel @reading:before:left-21 @reading:after:left-21 ${index === selection.index ? 'is-current visible opacity-100' : 'invisible opacity-0'}`}
              aria-hidden={index !== selection.index}
              aria-label={`Lesson ${String(index + 1)} of ${String(count)}`}
              aria-roledescription="slide"
            >
              <span
                className="lesson-conveyor-number mr-3 grid w-10 flex-none place-items-center self-stretch border-r border-dashed border-receipt-line font-display text-base leading-none font-semibold tracking-tight text-sun tabular-nums @reading:mr-6 @reading:w-22.5 @reading:text-3xl"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 [&>h3]:mb-2 [&>h3]:text-xs [&>h3]:text-receipt-caption [&>p]:max-w-[67ch] [&>p]:text-lesson [&>p]:leading-relaxed [&>p]:tracking-tight [&>p]:text-pretty">
                <h3>{TITLES[index]}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
        <div
          className="lesson-conveyor-peek pointer-events-none absolute inset-y-0 -right-30 flex w-36.5 flex-col gap-4 rounded-lg bg-raised px-2 py-5 text-muted @reading:-right-25 @reading:px-3.5 @reading:py-6 [&>span:first-child]:font-display [&>span:first-child]:text-base [&>span:first-child]:font-semibold @reading:[&>span:first-child]:text-xl [&>span:last-child]:text-xs [&>span:last-child]:whitespace-nowrap [&>span:last-child]:opacity-60"
          aria-hidden="true"
        >
          <span>{String(next + 1).padStart(2, '0')}</span>
          <span>{TITLES[next]}</span>
        </div>
      </div>
      <div className="lesson-conveyor-controls mt-3.5 mb-3 flex flex-wrap items-center justify-between gap-1 @reading:gap-4.5">
        <div
          className="lesson-conveyor-select flex @reading:gap-1"
          role="group"
          aria-label="Choose lesson"
        >
          {finalWords.lessons.map((text, index) => (
            <button
              className="min-h-11 min-w-9 rounded-t border-b-2 border-transparent px-2 py-2 text-xs text-muted hover:bg-raised aria-pressed:border-sun aria-pressed:bg-sun/5 aria-pressed:text-sun @reading:min-w-11"
              key={text}
              type="button"
              aria-label={`Show lesson ${String(index + 1)}: ${TITLES[index] ?? ''}`}
              aria-pressed={index === selection.index}
              onClick={() => {
                choose(index, index < selection.index ? -1 : 1);
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
        <div className="lesson-conveyor-actions ml-auto flex @reading:gap-1 [&>button:nth-child(2)]:w-16 @reading:[&>button:nth-child(2)]:w-18">
          <button
            className="min-h-11 rounded px-2 py-2 text-xs transition-colors hover:bg-raised @reading:px-3"
            type="button"
            aria-label="Previous lesson"
            onClick={() => {
              choose((selection.index + count - 1) % count, -1);
            }}
          >
            Previous
          </button>
          <button
            className="min-h-11 rounded px-2 py-2 text-xs transition-colors hover:bg-raised @reading:px-3"
            type="button"
            aria-label={paused ? 'Resume rotation' : 'Pause rotation'}
            onClick={toggleRotation}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            className="min-h-11 rounded px-2 py-2 text-xs transition-colors hover:bg-raised @reading:px-3"
            type="button"
            aria-label="Next lesson"
            onClick={() => {
              choose(next, 1);
            }}
          >
            Next
          </button>
        </div>
      </div>
      <div
        className="lesson-conveyor-timer -mx-5 h-0.5 overflow-hidden bg-line @reading:-mx-7.5 [&>span]:block [&>span]:h-full [&>span]:origin-left [&>span]:scale-x-0 [&>span]:bg-sun"
        aria-hidden="true"
      >
        <span ref={track} />
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </section>
  );
}
