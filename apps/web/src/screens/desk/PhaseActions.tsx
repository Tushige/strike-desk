import { useState } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { goToNextDay, ringOpeningBell, skipToClosingBell } from '../commands';
import { clock, secondsFor } from '../format';
import { GhostButton, PrimaryButton } from '../ui';
import { DAYS } from '../words';

/**
 * The clock buttons at the bottom of the ticket panel: ring the opening
 * bell early, skip to the closing bell, go to the next day. Each one sends a
 * command and waits for the answer before it can be pressed again; the
 * screen changes when the next frame says so, never before.
 */

function useSend(): [boolean, (send: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const run = (send: () => Promise<unknown>): void => {
    setBusy(true);
    void send().finally(() => {
      setBusy(false);
    });
  };
  return [busy, run];
}

export function OpeningBellButton({ frame }: { frame: Frame }) {
  const [busy, run] = useSend();
  return (
    <GhostButton
      className="h-11"
      disabled={busy}
      onClick={() => {
        run(() => ringOpeningBell(frame.clock.day));
      }}
    >
      Ring the opening bell now
    </GhostButton>
  );
}

export function SkipToBellButton({ frame }: { frame: Frame }) {
  const [busy, run] = useSend();
  return (
    <GhostButton
      tone="sun"
      className="h-14"
      disabled={busy}
      onClick={() => {
        run(() => skipToClosingBell(frame.clock.day));
      }}
    >
      Skip to the bell
    </GhostButton>
  );
}

export function NextDayButton({ frame }: { frame: Frame }) {
  const [busy, run] = useSend();
  const last = frame.clock.day >= DAYS;
  return (
    <>
      <PrimaryButton
        className="h-[60px] short:h-[52px]"
        disabled={busy}
        onClick={() => {
          run(() => goToNextDay(frame.clock.day));
        }}
      >
        {last ? 'See your final score' : `Start day ${String(frame.clock.day + 1)}`}
      </PrimaryButton>
      <div className="text-center text-[13px] text-muted">
        {last ? 'Final score in ' : 'Next day starts in '}
        {clock(secondsFor(frame.clock.stepsLeft, frame.clock.pace))}
      </div>
    </>
  );
}
