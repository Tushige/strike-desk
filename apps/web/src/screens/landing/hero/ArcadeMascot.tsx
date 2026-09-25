import { useEffect, useId, useRef, useState } from 'react';
import artwork from '../../../assets/landing-v2/robopup-blank-display.jpg';
import './arcade-mascot.css';

function Eye({ right = false }: { right?: boolean }) {
  return (
    <g
      transform={
        right ? 'translate(636 340) rotate(-14) scale(.79 .92)' : 'translate(514 366) rotate(-14)'
      }
    >
      <g className="arcade-eye-smile">
        <path d="M-32 12 C-28-26 23-30 32 12" />
      </g>
      <g className="arcade-eye-dollars">
        <text x="0" y="26" textAnchor="middle">
          $
        </text>
      </g>
      <g className="arcade-eye-arrows">
        <g className="arcade-eye-travel">
          <path d="M0 29V-28M-23-5 0-28 23-5" />
        </g>
      </g>
    </g>
  );
}

/** A decorative ten-second loop; the game never drives these expressions. */
export function ArcadeMascot() {
  const root = useRef<HTMLDivElement>(null);
  const clip = useId();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let visible = true;
    const sync = () => {
      node.dataset.running = String(ready && visible && !document.hidden);
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              visible = entries.some((entry) => entry.isIntersecting);
              sync();
            },
            { threshold: 0.1 },
          );
    observer?.observe(node);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [ready]);

  return (
    <div ref={root} className="v2-hero-art arcade-mascot" data-running="false">
      <img
        src={artwork}
        width={1254}
        height={1254}
        fetchPriority="high"
        decoding="async"
        onLoad={() => {
          setReady(true);
        }}
        alt="RoboPup beside a yellow market bell and two paper tickets, with playful animated LED eyes."
      />
      <svg className="arcade-mascot-display" viewBox="0 0 1254 1254" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <path d="M452 336 667 282 676 365 459 423Z" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <Eye />
          <Eye right />
        </g>
      </svg>
    </div>
  );
}
