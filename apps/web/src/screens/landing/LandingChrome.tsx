import { ArrowUp, LogoMark } from '../ui';
import { GameHelp } from '../GameHelp';

function BrandLink() {
  return (
    <a
      className="inline-flex items-center gap-2.5 no-underline"
      href="/"
      aria-label="Strike Desk home"
    >
      <LogoMark />
      <span className="brand-wordmark">Strike Desk</span>
    </a>
  );
}

export function LandingHeader() {
  return (
    <header className="bg-landing-accent text-landing-bg">
      <div className="page-width flex h-19 items-center justify-between gap-4 md:h-20 md:gap-8 [&_.brand-mark]:rounded [&_.brand-mark]:bg-landing-bg [&_.brand-mark]:p-1 [&_.brand-wordmark]:text-xl md:[&_.brand-wordmark]:text-2xl">
        <BrandLink />
        <nav aria-label="Landing navigation" className="ml-auto hidden gap-8 text-xs md:flex">
          <a className="inline-flex min-h-11 items-center hover:underline" href="#how-to-play">
            How to play
          </a>
          <a className="inline-flex min-h-11 items-center hover:underline" href="#meet-the-market">
            The companies
          </a>
        </nav>
        <a
          className="flex min-h-11 items-center gap-3 bg-landing-bg px-3 py-2.5 text-2xs text-landing-accent no-underline md:gap-6 md:px-5 md:text-xs"
          href="#contrast-start"
        >
          Take a seat <ArrowUp className="size-3.5 md:size-4" />
        </a>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="page-width flex flex-wrap items-center gap-4.5 py-8 pb-9 md:gap-8 [&_.brand-mark]:size-7 [&_.brand-wordmark]:text-lg">
      <BrandLink />
      <p className="ml-auto text-2xs text-landing-muted md:ml-0 md:text-xs">
        Made for curious minds.
      </p>
      <div className="flex flex-wrap gap-6 md:ml-auto [&>button]:text-xs">
        <GameHelp />
        <GameHelp engineering />
      </div>
    </footer>
  );
}
