import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUp } from '../../ui';
import { startWords } from '../../words';
import { LessonVisual } from './LessonVisual';

const LESSONS = [
  {
    title: 'Read the news.',
    body: startWords.steps[0].body,
    note: 'A headline is a clue. Never a guarantee.',
  },
  {
    title: 'Make your move.',
    body: startWords.steps[1].body,
    note: 'You can also sit the day out.',
  },
  {
    title: 'Beat the bell.',
    body: startWords.steps[2].body,
    note: 'A paying ticket can still lose money after its cost.',
  },
] as const;

/** A single expanded lesson keeps its explanation and illustrated example together. */
export function LandingLessons() {
  const [step, setStep] = useState(0);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % LESSONS.length;
    else if (event.key === 'ArrowUp') next = (index + LESSONS.length - 1) % LESSONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = LESSONS.length - 1;
    else return;
    event.preventDefault();
    buttons.current[next]?.focus();
  }

  return (
    <section
      className="page-width grid scroll-mt-6 items-center gap-8 py-10 md:grid-cols-[1.1fr_1fr] md:gap-10 md:py-21 wide:gap-24"
      id="how-to-play"
      aria-labelledby={`${id}-heading`}
    >
      <div className="min-w-0">
        <h2
          className="font-brand text-landing-heading leading-tight font-bold tracking-tight"
          id={`${id}-heading`}
        >
          A little news.
          <br />
          <span className="text-landing-accent">A lot of possibility.</span>
        </h2>
        <p className="mt-5 mb-8 max-w-prose-short text-sm leading-relaxed text-landing-muted">
          Learn the decisions behind an options trade, one fictional day at a time.
        </p>
        <div className="min-w-0">
          {LESSONS.map((lesson, index) => (
            <div
              className="group border-b border-landing-line"
              key={lesson.title}
              data-active={step === index}
            >
              <h3>
                <button
                  className="flex min-h-17 w-full items-center gap-4 text-left text-base font-medium text-landing-muted group-data-[active=true]:text-landing-accent"
                  type="button"
                  id={`${id}-button-${String(index)}`}
                  aria-expanded={step === index}
                  aria-controls={`${id}-lesson-${String(index)} ${id}-example`}
                  ref={(element) => {
                    buttons.current[index] = element;
                  }}
                  onKeyDown={(event) => {
                    navigate(event, index);
                  }}
                  onClick={() => {
                    setStep(index);
                  }}
                >
                  <span className="text-xs font-normal tabular-nums" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <span>{lesson.title}</span>
                  <ArrowUp className="ml-auto size-4 transition-transform duration-150 group-data-[active=true]:rotate-90" />
                </button>
              </h3>
              <div
                className="pb-5.5 pl-8 text-sm leading-relaxed"
                id={`${id}-lesson-${String(index)}`}
                hidden={step !== index}
              >
                <p>{lesson.body}</p>
                <p className="mt-2.5 text-xs text-landing-muted">{lesson.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className="min-w-0 self-stretch [&>div]:h-full"
        id={`${id}-example`}
        role="region"
        aria-labelledby={`${id}-button-${String(step)}`}
      >
        <LessonVisual step={step} key={step} />
      </div>
    </section>
  );
}
