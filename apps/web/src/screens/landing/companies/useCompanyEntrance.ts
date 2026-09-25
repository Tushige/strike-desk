import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';

// All company entrance controls live here. No other section uses these settings.
const MOTION = {
  desktop: '(min-width: 48rem)',
  viewportInset: 0,
  desktopVisibleHeight: 1,
  mobileVisibleHeight: 1,
  stagger: 0.1,
  logo: { x: -16, duration: 0.6, ease: 'back.out(1.7)' },
  title: { y: 10, offset: 0.08, duration: 0.5, ease: 'power3.out' },
  subtitle: { y: 8, offset: 0.14, duration: 0.5, ease: 'power3.out' },
} as const;

/** Full list on desktop; visible rows on mobile or when the list cannot fit. */
export function useCompanyEntrance(ready: boolean) {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node || !ready) return;
    const desktop = window.matchMedia(MOTION.desktop);
    const items = [...node.children] as HTMLElement[];
    const started = new Set<HTMLElement>();
    const finished = new Set<HTMLElement>();
    const timelines = new Map<HTMLElement, gsap.core.Timeline>();
    let observer: IntersectionObserver | undefined;
    const context = gsap.context(() => {
      items.forEach((item) => {
        const logo = item.firstElementChild;
        const title = item.querySelector('[data-company-title]');
        const subtitle = item.querySelector('[data-company-subtitle]');
        const timeline = gsap.timeline({
          paused: true,
          onComplete: () => {
            finished.add(item);
            gsap.set([logo, title, subtitle], { clearProps: 'opacity,transform' });
            if (finished.size === items.length) observer?.disconnect();
          },
        });
        timeline.fromTo(
          logo,
          { opacity: 0, x: MOTION.logo.x },
          { opacity: 1, x: 0, duration: MOTION.logo.duration, ease: MOTION.logo.ease },
          0,
        );
        timeline.fromTo(
          title,
          { opacity: 0, y: MOTION.title.y },
          { opacity: 1, y: 0, duration: MOTION.title.duration, ease: MOTION.title.ease },
          MOTION.title.offset,
        );
        timeline.fromTo(
          subtitle,
          { opacity: 0, y: MOTION.subtitle.y },
          { opacity: 1, y: 0, duration: MOTION.subtitle.duration, ease: MOTION.subtitle.ease },
          MOTION.subtitle.offset,
        );
        timelines.set(item, timeline);
      });
    }, node);

    function check() {
      const height = window.innerHeight - MOTION.viewportInset;
      const bounds = node!.getBoundingClientRect();
      const wholeList = desktop.matches && bounds.height <= height;
      const visibleHeight = (rect: DOMRect) =>
        Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
      const listReady = visibleHeight(bounds) >= bounds.height * MOTION.desktopVisibleHeight;
      let entering = 0;
      for (const item of items) {
        if (finished.has(item)) continue;
        const timeline = timelines.get(item)!;
        const rect = item.getBoundingClientRect();
        const visible = visibleHeight(rect);
        if (document.hidden || visible <= 0) {
          timeline.pause();
          continue;
        }
        // Start qualification is intentionally separate from continuing playback.
        if (started.has(item)) {
          timeline.play();
          continue;
        }
        const qualifies = wholeList
          ? listReady
          : visible >= Math.min(rect.height, height) * MOTION.mobileVisibleHeight;
        if (qualifies) {
          started.add(item);
          // Put the stagger inside elapsed timeline time; play() drops delay()
          // when unpausing a timeline and would start all companies together.
          timeline.shiftChildren(entering++ * MOTION.stagger).play();
        }
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      timelines.forEach((timeline, item) => {
        started.add(item);
        timeline.play();
      });
    } else {
      // Observe stable layout, never the translated logo/text. Intermediate thresholds
      // also support tuning either visible-height fraction above without other edits.
      observer = new IntersectionObserver(check, {
        threshold: Array.from({ length: 101 }, (_, index) => index / 100),
        rootMargin: `0px 0px -${String(MOTION.viewportInset)}px 0px`,
      });
      observer.observe(node);
      items.forEach((item) => {
        observer!.observe(item);
      });
      check();
    }
    window.addEventListener('resize', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', check);
      document.removeEventListener('visibilitychange', check);
      context.revert();
    };
  }, [ready]);
  return list;
}
