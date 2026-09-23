import { useEffect, useRef } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { signedMoney } from './format';
import { DAYS } from './words';

function DayTicket({ day, current, change }: { day: number; current: boolean; change: number | undefined }) {
  const stamp = useRef<HTMLSpanElement>(null);
  const previous = useRef(change);
  useEffect(() => {
    const completed = previous.current === undefined && change !== undefined;
    previous.current = change;
    if (!completed || document.visibilityState === 'hidden' || !stamp.current?.animate) return;
    const motion = stamp.current.animate([
      { transform: 'scale(1.55) rotate(-12deg)', opacity: .3 },
      { transform: 'scale(1) rotate(0)', opacity: 1 },
    ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
    return () => { motion.cancel(); };
  }, [change]);

  const state = change !== undefined ? 'done' : current ? 'current' : 'future';
  const outcome = change === undefined ? '' : change > 0 ? 'profit' : change < 0 ? 'loss' : 'flat';
  const description = change === undefined ? current ? 'today' : 'upcoming'
    : change === 0 ? 'no change' : `${outcome}, ${signedMoney(change)}`;
  const label = `Day ${String(day)}, ${description}`;
  return <li className="day-ticket" data-state={state} data-outcome={outcome}
    aria-current={state === 'current' ? 'step' : undefined} aria-label={label} title={label}>
    <span className="day-ticket-label" aria-hidden="true">DAY</span>
    <span className="day-ticket-number" aria-hidden="true">{day}</span>
    <span ref={stamp} className="day-ticket-result" aria-hidden="true">
      {change === undefined ? current ? '·' : '' : change > 0 ? '+' : change < 0 ? '−' : '0'}
    </span>
  </li>;
}

/** Result stamps come only from settled server days; live quotes never replay them. */
export function DayTickets({ frame }: { frame: Frame | null }) {
  const playing = frame !== null && frame.clock.phase !== 'lobby' && frame.clock.phase !== 'final';
  return <ol className="day-tickets" aria-label="Five trading days">
    {Array.from({ length: DAYS }, (_, index) => {
      const day = index + 1;
      return <DayTicket key={`${frame?.session ?? 'connecting'}:${String(day)}`} day={day}
        current={playing && frame.clock.day === day}
        change={frame?.days.find(result => result.day === day)?.changeCents} />;
    })}
  </ol>;
}
