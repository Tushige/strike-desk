import { memo } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import { DAYS } from '@strike-desk/shared/time';
import { timeLeftText } from './format';
import type { LineState, TopBarProps } from './ports';
import { topBarWords } from './words';

/**
 * The bar across the top of the desk. Total worth is the big number, because
 * it only moves when the market moves: buying a ticket turns cash into a
 * ticket and leaves worth where it was. Cash sits smaller beside it. Then the
 * day, the phase, the time the phase has left, and the state of the
 * connection in words, which is always there.
 *
 * Every amount is a number the server sent, only formatted. The time left is
 * what the last frame said: the bar runs no timer of its own. When the line
 * is not live the numbers dim and the bar says they may be old.
 */

const DAY_NUMBERS = Array.from({ length: DAYS }, (_, index) => index + 1);

/** A shape for each state, so the state never rests on colour alone. */
const LINE_LOOK: Record<LineState, { readonly colour: string; readonly filled: boolean; readonly struck: boolean }> = {
  live: { colour: 'text-ring', filled: true, struck: false },
  stale: { colour: 'text-gold', filled: false, struck: false },
  offline: { colour: 'text-muted-foreground', filled: false, struck: true },
};

function segmentColour(segment: number, day: number): string {
  if (segment === day) return 'bg-ring';
  return segment < day ? 'bg-ring/40' : 'bg-muted';
}

const LABEL = 'text-xs text-muted-foreground';
const DIMMED = 'opacity-50';

export const TopBar = memo(function TopBar({ worthCents, cashCents, day, phase, stepsLeft, pace, line }: TopBarProps) {
  const old = line !== 'live';
  const dim = old ? DIMMED : '';
  const lineLook = LINE_LOOK[line];
  const running = phase === 'preBell' || phase === 'open' || phase === 'debrief';
  const timeLeft = running ? timeLeftText(stepsLeft, pace) : '';

  return (
    <header
      data-old={old}
      className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-border bg-card px-5 py-3"
    >
      <dl className={`m-0 flex items-end gap-x-6 transition-opacity motion-reduce:transition-none ${dim}`}>
        <div>
          <dt className={LABEL}>{topBarWords.worthLabel}</dt>
          <dd className="m-0 text-3xl leading-none font-medium tracking-tight tabular-nums">{formatCents(worthCents)}</dd>
        </div>
        <div>
          <dt className={LABEL}>{topBarWords.cashLabel}</dt>
          <dd className="m-0 text-lg leading-none tabular-nums">{formatCents(cashCents)}</dd>
        </div>
      </dl>

      <div className="grid gap-1 border-l border-border pl-8">
        {day >= 1 ? <span className={LABEL}>{topBarWords.dayOf(day, DAYS)}</span> : null}
        <span className="text-base leading-none font-medium">{topBarWords.phase(phase)}</span>
        {day >= 1 ? (
          <span className="flex gap-1" aria-hidden="true">
            {DAY_NUMBERS.map((segment) => (
              <span key={segment} className={`h-1 w-5 rounded-full ${segmentColour(segment, day)}`} />
            ))}
          </span>
        ) : null}
      </div>

      {timeLeft === '' ? null : (
        <dl className={`m-0 transition-opacity motion-reduce:transition-none ${dim}`}>
          <dt className={LABEL}>{topBarWords.timeLabel}</dt>
          <dd className="m-0 text-2xl leading-none font-medium tabular-nums">{timeLeft}</dd>
        </dl>
      )}

      <p role="status" className="m-0 ml-auto flex items-center gap-2 text-sm">
        <svg className={`size-3 shrink-0 ${lineLook.colour}`} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <circle cx="6" cy="6" r="4" fill={lineLook.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
          {lineLook.struck ? <path d="M2 10 10 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : null}
        </svg>
        <span>{topBarWords.line(line)}</span>
        {old ? <span className="text-muted-foreground">{topBarWords.oldNumbers}</span> : null}
      </p>
    </header>
  );
});
