import { ArcadeMascot } from './ArcadeMascot';
import { GameSetup } from '../GameSetup';
import { useHeroEntrance } from './useHeroEntrance';
import './hero.css';

export function Hero({ connected }: { connected: boolean }) {
  const { headline, art } = useHeroEntrance();
  return (
    <section
      className="page-width mb-7 grid bg-landing-bg text-cloud md:mb-13 md:grid-cols-[1.04fr_1fr]"
      aria-labelledby="contrast-title"
    >
      <div className="relative z-10 px-6 pt-8 md:pr-0 md:pb-5 md:pl-8 wide:pt-13 wide:pb-6 wide:pl-12">
        <h1
          ref={headline}
          id="contrast-title"
          className="font-display text-landing-hero leading-[1.14] font-bold tracking-tighter"
        >
          <span className="landing-line-mask">
            <span data-reveal-line>Grow it.</span>
          </span>
          <span className="landing-line-mask text-landing-accent">
            <span data-reveal-line>Or blow it.</span>
          </span>
        </h1>
        <p className="mt-5 mb-6 max-w-prose-short text-sm leading-7 text-landing-muted md:mt-6 md:mr-6 md:mb-7 wide:text-base">
          $1,000,000 of pretend money. Five trading days to read the news, pick a direction, and
          make your move.
        </p>
        <GameSetup connected={connected} />
      </div>
      <div
        ref={art}
        className="grid w-full min-w-0 max-w-md items-center justify-self-center overflow-hidden md:max-w-none"
      >
        <ArcadeMascot />
      </div>
    </section>
  );
}
