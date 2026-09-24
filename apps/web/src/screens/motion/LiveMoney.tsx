import { memo, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { money } from '../format';
import './live-money.css';

const REEL_DIGITS = Array.from({ length: 30 }, (_, index) => <span key={index}>{index % 10}</span>);

/** Equivalent middle-cycle position gives interrupted rolls room in either direction. */
export function digitDestination(position: number, digit: number, direction: number) {
  const start = 10 + (((position % 10) + 10) % 10);
  let end = 10 + digit;
  if (direction > 0 && end < start) end += 10;
  if (direction < 0 && end > start) end -= 10;
  return { start, end };
}

const RollingDigit = memo(function RollingDigit({
  digit,
  direction,
  duration,
  animate,
}: {
  digit: number;
  direction: number;
  duration: number;
  animate: boolean;
}) {
  const strip = useRef<HTMLSpanElement>(null);
  const initial = useRef(10 + digit);
  const model = useRef({ position: initial.current });
  const target = useRef(digit);
  const tween = useRef<gsap.core.Tween | null>(null);
  useLayoutEffect(() => {
    const paint = () => {
      if (strip.current)
        strip.current.style.transform = `translateY(-${String(model.current.position * 1.16)}em)`;
    };
    if (!animate || document.hidden) {
      tween.current?.kill();
      model.current.position = 10 + digit;
      target.current = digit;
      paint();
      return;
    }
    if (target.current === digit) return;
    target.current = digit;
    tween.current?.kill();
    const { start, end } = digitDestination(model.current.position, digit, direction);
    // Rebase only before a new roll, to visually identical rows; never reset on arrival.
    model.current.position = start;
    paint();
    tween.current = gsap.to(model.current, {
      position: end,
      duration,
      ease: 'power2.out',
      onUpdate: paint,
    });
  }, [digit, direction, duration, animate]);
  useLayoutEffect(() => {
    const settle = () => {
      if (!document.hidden) return;
      tween.current?.kill();
      model.current.position = 10 + target.current;
      if (strip.current)
        strip.current.style.transform = `translateY(-${String(model.current.position * 1.16)}em)`;
    };
    document.addEventListener('visibilitychange', settle);
    return () => {
      tween.current?.kill();
      document.removeEventListener('visibilitychange', settle);
    };
  }, []);
  return (
    <span className="live-money-window">
      <span
        ref={strip}
        className="live-money-strip"
        style={{ transform: `translateY(-${String(initial.current * 1.16)}em)` }}
      >
        {REEL_DIGITS}
      </span>
    </span>
  );
});

/** Presentation only: accessible value and all trading logic use the latest server cents. */
export function LiveMoney({
  cents,
  pace = 'portfolio',
  animate = true,
}: {
  cents: number;
  pace?: 'portfolio' | 'cash';
  animate?: boolean;
}) {
  const dollars = Math.round(Math.abs(cents) / 100);
  const previous = useRef(dollars);
  const direction = Math.sign(dollars - previous.current);
  useLayoutEffect(() => {
    previous.current = dollars;
  }, [dollars]);
  const digits = String(dollars);
  return (
    <span className="live-money" role="img" aria-label={money(cents)} title={money(cents)}>
      <span className="live-money-drum" aria-hidden="true">
        <span>{cents < 0 ? '−$' : '$'}</span>
        {[...digits].map((character, index) => {
          const place = digits.length - index - 1;
          return (
            <span className="live-money-place" key={place}>
              <RollingDigit
                digit={Number(character)}
                direction={direction}
                duration={pace === 'cash' ? 0.55 : 0.28}
                animate={animate}
              />
              {place > 0 && place % 3 === 0 && <span>,</span>}
            </span>
          );
        })}
      </span>
    </span>
  );
}
