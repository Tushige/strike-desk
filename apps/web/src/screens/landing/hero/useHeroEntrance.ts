import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';

// These settings affect the hero only. The mobile art waits for its own visibility.
const VISIBLE_FRACTION = 0.15;

export function useHeroEntrance() {
  const headline = useRef<HTMLHeadingElement>(null);
  const art = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const heading = headline.current;
    const image = art.current;
    if (!heading || !image) return;
    const visible = new Set<Element>();
    const finished = new Set<Element>();
    const timelines = new Map<Element, gsap.core.Timeline>();
    let observer: IntersectionObserver | undefined;
    const context = gsap.context(() => {
      const title = gsap.timeline({
        paused: true,
        onComplete: () => {
          finished.add(heading);
          gsap.set(heading.querySelectorAll('[data-reveal-line]'), { clearProps: 'transform' });
        },
      });
      title.fromTo(
        heading.querySelectorAll('[data-reveal-line]'),
        { yPercent: 110 },
        { yPercent: 0, duration: 0.75, stagger: 0.5, ease: 'power3.out' },
      );
      const mascot = gsap.timeline({
        paused: true,
        onComplete: () => {
          finished.add(image);
          gsap.set(image, { clearProps: 'opacity' });
        },
      });
      mascot.fromTo(
        image,
        { opacity: 0.5 },
        { opacity: 1, duration: 0.65, ease: 'power2.inOut' },
        0.45,
      );
      timelines.set(heading, title);
      timelines.set(image, mascot);
    });
    function sync() {
      timelines.forEach((timeline, target) => {
        if (finished.has(target)) return;
        if (visible.has(target) && !document.hidden) timeline.play();
        else timeline.pause();
      });
      if (finished.size === timelines.size) observer?.disconnect();
    }
    if (typeof IntersectionObserver === 'undefined') {
      visible.add(heading);
      visible.add(image);
      sync();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_FRACTION)
              visible.add(entry.target);
            else visible.delete(entry.target);
          });
          sync();
        },
        { threshold: [0, VISIBLE_FRACTION] },
      );
      observer.observe(heading);
      observer.observe(image);
    }
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      context.revert();
    };
  }, []);
  return { headline, art };
}
