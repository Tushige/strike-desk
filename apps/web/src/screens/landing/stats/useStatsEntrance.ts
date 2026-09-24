import { useEffect, useRef, useState } from 'react';

// One ticket, one start signal. All three numbers roll together, with zero offsets.
const VISIBLE_FRACTION = 0.5;

export function useStatsEntrance(ready: boolean) {
  const metrics = useRef<HTMLDListElement>(null);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const node = metrics.current;
    if (!node || !ready || play) return;
    if (typeof IntersectionObserver === 'undefined') {
      setPlay(true);
      return;
    }
    let visible = false;
    const start = () => {
      if (visible && !document.hidden) {
        setPlay(true);
        observer.disconnect();
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= VISIBLE_FRACTION,
        );
        start();
      },
      { threshold: VISIBLE_FRACTION },
    );
    observer.observe(node);
    document.addEventListener('visibilitychange', start);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', start);
    };
  }, [ready, play]);
  return { metrics, play };
}
