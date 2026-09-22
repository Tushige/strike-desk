import { useState } from 'react';
import type { Pace } from '@strike-desk/shared/time';
import { PACES } from '@strike-desk/shared/time';
import { connection } from '../boot';
import { lineStateOf } from '../modules/connection/index';
import { useConnectionState } from '../store/hooks';
import { startGame } from './commands';
import { ChoiceButton, cx, PrimaryButton } from './ui';
import { PACE_WORDS, startWords } from './words';

/**
 * The front door: the rules in three steps, the game length, and one button.
 * Pressing it sends `start`; the desk appears with the next frame.
 */
export function StartScreen({ connected }: { connected: boolean }) {
  const [pace, setPace] = useState<Pace>(1);
  const [opening, setOpening] = useState(false);
  const state = useConnectionState();
  const { serverFull, gameGone } = state;
  const live = connected && lineStateOf(state.phase) === 'live';

  async function open(): Promise<void> {
    if (gameGone) connection.dismissGameGone();
    setOpening(true);
    const outcome = await startGame(pace);
    // Accepted: the next frame moves the page to the desk. Anything else:
    // let the player press again.
    if (outcome.outcome !== 'accepted') setOpening(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-[1440px] grow flex-col justify-center gap-8 px-5 py-10 short:gap-5 short:py-5 sm:px-12 lg:px-24">
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[15px] font-semibold text-sun">{startWords.kicker}</p>
        <h1 className="m-0 font-display text-4xl leading-[1.08] font-extrabold tracking-tight sm:text-5xl lg:text-[64px] short:lg:text-[52px]">
          {startWords.heading[0]}
          <br />
          {startWords.heading[1]}
        </h1>
        <p className="m-0 max-w-[52rem] text-lg leading-normal text-muted sm:text-xl">{startWords.lede}</p>
      </div>

      <ol className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-3">
        {startWords.steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-2.5 rounded-3xl border border-line bg-panel p-6">
            <span className="font-display text-[22px] font-extrabold text-sun">{i + 1}</span>
            <span className="text-xl font-bold">{step.title}</span>
            <span className="leading-normal text-muted">
              {i === 1 ? (
                <>
                  Think the price will climb? Buy an <strong className="text-mint">UP</strong> ticket. Think it will drop? Buy a{' '}
                  <strong className="text-coral">DOWN</strong> ticket. Then pick a target price.
                </>
              ) : (
                step.body
              )}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <PrimaryButton className="h-16 px-10 text-lg" disabled={!live || opening} onClick={() => void open()}>
          {opening ? startWords.opening : live ? startWords.action : startWords.connecting}
        </PrimaryButton>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted" id="pace-label">
            {startWords.paceLabel}
          </span>
          <div className="flex gap-1 rounded-2xl border border-line bg-panel p-1" role="group" aria-labelledby="pace-label">
            {PACES.map((option) => (
              <ChoiceButton
                key={option}
                selected={option === pace}
                onClick={() => {
                  setPace(option);
                }}
                className={cx('h-11 rounded-xl px-4 text-sm font-semibold', option === pace ? 'bg-sun text-ink' : 'text-cloud')}
              >
                {PACE_WORDS[option]}
              </ChoiceButton>
            ))}
          </div>
        </div>
        {serverFull && <p className="m-0 text-sm font-semibold text-coral" role="status">{startWords.serverFull}</p>}
        {gameGone && <p className="m-0 text-sm text-muted" role="status">{startWords.gameGone}</p>}
      </div>

      <div className="flex flex-col gap-2 text-[13px] leading-normal text-muted">
        <p className="m-0">{startWords.footer}</p>
        <p className="m-0">{startWords.example}</p>
      </div>
    </main>
  );
}
