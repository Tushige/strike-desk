import { useEffect, useRef } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';

/** Ring only for an observed opening, never when restoring an open market. */
export function MarketBell({ phase }: { phase: Frame['clock']['phase'] }) {
  const bell = useRef<SVGSVGElement>(null);
  const previous = useRef(phase);
  useEffect(() => {
    const opening = previous.current === 'preBell' && phase === 'open';
    previous.current = phase;
    if (!opening || document.visibilityState === 'hidden' || !bell.current?.animate) return;
    const motion = bell.current.animate(
      [0, -18, 14, -10, 6, -3, 0].map(degrees => ({ transform: `rotate(${String(degrees)}deg)` })),
      { duration: 720, easing: 'ease-out', iterations: 1 },
    );
    return () => { motion.cancel(); };
  }, [phase]);

  return <svg ref={bell} className="market-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 4V3a2 2 0 0 1 4 0v1M6 10a6 6 0 0 1 12 0v4l2 3H4l2-3zM9 20a3 3 0 0 0 6 0" />
  </svg>;
}
