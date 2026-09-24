import { useEffect, useRef } from 'react';
import { Hero } from './hero/Hero';
import { CommunityStats } from './stats/CommunityStats';
import { usePublicStats } from './stats/usePublicStats';
import { LandingLessons } from './lessons/LandingLessons';
import { LandingHeader, LandingFooter } from './LandingChrome';
import { CompanyRoster } from './companies/CompanyRoster';
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
          <Hero connected={connected} />
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
