import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import './odometer.css';

/** Animate the already-formatted digits, preserving BigInt precision and static units. */
export function Odometer({
  value,
  label = value,
  delay = 0,
}: {
  value: string;
  label?: string;
  delay?: number;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const presented = useRef(false);
  useLayoutEffect(() => {
    const node = root.current!;
    const strips = [...node.querySelectorAll<HTMLElement>('[data-digit]')];
    const timeline = gsap.timeline({ paused: true, delay });
    const tracks = strips.map((strip) => ({
      strip,
      digit: Number(strip.dataset.digit),
      height: strip.firstElementChild!.getBoundingClientRect().height,
    }));
    const context = gsap.context(() => {
      for (const { strip, digit, height } of tracks) {
        if (presented.current) gsap.set(strip, { y: -digit * height });
        else
          timeline.fromTo(
            strip,
            { y: 0 },
            { y: -digit * height, duration: 1.5, ease: 'power2.out' },
            0,
          );
      }
    }, node);
    const reveal = () => {
      presented.current = true;
      timeline.play();
    };
    const observer =
      !presented.current && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                reveal();
                observer?.disconnect();
              }
            },
            { threshold: 0.15 },
          )
        : null;
    if (observer) observer.observe(node.closest('.community-body') ?? node);
    else reveal();
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (
              !tracks.some(
                (track) =>
                  track.strip.firstElementChild!.getBoundingClientRect().height !== track.height,
              )
            )
              return;
            if (presented.current) timeline.progress(1).pause();
            else timeline.clear();
            context.add(() => {
              tracks.forEach((track) => {
                track.height = track.strip.firstElementChild!.getBoundingClientRect().height;
                if (presented.current) gsap.set(track.strip, { y: -track.digit * track.height });
                else
                  timeline.fromTo(
                    track.strip,
                    { y: 0 },
                    { y: -track.digit * track.height, duration: 1.5, ease: 'power2.out' },
                    0,
                  );
              });
            });
          });
    resize?.observe(node);
    return () => {
      observer?.disconnect();
      resize?.disconnect();
      timeline.kill();
      context.revert();
    };
  }, [value, delay]);
  return (
    <span ref={root} className="odometer" role="img" aria-label={label} title={label}>
      <span aria-hidden="true" className="odometer-drum">
        {[...value].map((character, index) =>
          /\d/.test(character) ? (
            <span className="odometer-window" key={index}>
              <span
                className="odometer-strip"
                data-digit={character}
                style={{ transform: `translateY(-${String(Number(character) * 1.16)}em)` }}
              >
                {Array.from({ length: 10 }, (_, digit) => (
                  <span key={digit}>{digit}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={index}>{character}</span>
          ),
        )}
      </span>
    </span>
  );
}
