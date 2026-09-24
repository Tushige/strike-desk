import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { gsap } from 'gsap';

/** Each element arrives on its first visible appearance, never on market ticks. */
export function useEntrance(root: RefObject<HTMLElement | null>, selector: string, kind: 'cards' | 'desk', ready = true) {
  const seen = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    if (!ready || !root.current) return;
    const elements = [...root.current.querySelectorAll<HTMLElement>(selector)];
    const timelines: gsap.core.Tween[] = [];
    const context = gsap.context(() => {
      elements.forEach((element, index) => {
        if (seen.current.has(element)) return;
        const order = [0, 2, 4, 1, 3, 5];
        const rotations = [-2, 1.5, -.9, 1.8, -1.4, .8];
        timelines.push(gsap.fromTo(element, {
          opacity: 0, y: kind === 'cards' ? 28 : 20, scale: kind === 'cards' ? .94 : .98,
          rotation: kind === 'cards' ? rotations[index % rotations.length] : 0,
        }, {
          opacity: 1, y: 0, scale: 1, rotation: 0, paused: true,
          duration: kind === 'cards' ? .7 : .65,
          delay: kind === 'cards' ? (order[index % order.length] ?? index) * .085 : index * .12,
          ease: kind === 'cards' ? 'back.out(1.4)' : 'power3.out',
          onComplete: () => { gsap.set(element, { clearProps: 'transform,opacity' }); },
        }));
      });
    }, root);
    const reveal = (element: Element) => {
      const tween = timelines.find(item => item.targets()[0] === element);
      if (!tween) return;
      seen.current.add(element);
      tween.play();
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { reveal(entry.target); observer?.unobserve(entry.target); }
    }, { threshold: .1 });
    elements.forEach(element => { if (observer) observer.observe(element); else reveal(element); });
    return () => { observer?.disconnect(); context.revert(); };
  }, [root, selector, kind, ready]);
}
