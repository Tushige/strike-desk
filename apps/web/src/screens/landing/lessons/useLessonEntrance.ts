import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';

// Only the illustrated headline reveals; its frame and supporting copy stay still.
export function useLessonEntrance(step: number) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    let visible = false;
    let finished = false;
    let observer: IntersectionObserver | undefined;
    const timeline = gsap.timeline({
      paused: true,
      onComplete: () => {
        finished = true;
        observer?.disconnect();
        gsap.set(node.querySelector('h3'), { clearProps: 'clipPath' });
      },
    });
    const context = gsap.context(() => {
      timeline.fromTo(
        node.querySelector('h3'),
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)', duration: 0.85, ease: 'power2.inOut' },
      );
    }, node);
    const sync = () => {
      if (finished) return;
      if (visible && !document.hidden) timeline.play();
      else timeline.pause();
    };
    if (typeof IntersectionObserver === 'undefined') {
      visible = true;
      sync();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.15,
          );
          sync();
        },
        { threshold: [0, 0.15] },
      );
      observer.observe(node);
    }
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      timeline.kill();
      context.revert();
    };
  }, [step]);
  return root;
}
