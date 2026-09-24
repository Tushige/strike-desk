import { useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';

const READING_MS = 8_000;

/** Pauses the remaining reading time offscreen, in hidden tabs, and during interaction. */
export function useLessonRotation(lessons: readonly string[]) {
  const count = lessons.length;
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const slides = useRef<(HTMLElement | null)[]>([]);
  const previous = useRef(0);
  const remaining = useRef(READING_MS);
  const [selection, setSelection] = useState({ index: 0, revision: 0, direction: 1 });
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [resumed, setResumed] = useState({ hover: false, focus: false });
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [hidden, setHidden] = useState(document.hidden);
  const [announcement, setAnnouncement] = useState('');
  const readingPaused = (hover && !resumed.hover) || (focus && !resumed.focus);
  const held = paused || readingPaused || !visible || hidden;

  useEffect(() => {
    const update = () => {
      setHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', update);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              setVisible(entries[0]?.isIntersecting ?? false);
            },
            { threshold: 0.25 },
          );
    if (root.current) observer?.observe(root.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  useEffect(() => {
    remaining.current = READING_MS;
    const old = slides.current[previous.current];
    const incoming = slides.current[selection.index];
    const changed = previous.current !== selection.index;
    previous.current = selection.index;
    if (!changed || !incoming?.animate || document.hidden) return;
    const exit = old?.animate(
      [
        { visibility: 'visible', opacity: 1, transform: 'none' },
        {
          visibility: 'visible',
          opacity: 0,
          transform: `translateX(${String(-selection.direction * 65)}%)`,
        },
      ],
      { duration: 240, easing: 'ease-in' },
    );
    const enter = incoming.animate(
      [
        { opacity: 0, transform: `translateX(${String(selection.direction * 65)}%)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 460, easing: 'cubic-bezier(.16,1,.3,1)' },
    );
    return () => {
      exit?.cancel();
      enter.cancel();
    };
  }, [selection]);

  useEffect(() => {
    const left = remaining.current;
    const progress = track.current?.animate?.(
      [{ transform: `scaleX(${String(1 - left / READING_MS)})` }, { transform: 'scaleX(1)' }],
      { duration: Math.max(1, left), fill: 'both', easing: 'linear' },
    );
    progress?.pause();
    if (held)
      return () => {
        progress?.cancel();
      };
    const started = performance.now();
    progress?.play();
    const timer = window.setTimeout(() => {
      setSelection((current) => ({
        index: (current.index + 1) % count,
        revision: current.revision + 1,
        direction: 1,
      }));
    }, left);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, left - (performance.now() - started));
      progress?.cancel();
    };
  }, [held, selection, count]);

  function choose(index: number, direction: number) {
    setSelection((current) => ({ index, direction, revision: current.revision + 1 }));
    setAnnouncement(`Lesson ${String(index + 1)} of ${String(count)}. ${lessons[index] ?? ''}`);
  }
  function toggleRotation() {
    if (paused) {
      // Explicit Resume wins over the pointer/focus used to activate this button.
      // A fresh hover or focus interaction can pause reading again.
      setResumed({ hover: true, focus: true });
    }
    setPaused((value) => !value);
  }
  const next = (selection.index + 1) % count;
  return {
    root,
    track,
    slides,
    selection,
    paused,
    readingPaused,
    announcement,
    next,
    choose,
    toggleRotation,
    readingEvents: {
      onMouseEnter: () => {
        setHover(true);
        setResumed((current) => ({ ...current, hover: false }));
      },
      onMouseLeave: () => {
        setHover(false);
      },
      onFocusCapture: () => {
        setFocus(true);
        setResumed((current) => ({ ...current, focus: false }));
      },
      onBlurCapture: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false);
      },
    },
  };
}
