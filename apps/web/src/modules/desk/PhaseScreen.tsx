import { memo, useId } from 'react';
import type { ReactNode } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import { DAYS } from '@strike-desk/shared/time';
import { signedCentsText } from './format';
import type { DaySummary, PhaseScreenProps } from './ports';
import { debriefWords, finalWords, lobbyWords, openWords, preBellWords } from './words';

/**
 * The screen for the game's phase. Before the bell, while the market is open
 * and at the debrief it is a frame around the desk the game hands in: a
 * heading row, one content region, and a row with the phase's one button.
 * The lobby and the final screen are a single panel in the middle.
 *
 * One screen, no page scroll: every screen fills the height its parent gives
 * it and takes none from the window. The content region may shrink, and what
 * does not fit inside it is cut off there rather than pushing the page
 * taller, so the button row never leaves the screen.
 *
 * Every amount is a number the server sent. The market number is on the
 * final screen because only the final screen's props hold one.
 */

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const BUTTON =
  'touch-manipulation rounded-md px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none ' +
  `disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;
/** The step the player is expected to take next. */
const MAIN_BUTTON = `${BUTTON} bg-gold text-background hover:bg-gold/85`;
/** A way to move on early: there, but quieter than the desk's own buy button. */
const QUIET_BUTTON = `${BUTTON} border border-border bg-card text-foreground hover:bg-accent`;

const DESK_ROOT = 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3';
const PANEL_ROOT = 'grid h-full min-h-0 place-items-center overflow-hidden';
const PANEL = 'grid max-h-full w-full max-w-2xl gap-4 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-6';
const HEADING = 'm-0 text-xl leading-tight font-medium text-balance';
const BODY = 'm-0 max-w-prose text-sm text-muted-foreground';
const LABEL = 'text-xs text-muted-foreground';

/** The sign is always in the text; the colour only repeats it. */
function changeColour(cents: number): string {
  if (cents > 0) return 'text-up';
  if (cents < 0) return 'text-down';
  return 'text-muted-foreground';
}

function dayWords(changeCents: number): string {
  if (changeCents > 0) return debriefWords.upDay;
  if (changeCents < 0) return debriefWords.downDay;
  return debriefWords.flatDay;
}

function DeskScreen({
  heading,
  body,
  aside,
  action,
  children,
}: {
  heading: string;
  body: string | null;
  aside: ReactNode;
  action: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={DESK_ROOT}>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <div className="grid gap-1">
          <h2 id={headingId} className={HEADING}>
            {heading}
          </h2>
          {body === null ? null : <p className={BODY}>{body}</p>}
        </div>
        {aside}
      </header>
      <div data-region="content" className="min-h-0 overflow-hidden">
        {children}
      </div>
      <footer className="flex justify-end">{action}</footer>
    </section>
  );
}

function DayResult({ result }: { result: DaySummary | null }) {
  if (result === null) return <p className={BODY}>{debriefWords.waiting}</p>;
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
      <p className="m-0 text-base font-medium">{dayWords(result.changeCents)}</p>
      <dl className="m-0 flex items-end gap-x-6">
        <div>
          <dt className={LABEL}>{debriefWords.startLabel}</dt>
          <dd className="m-0 text-base tabular-nums">{formatCents(result.startCents)}</dd>
        </div>
        <div>
          <dt className={LABEL}>{debriefWords.endLabel}</dt>
          <dd className="m-0 text-base tabular-nums">{formatCents(result.endCents)}</dd>
        </div>
        <div>
          <dt className={LABEL}>{debriefWords.changeLabel}</dt>
          <dd className={`m-0 text-xl leading-none font-medium tabular-nums ${changeColour(result.changeCents)}`}>
            {signedCentsText(result.changeCents)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export const PhaseScreen = memo(function PhaseScreen(props: PhaseScreenProps) {
  const headingId = useId();

  switch (props.phase) {
    case 'lobby': {
      const { paces, canStart, onStart } = props;
      return (
        <section aria-labelledby={headingId} className={PANEL_ROOT}>
          <div data-region="content" className={PANEL}>
            <h2 id={headingId} className={HEADING}>
              {lobbyWords.heading}
            </h2>
            <p className={BODY}>{lobbyWords.body(DAYS)}</p>
            <p className={BODY}>{lobbyWords.paceHint}</p>
            <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
              {paces.map((pace) => (
                <button
                  key={pace}
                  type="button"
                  disabled={!canStart}
                  onClick={() => {
                    onStart(pace);
                  }}
                  className={pace === 1 ? MAIN_BUTTON : QUIET_BUTTON}
                >
                  {lobbyWords.start(pace)}
                </button>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case 'preBell':
      return (
        <DeskScreen
          heading={preBellWords.heading(props.day)}
          body={preBellWords.body}
          aside={null}
          action={
            <button type="button" disabled={!props.canAct} onClick={props.onOpenBell} className={QUIET_BUTTON}>
              {preBellWords.action}
            </button>
          }
        >
          {props.children}
        </DeskScreen>
      );

    case 'open':
      return (
        <DeskScreen
          heading={openWords.heading(props.day)}
          body={openWords.body}
          aside={null}
          action={
            <button type="button" disabled={!props.canAct} onClick={props.onSkipToBell} className={QUIET_BUTTON}>
              {openWords.action}
            </button>
          }
        >
          {props.children}
        </DeskScreen>
      );

    case 'debrief':
      return (
        <DeskScreen
          heading={debriefWords.heading(props.day)}
          body={null}
          aside={<DayResult result={props.result} />}
          action={
            <button type="button" disabled={!props.canAct} onClick={props.onNextDay} className={MAIN_BUTTON}>
              {props.day >= DAYS ? debriefWords.lastDay : debriefWords.nextDay(props.day + 1)}
            </button>
          }
        >
          {props.children}
        </DeskScreen>
      );

    case 'final': {
      const { finalCents, changeCents, marketCode, days, onPlayAgain } = props;
      return (
        <section aria-labelledby={headingId} className={PANEL_ROOT}>
          <div data-region="content" className={PANEL}>
            <h2 id={headingId} className={HEADING}>
              {finalWords.heading}
            </h2>
            <dl className="m-0 flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <dt className={LABEL}>{finalWords.finalLabel}</dt>
                <dd className="m-0 text-3xl leading-none font-medium tracking-tight tabular-nums">{formatCents(finalCents)}</dd>
              </div>
              <div>
                <dt className={LABEL}>{finalWords.changeLabel}</dt>
                <dd className={`m-0 text-xl leading-none font-medium tabular-nums ${changeColour(changeCents)}`}>
                  {signedCentsText(changeCents)}
                </dd>
              </div>
            </dl>

            <table className="w-full border-collapse text-sm tabular-nums">
              <caption className={`pb-1 text-left ${LABEL}`}>{finalWords.daysCaption}</caption>
              <thead>
                <tr className={`border-b border-border ${LABEL}`}>
                  <th scope="col" className="py-1 text-left font-normal">
                    {finalWords.dayColumn}
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    {finalWords.startColumn}
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    {finalWords.endColumn}
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    {finalWords.changeColumn}
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map((one) => (
                  <tr key={one.day} className="border-b border-border">
                    <th scope="row" className="py-1 text-left font-normal">
                      {one.day}
                    </th>
                    <td className="py-1 text-right">{formatCents(one.startCents)}</td>
                    <td className="py-1 text-right">{formatCents(one.endCents)}</td>
                    <td className={`py-1 text-right ${changeColour(one.changeCents)}`}>{signedCentsText(one.changeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <dl className="m-0 grid gap-0.5">
                <dt className={LABEL}>{finalWords.marketLabel}</dt>
                <dd className="m-0 font-mono text-base" translate="no">
                  {marketCode}
                </dd>
                <dd className={`m-0 ${LABEL}`}>{finalWords.marketHint}</dd>
              </dl>
              <button type="button" onClick={onPlayAgain} className={MAIN_BUTTON}>
                {finalWords.action}
              </button>
            </div>
          </div>
        </section>
      );
    }
  }
});
