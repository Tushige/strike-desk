import type { Frame } from '@strike-desk/shared/protocol';
import { GAME_STEPS } from '@strike-desk/shared/time';
import { connection, devControls } from '../boot';
import { lineStateOf } from '../modules/connection/index';
import { useConnectionState, useView, views } from '../store/hooks';
import { clock, money, secondsFor } from './format';
import { cx, GhostButton, Label, LogoMark } from './ui';
import { LINE_WORDS, topBarWords } from './words';
import { DayTickets } from './DayTickets';
import { EndGameButton } from './EndGameButton';

/**
 * The bar across the top: logo, the five-day strip, the time left, and the
 * money. Total worth is the big number, because it only moves when the
 * market moves: buying a ticket turns cash into a ticket worth the same,
 * not into a loss.
 */

function dayLabel(frame: Frame | null): string {
  if (frame === null || frame.clock.phase === 'lobby') return topBarWords.lobbyDays;
  if (frame.clock.phase === 'final') return topBarWords.allDone;
  return topBarWords.dayOf(frame.clock.day);
}

function timeLeft(frame: Frame | null): string {
  if (frame === null || frame.clock.phase === 'final') return clock(frame === null ? secondsFor(GAME_STEPS, 1) : 0);
  return clock(secondsFor(GAME_STEPS - frame.step, frame.clock.pace));
}

export function TopBar({ onEnd }: { onEnd?: () => void }) {
  const frame = useView(views.top);
  const line = lineStateOf(useConnectionState().phase);
  const account = frame?.account ?? null;

  return (
    <header className={cx('game-topbar flex h-[76px] shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4 sm:px-7', onEnd !== undefined && 'game-topbar-with-exit')}>
      <div className="topbar-brand flex min-w-0 items-center gap-3">
        <LogoMark />
        <span className="topbar-brand-name brand-wordmark">Strike Desk</span>
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

      <div className="topbar-day-progress">
        <span className="topbar-day-label">{dayLabel(frame)}</span>
        <DayTickets frame={frame} />
      </div>

      <div className="topbar-metrics">
        <div className="flex min-w-0 flex-col items-end gap-0.5">
          <Label>{topBarWords.timeLeft}</Label>
          <span className="w-full whitespace-nowrap text-right font-display text-lg font-bold tabular-nums">{timeLeft(frame)}</span>
        </div>
        <div className={cx('flex min-w-0 flex-col items-end gap-0.5 transition-opacity', line === 'live' ? 'opacity-100' : 'opacity-60')}>
          <Label>{topBarWords.worth}</Label>
          <div className="flex w-full min-w-0 flex-col items-end gap-0.5">
            <span className="topbar-worth w-full whitespace-nowrap text-right font-display text-xl font-extrabold text-sun tabular-nums sm:text-2xl">
              {account === null ? '—' : money(account.worthCents)}
            </span>
            <span className="h-4 whitespace-nowrap text-xs font-semibold text-muted tabular-nums">
              {account !== null && account.cashCents !== account.worthCents ? `${topBarWords.cash} ${money(account.cashCents)}` : ''}
            </span>
          </div>
        </div>
      </div>
      {onEnd !== undefined && <div className="topbar-endgame"><EndGameButton onEnd={onEnd} /></div>}
    </header>
  );
}
