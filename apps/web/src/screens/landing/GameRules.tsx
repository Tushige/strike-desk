import { startWords } from '../words';

export function GameRules() {
  return (
    <section className="page-width border-y border-landing-line" aria-label="Game details">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between py-6.5 text-sm [&::-webkit-details-marker]:hidden">
          The rules, in plain English{' '}
          <span aria-hidden="true" className="text-xl group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="grid gap-5 pb-8 text-sm leading-relaxed text-landing-muted md:grid-cols-2 md:gap-10">
          <p>{startWords.footer}</p>
          <p>{startWords.example}</p>
        </div>
      </details>
    </section>
  );
}
