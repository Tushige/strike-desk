import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { signedMoney } from '../format';
import './live-money.css';

/** One earned closing-bell count, retargeted without restarting if the record changes. */
export function ResultCount({ cents }: { cents: number }) {
  const root = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const model = useRef({ cents: 0 });
  const started = useRef(false);
  useLayoutEffect(() => {
    const node = text.current!;
    const paint = () => {
      const value = signedMoney(Math.round(model.current.cents));
      node.textContent = cents < 0 && model.current.cents === 0 ? value.replace('+', '−') : value;
    };
    const tween = gsap.to(model.current, {
      cents,
      paused: true,
      duration: 0.85,
      ease: 'power3.out',
      onUpdate: paint,
    });
    paint();
    const play = () => {
      started.current = true;
      tween.play();
    };
    const observer =
      !started.current && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                play();
                observer?.disconnect();
              }
            },
            { threshold: 0.2 },
          )
        : null;
    if (observer) observer.observe(root.current!);
    else play();
    return () => {
      observer?.disconnect();
      tween.kill();
    };
  }, [cents]);
  return (
    <span className="result-count" ref={root} role="img" aria-label={signedMoney(cents)}>
      <span className="result-count-width" aria-hidden="true">
        {signedMoney(cents)}
      </span>
      <span className="result-count-value" aria-hidden="true" ref={text}>
        {signedMoney(cents)}
      </span>
    </span>
  );
}
