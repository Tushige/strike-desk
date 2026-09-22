import { useState } from 'react';
import type { Frame, Side } from '@strike-desk/shared/protocol';
import { usePrice, useSeries } from '../../store/hooks';
import { clock, percentChange, price, secondsFor } from '../format';
import { TicketPanel } from '../ticket/TicketPanel';
import { Bulb, CompanyTile, cx, Label } from '../ui';
import { NewsCard, QuietCompany } from './NewsCard';
import { companyOf, contractFor, contractIdFor, NO_PICK, pickFromTable } from './pick';
import type { Pick } from './pick';
import { PriceChart } from './PriceChart';
import type { TargetLines } from './PriceChart';
import { headlineFor, ticketToday, tipFor, twistShowing } from './tips';

/**
 * The desk: today's news down the left, the selected company's chart in the
 * middle, the ticket on the right. One screen, no page scroll on a laptop.
 *
 * The selected company is the one whose chart shows and whose tickets the
 * builder offers. It starts on the day's first headline and follows the
 * player's taps; a new day starts it over.
 */

const PHASE_LABEL = { preBell: 'Market opens in', open: 'Closing bell in', debrief: 'Next day in', lobby: '', final: '' } as const;

/**
 * The lines the chart draws: the ticket the player holds today when it is on
 * this company, otherwise the ticket being built. The break-even of a draft
 * is the server's own number for that contract, sent with every frame.
 */
function targetFor(frame: Frame, companyId: number, draftContractId: number | null): TargetLines | null {
  const ticket = ticketToday(frame);
  if (ticket !== null) {
    if (ticket.companyId !== companyId) return null;
    return { side: ticket.side, targetCents: ticket.targetCents, breakEvenCents: ticket.breakEvenCents };
  }
  const draft = contractFor(frame, draftContractId);
  const breakEvenCents = draftContractId === null ? undefined : frame.quoteBreakEvens[draftContractId];
  if (draft === null || breakEvenCents === undefined) return null;
  return { side: draft.side, targetCents: draft.targetCents, breakEvenCents };
}

function CompanyHeader({ frame, companyId }: { frame: Frame; companyId: number }) {
  const company = frame.companies[companyId];
  const now = usePrice(companyId);
  const opening = useSeries(companyId).today[0] ?? null;
  const picking = frame.clock.phase === 'preBell';
  const change = now !== null && opening !== null ? percentChange(opening, now) : null;
  const down = change !== null && change.startsWith('−');
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <CompanyTile companyId={companyId} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="truncate text-[15px] text-muted">
          {company?.name} ({company?.ticker}) makes {company?.product ?? 'things'}
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl leading-tight font-extrabold tabular-nums sm:text-[30px]">{now === null ? '—' : price(now)}</span>
          <span className={cx('font-bold tabular-nums', picking ? 'text-muted' : down ? 'text-coral' : 'text-mint')}>
            {picking ? 'opens here' : change === null ? '' : `${change} today`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Desk({ frame }: { frame: Frame }) {
  const day = frame.clock.day;
  const headlines = frame.news.filter((item) => item.day === day);
  const [choice, setChoice] = useState<{ day: number; companyId: number } | null>(null);
  const selected = choice !== null && choice.day === day ? choice.companyId : (headlines[0]?.companyId ?? 0);
  const select = (companyId: number): void => {
    setChoice({ day, companyId });
  };

  // The ticket being built: a side and a simple choice that follow the
  // player from company to company, or an exact row from the table.
  const [pickState, setPickState] = useState<{ day: number; pick: Pick }>({ day, pick: NO_PICK });
  const pick = pickState.day === day ? pickState.pick : NO_PICK;
  const setPick = (next: Pick): void => {
    setPickState({ day, pick: next });
  };
  const chooseSide = (side: Side): void => {
    setPick({ side, choice: pick.choice ?? 'close', contractId: null });
  };
  const chooseChoice = (simple: Pick['choice']): void => {
    setPick({ side: pick.side ?? 'up', choice: simple, contractId: null });
  };
  const pickContract = (contractId: number): void => {
    setPick(pickFromTable(frame, contractId));
    const company = companyOf(frame, contractId);
    if (company !== null) select(company);
  };
  const draftContractId = contractIdFor(frame, selected, pick);
  const contract = contractFor(frame, draftContractId);

  const picking = frame.clock.phase === 'preBell';
  const ticket = ticketToday(frame);
  const secondsLeft = secondsFor(frame.clock.stepsLeft, frame.clock.pace);
  const hurry = (frame.clock.phase === 'open' && secondsLeft < 15) || (picking && secondsLeft < 10);
  const twist = twistShowing(frame, selected);
  const opening = useSeries(selected).today[0] ?? null;
  const quiet = frame.companies.map((_, companyId) => companyId).filter((companyId) => headlineFor(frame, companyId) === null);

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 lg:min-h-0 lg:grow lg:flex-row">
      <section className="flex flex-col gap-3 lg:min-h-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto" aria-label="Today's news">
        <div className="flex h-[26px] items-center justify-between">
          <h2 className="m-0 font-display text-base font-bold">Today's news</h2>
          <span className="text-[13px] text-muted">Tap to view</span>
        </div>
        {headlines.map((news) => {
          const company = frame.companies[news.companyId];
          return (
            <NewsCard
              key={news.id}
              news={news}
              companyId={news.companyId}
              name={company?.name ?? ''}
              product={company?.product ?? ''}
              selected={selected === news.companyId}
              mine={ticket?.companyId === news.companyId}
              picking={picking}
              onSelect={() => {
                select(news.companyId);
              }}
            />
          );
        })}
        {quiet.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted">No news today, still tradable</span>
            <div className="grid grid-cols-3 gap-2">
              {quiet.map((companyId) => (
                <QuietCompany
                  key={companyId}
                  companyId={companyId}
                  ticker={frame.companies[companyId]?.ticker ?? ''}
                  selected={selected === companyId}
                  mine={ticket?.companyId === companyId}
                  onSelect={() => {
                    select(companyId);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-4 rounded-3xl border border-line bg-panel p-4 sm:p-5 lg:grow">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <CompanyHeader frame={frame} companyId={selected} />
          <div className="flex shrink-0 flex-col items-end gap-0.5 rounded-2xl bg-raised px-4 py-2.5" role="timer">
            <Label>{PHASE_LABEL[frame.clock.phase]}</Label>
            <span className={cx('font-display text-xl font-bold tabular-nums', hurry ? 'text-coral' : 'text-cloud')}>{clock(secondsLeft)}</span>
          </div>
        </div>

        <PriceChart frame={frame} companyId={selected} target={targetFor(frame, selected, draftContractId)} ticket={ticket} twist={twist} />

        <div className="flex min-h-16 items-center gap-3.5 rounded-2xl bg-raised px-[18px] py-3">
          <Bulb className="size-[26px] shrink-0 text-sun" />
          <p className="m-0 text-[15px] leading-[1.45]">{tipFor(frame, selected, opening)}</p>
        </div>
      </section>

      <section className="flex flex-col rounded-3xl border border-line bg-panel p-6 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto" aria-label="Your ticket">
        <TicketPanel
          frame={frame}
          companyId={selected}
          contract={contract}
          pick={pick}
          onPick={pickContract}
          onChooseSide={chooseSide}
          onChooseChoice={chooseChoice}
        />
      </section>
    </main>
  );
}
