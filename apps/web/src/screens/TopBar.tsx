import type { Frame } from '@strike-desk/shared/protocol';
import { GAME_STEPS } from '@strike-desk/shared/time';
import { connection, devControls } from '../boot';
import { lineStateOf } from '../modules/connection/index';
import { useConnectionState, useFrame } from '../store/hooks';
import { clock, money, secondsFor } from './format';
import { cx, GhostButton, Label, LogoMark } from './ui';
import { DAYS, LINE_WORDS, topBarWords } from './words';

/**
 * The bar across the top: logo, one pip per day, the time left, and the
 * money. Total worth is the big number, because it only moves when the
 * market moves: buying a ticket turns cash into a ticket worth the same,
 * not into a loss.
 */

function DayPips({ frame }: { frame: Frame | null }) {
  const playing = frame !== null && frame.clock.phase !== 'lobby' && frame.clock.phase !== 'final';
  return (
    <div className="flex gap-2" aria-hidden="true">
      {Array.from({ length: DAYS }, (_, i) => {
        const day = i + 1;
        const done = frame?.days.find((result) => result.day === day);
        const current = playing && frame.clock.day === day;
        return (
          <span
            key={day}
            className={cx(
              'h-3 w-10 rounded-full border-2',
              done !== undefined && done.changeCents > 0 && 'border-mint bg-mint',
              done !== undefined && done.changeCents < 0 && 'border-coral bg-coral',
              done !== undefined && done.changeCents === 0 && 'border-muted bg-muted',
              done === undefined && (current ? 'border-sun' : 'border-line'),
            )}
          />
        );
      })}
    </div>
  );
}

function dayLabel(frame: Frame | null): string {
  if (frame === null || frame.clock.phase === 'lobby') return topBarWords.lobbyDays;
  if (frame.clock.phase === 'final') return topBarWords.allDone;
  return topBarWords.dayOf(frame.clock.day);
}

function timeLeft(frame: Frame | null): string {
  if (frame === null || frame.clock.phase === 'final') return clock(frame === null ? secondsFor(GAME_STEPS, 1) : 0);
  return clock(secondsFor(GAME_STEPS - frame.step, frame.clock.pace));
}

export function TopBar() {
  const frame = useFrame();
  const line = lineStateOf(useConnectionState().phase);
  const account = frame?.account ?? null;

  return (
    <header className="flex h-[76px] shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4 sm:px-7">
      <div className="flex items-center gap-3 lg:w-[360px]">
        <LogoMark />
        <span className="hidden font-display text-lg font-extrabold tracking-wide sm:block">STRIKE DESK</span>
        {line !== 'live' && (
          <span
            role="status"
            className={cx(
              'ml-2 hidden items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold md:flex',
              line === 'stale' ? 'border-sun/60 text-sun' : 'border-coral/60 text-coral',
            )}
          >
            <span className={cx('size-2 rounded-full', line === 'stale' ? 'bg-sun' : 'bg-coral')} aria-hidden="true" />
            {LINE_WORDS[line]}
          </span>
        )}
        {devControls && line === 'live' && (
          <GhostButton className="ml-2 h-8 px-3 text-xs" onClick={() => { connection.simulateDrop(); }} title="Developer control: cut the connection to see the page reconnect">
            Drop the line
          </GhostButton>
        )}
      </div>

      <div className="hidden items-center gap-3.5 md:flex">
        <span className="text-sm text-muted">{dayLabel(frame)}</span>
        <DayPips frame={frame} />
      </div>

      <div className="flex items-center justify-end gap-5 sm:gap-8 lg:w-[460px]">
        <div className="flex flex-col items-end gap-0.5">
          <Label>{topBarWords.timeLeft}</Label>
          <span className="font-display text-lg font-bold tabular-nums">{timeLeft(frame)}</span>
        </div>
        <div className={cx('flex flex-col items-end gap-0.5 transition-opacity', line === 'live' ? 'opacity-100' : 'opacity-60')}>
          <Label>{topBarWords.worth}</Label>
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-xl font-extrabold text-sun tabular-nums sm:text-2xl">
              {account === null ? '—' : money(account.worthCents)}
            </span>
            {account !== null && account.worthCents !== account.cashCents && (
              <span className="hidden text-sm font-semibold text-muted tabular-nums sm:inline">
                {topBarWords.cash} {money(account.cashCents)}
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
