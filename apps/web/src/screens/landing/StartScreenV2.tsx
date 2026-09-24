import { useEffect, useRef } from 'react';
import { ArcadeMascot } from './ArcadeMascot';
import { CommunityStats } from './CommunityStats';
import { usePublicStats } from './usePublicStats';
import { LandingLessons } from './LandingLessons';
import { LandingHeader, LandingFooter } from './LandingChrome';
import { CompanyRoster } from './CompanyRoster';
import { GameSetup } from './GameSetup';
import { GameFacts } from './GameFacts';
import { GameRules } from './GameRules';
import './landing.css';

export default function StartScreenV2({ connected }: { connected: boolean }) {
  const stats = usePublicStats();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    const theme = document.querySelector('meta[name="theme-color"]');
    const previous = theme?.getAttribute('content');
    const accent = getComputedStyle(root.current).getPropertyValue('--landing-accent').trim();
    if (accent) theme?.setAttribute('content', accent);
    return () => {
      if (previous !== null && previous !== undefined) theme?.setAttribute('content', previous);
      else theme?.removeAttribute('content');
    };
  }, []);

  return (
    <div
      ref={root}
      className="contrast-page landing-page min-h-dvh bg-landing-bg font-body text-cloud"
      data-palette="lilac"
    >
      <a
        className="fixed top-3 left-5 z-50 -translate-y-[200%] bg-cloud p-3.5 text-landing-bg focus:translate-y-0"
        href="#contrast-start"
      >
        Skip to game setup
      </a>
      <LandingHeader />
      <main>
        <div className="bg-landing-accent text-landing-bg md:pt-3">
          <section
            className="page-width mb-7 grid bg-landing-bg text-cloud md:mb-13 md:grid-cols-[1.04fr_1fr]"
            aria-labelledby="contrast-title"
          >
            <div className="relative z-10 animate-landing-arrive px-6 pt-8 md:pr-0 md:pb-5 md:pl-8 wide:pt-13 wide:pb-6 wide:pl-12">
              <h1
                id="contrast-title"
                className="font-display text-landing-hero leading-[1.14] font-bold tracking-tighter"
              >
                Grow it.
                <br />
                <span className="text-landing-accent">Or blow it.</span>
              </h1>
              <p className="mt-5 mb-6 max-w-prose-short text-sm leading-7 text-landing-muted md:mt-6 md:mr-6 md:mb-7 wide:text-base">
                $1,000,000 of pretend money. Five trading days to read the news, pick a direction,
                and make your move.
              </p>
              <GameSetup connected={connected} />
            </div>
            <div className="grid w-full min-w-0 max-w-md items-center justify-self-center overflow-hidden md:max-w-none">
              <ArcadeMascot />
            </div>
          </section>
          <GameFacts />
        </div>
        <div className="page-width pt-7 md:pt-12">
          <CommunityStats variant="ticket" state={stats.state} onRetry={stats.retry} />
        </div>
        <CompanyRoster />
        <LandingLessons />
        <GameRules />
      </main>
      <LandingFooter />
    </div>
  );
}
