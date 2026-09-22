import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { lineStateOf } from '../../modules/connection/index';
import { useConnectionState, useView, views } from '../../store/hooks';
import { goToNextDay, ringOpeningBell, skipToClosingBell } from '../commands';
import { clock, secondsFor } from '../format';
import { GhostButton, PrimaryButton } from '../ui';
import { DAYS } from '../words';

/**
 * The clock buttons at the bottom of the ticket panel: ring the opening
 * bell early, skip to the closing bell, go to the next day. Each one sends a
 * command and waits for the answer before it can be pressed again; the
 * screen changes when the next frame says so, never before.
 *
 * Two guards, because one button takes the place of the last: a press only
 * goes out on a live line (a command pressed on a dead line would wait
 * unsent), and the second click of a double-click is ignored, so a
 * double-click on "ring the bell" cannot also skip the whole day.
 */

function useSend(): [boolean, (event: MouseEvent, send: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const live = lineStateOf(useConnectionState().phase) === 'live';
  const run = (event: MouseEvent, send: () => Promise<unknown>): void => {
    if (event.detail > 1 || !live) return;
    setBusy(true);
    void send().finally(() => {
      setBusy(false);
    });
  };
  return [busy || !live, run];
}

export function OpeningBellButton({ frame, compact = false }: { frame: Frame; compact?: boolean }) {
  const [busy, run] = useSend();
  return (
    <GhostButton
      className={compact ? 'h-10 text-[13px]' : 'h-11'}
      disabled={busy}
      onClick={(event) => {
        run(event, () => ringOpeningBell(frame.clock.day));
      }}
    >
      Ring the opening bell now
    </GhostButton>
  );
}

export function SkipToBellButton({ frame, compact = false }: { frame: Frame; compact?: boolean }) {
  const [busy, run] = useSend();
  return (
    <GhostButton
      tone={compact ? 'line' : 'sun'}
      className={compact ? 'h-10 text-[13px]' : 'h-14 short:h-12'}
      disabled={busy}
      onClick={(event) => {
        run(event, () => skipToClosingBell(frame.clock.day));
      }}
    >
      Skip to the bell
    </GhostButton>
  );
}

export function NextDayButton({ frame }: { frame: Frame }) {
  const [busy, run] = useSend();
  const clockValue = useView(views.clock) ?? frame.clock;
  const last = frame.clock.day >= DAYS;
  return (
    <>
      <PrimaryButton
        className="h-[60px] short:h-[52px]"
        disabled={busy}
        onClick={(event) => {
          run(event, () => goToNextDay(frame.clock.day));
        }}
      >
        {last ? 'See your final score' : `Start day ${String(frame.clock.day + 1)}`}
      </PrimaryButton>
      <div className="text-center text-[13px] text-muted">
        {last ? 'Final score in ' : 'Next day starts in '}
        {clock(secondsFor(clockValue.stepsLeft, clockValue.pace))}
      </div>
    </>
  );
}
