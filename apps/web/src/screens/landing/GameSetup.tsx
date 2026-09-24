import { PACES } from '@strike-desk/shared/time';
import { ArrowUp, ChoiceButton } from '../ui';
import { PACE_WORDS, startWords } from '../words';
import { useStartGame } from '../useStartGame';

export function GameSetup({ connected }: { connected: boolean }) {
  const { pace, setPace, opening, live, open, status } = useStartGame(connected);

  return (
    <div
      id="contrast-start"
      tabIndex={-1}
      className="scroll-mt-8 md:max-w-[calc(100%-24px)] wide:max-w-sm"
    >
      <fieldset disabled={opening} className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <legend className="float-left py-3.5 text-xs text-landing-muted">
          {startWords.paceLabel}
        </legend>
        <div className="flex gap-1.5">
          {PACES.map((option) => (
            <ChoiceButton
              key={option}
              selected={option === pace}
              onClick={() => setPace(option)}
              className="min-h-11 min-w-14 border border-landing-line px-2 py-2 text-xs text-landing-muted hover:text-cloud aria-pressed:border-landing-accent aria-pressed:text-landing-accent md:min-w-16 md:px-2.5"
            >
              {PACE_WORDS[option]}
            </ChoiceButton>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        disabled={!live || opening}
        onClick={() => {
          void open();
        }}
        className="group flex min-h-15 w-full items-center justify-between bg-sun px-5.5 py-4 text-sm font-semibold text-landing-bg active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-65 disabled:active:translate-y-0"
      >
        <span>
          {opening ? startWords.opening : live ? startWords.action : startWords.connecting}
        </span>
        <ArrowUp className="size-6 rotate-45 transition-transform duration-150 group-hover:translate-x-1 group-disabled:translate-x-0" />
      </button>
      <p className="mt-3 min-h-10 text-2xs leading-relaxed text-landing-muted" role="status">
        {status}
      </p>
    </div>
  );
}
