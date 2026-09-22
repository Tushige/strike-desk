import type { Frame } from '@strike-desk/shared/protocol';
import { connection } from '../boot';
import { money, signedMoney } from './format';
import { cx, Label, PrimaryButton } from './ui';
import { DAYS, finalWords, rankFor } from './words';

/**
 * The last screen: the rank the final cash earned, the cash itself, one bar
 * per day, and the market number that would replay this exact market.
 */

const BAR = 84; // px, tallest bar

function DayBars({ frame }: { frame: Frame }) {
  const biggest = Math.max(1, ...frame.days.map((day) => Math.abs(day.changeCents)));
  return (
    <ol className="m-0 grid list-none grid-cols-5 gap-3 p-0">
      {Array.from({ length: DAYS }, (_, i) => {
        const day = i + 1;
        const result = frame.days.find((one) => one.day === day);
        const ticket = frame.positions.find((one) => one.day === day);
        const company = ticket === undefined ? null : (frame.companies[ticket.companyId] ?? null);
        const change = result?.changeCents ?? 0;
        const size = result !== undefined && change !== 0 ? Math.max(4, Math.round((Math.abs(change) / biggest) * BAR)) : 0;
        return (
          <li key={day} className="flex flex-col items-center gap-1.5">
            <span className={cx('text-[13px] font-bold tabular-nums', result === undefined || change === 0 ? 'text-muted' : change > 0 ? 'text-mint' : 'text-coral')}>
              {result === undefined ? '' : ticket === undefined ? '$0' : signedMoney(change)}
            </span>
            <span className="flex w-11 items-end" style={{ height: BAR }}>
              <span className="w-full rounded-t-[10px] bg-mint" style={{ height: change > 0 ? size : 0 }} />
            </span>
            <span className="h-0.5 w-[72px] max-w-full bg-dusk" />
            <span className="flex w-11 items-start" style={{ height: BAR }}>
              <span className="w-full rounded-b-[10px] bg-coral" style={{ height: change < 0 ? size : 0 }} />
            </span>
            <span className="text-sm font-bold">Day {day}</span>
            <span className="text-xs text-muted">
              {result === undefined ? finalWords.notPlayed : ticket === undefined || company === null ? finalWords.satOut : `${company.ticker} ${ticket.side === 'up' ? 'UP' : 'DOWN'}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function playAgain(): void {
  // The final frame made the connection forget its session, so a fresh
  // socket gets a fresh game.
  connection.close();
  connection.connect();
}

export function FinalScreen({ frame }: { frame: Frame }) {
  const final = frame.final;
  const finalCents = final?.finalCents ?? frame.account.cashCents;
  const change = final?.changeCents ?? 0;
  const rank = rankFor(finalCents);

  return (
    <main className="mx-auto flex w-full max-w-[1440px] grow flex-col gap-10 px-5 py-10 sm:px-12 lg:flex-row lg:items-center lg:gap-16 lg:px-24">
      <div className="flex flex-col gap-7 motion-safe:animate-rise lg:w-[600px] lg:shrink-0">
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-[15px] font-semibold text-sun">{finalWords.kicker}</p>
          <h1 className="m-0 font-display text-4xl leading-[1.1] font-extrabold sm:text-[44px]">{rank.title}</h1>
          <p className="m-0 text-lg leading-normal text-muted">{rank.blurb}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{finalWords.finishedWith}</Label>
          <div className="font-display text-4xl leading-[1.1] font-extrabold text-sun tabular-nums sm:text-[58px]">{money(finalCents)}</div>
          <div className={cx('text-lg font-semibold', change >= 0 ? 'text-mint' : 'text-coral')}>
            {change > 0 ? finalWords.more(signedMoney(change)) : change < 0 ? finalWords.less(money(-change)) : finalWords.even}
          </div>
        </div>
        <div>
          <PrimaryButton className="h-16 px-10 text-lg" onClick={playAgain}>
            {finalWords.action}
          </PrimaryButton>
        </div>
        {final !== undefined && (
          <p className="m-0 text-[13px] leading-normal text-muted">
            {finalWords.marketLabel} <span className="font-semibold text-cloud tabular-nums">{final.marketCode}</span>. {finalWords.marketHint}
          </p>
        )}
      </div>

      <div className="flex grow flex-col gap-5">
        <section className="flex flex-col gap-4 rounded-3xl border border-line bg-panel p-6">
          <h2 className="m-0 font-display text-base font-bold">{finalWords.daysHeading}</h2>
          <DayBars frame={frame} />
        </section>
        <section className="flex flex-col gap-3 rounded-3xl border border-line bg-panel p-6">
          <h2 className="m-0 font-display text-base font-bold">{finalWords.lessonsHeading}</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] leading-[1.45]">
            {finalWords.lessons.map((text) => (
              <li key={text} className="flex gap-3">
                <span className="mt-2 size-2 shrink-0 rounded-full bg-sun" />
                {text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
