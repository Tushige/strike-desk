import { useEffect, useRef, useState } from 'react';
import { restoredIntent, store } from '../../boot';
import { trackEvent } from '../../analytics/umami';
import type { Frame, Side } from '@strike-desk/shared/protocol';
import { lineStateOf } from '../../modules/connection/index';
import {
  useConnectionState,
  usePendingCommands,
  usePrice,
  useSeries,
  useScreenFrame,
  useView,
  views,
} from '../../store/hooks';
import { clock, percentChange, price, secondsFor } from '../format';
import { TicketPanel } from '../ticket/TicketPanel';
import { Bulb, CompanyTile, cx, GhostButton, Label } from '../ui';
import { LazyComparison } from './LazyComparison';
import { MarketCompany } from './MarketCompany';
import { MarketBell } from './MarketBell';
import { NewsWire } from './NewsWire';
import { NewsUpdate } from './NewsUpdate';
import { CompanyList } from './CompanyList';
import { companyOf, contractFor, contractIdFor, NO_PICK, pickFromTable } from './pick';
import type { Pick } from './pick';
import { PriceChart } from './PriceChart';
import type { TargetLines } from './PriceChart';
import { headlineFor, tipFor, twistShowing } from './tips';
import { useEntrance } from '../motion/useEntrance';

/**
 * The desk separates company navigation from news. Desktop shows the market
 * and ticket together; mobile switches task views without unmounting the draft.
 *
 * The selected company is the one whose chart shows and whose tickets the
 * builder offers. It starts on the day's first headline and follows the
 * player's taps; a new day starts it over.
 */

const PHASE_LABEL = {
  preBell: 'Market opens in',
  open: 'Closing bell in',
  debrief: 'Next day in',
  lobby: '',
  final: '',
} as const;

/** What the tip box says while the numbers cannot be trusted. */
const LINE_TIPS = {
  stale:
    'No new prices for a moment. These numbers may be old, so buying and cashing out wait until fresh ones arrive.',
  offline: 'The connection dropped. Reconnecting… your ticket and your cash are safe on the desk.',
} as const;

/**
 * The lines the chart draws: the ticket the player holds today when it is on
 * this company, otherwise the ticket being built. The break-even of a draft
 * is the server's own number for that contract, sent with every frame.
 */
function targetFor(
  frame: Frame,
  companyId: number,
  draftContractId: number | null,
  positionId: string | null,
): TargetLines | null {
  const ticket = frame.positions.find((position) => position.id === positionId);
  if (ticket !== undefined) {
    if (ticket.companyId !== companyId) return null;
    return {
      side: ticket.side,
      targetCents: ticket.targetCents,
      breakEvenCents: ticket.breakEvenCents,
    };
  }
  if (draftContractId === null || companyOf(frame, draftContractId) !== companyId) return null;
  const draft = contractFor(frame, draftContractId);
  const breakEvenCents = frame.quoteBreakEvens[draftContractId];
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
    <div className="company-heading flex min-w-0 flex-1 items-center gap-3">
      <CompanyTile companyId={companyId} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-[14px] text-muted">
          {company?.name} ({company?.ticker}) makes {company?.product ?? 'things'}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 whitespace-nowrap">
          <span className="company-price w-[8ch] max-w-full shrink-0 font-display text-2xl leading-tight font-extrabold tabular-nums sm:text-[28px]">
            {now === null ? '—' : price(now)}
          </span>
          <span
            className={cx(
              'company-change w-[14ch] shrink-0 text-[15px] font-bold tabular-nums',
              picking ? 'text-muted' : down ? 'text-coral' : 'text-mint',
            )}
          >
            {picking ? 'opens here' : change === null ? '' : `${change} today`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Desk() {
  const desk = useRef<HTMLElement>(null);
  useEntrance(desk, '.desk-sidebar, .market-region, .ticket-region', 'desk');
  const frame = useScreenFrame('desk');
  const [mobileView, setMobileView] = useState<'market' | 'news' | 'ticket'>('market');
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.innerWidth >= 1024) return;
    if (window.scrollY !== 0) window.scrollTo({ top: 0, behavior: 'instant' });
    navigation.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }, [mobileView]);
  const day = frame.clock.day;
  const headlines = frame.news.filter((item) => item.day === day);
  const picking = frame.clock.phase === 'preBell';
  const positions = frame.positions.filter((position) => position.day === day);
  const [positionChoice, setPositionChoice] = useState(() => ({
    day,
    count: positions.length,
    id:
      restoredIntent?.session === frame.session &&
      restoredIntent.day === day &&
      restoredIntent.command.t === 'cashOut'
        ? restoredIntent.command.positionId
        : (positions.at(-1)?.id ?? null),
  }));
  const selectedPositionId =
    positionChoice.day === day && positionChoice.count === positions.length
      ? positionChoice.id
      : (positions.at(-1)?.id ?? null);
  const ticket = positions.find((position) => position.id === selectedPositionId) ?? null;
  // The selection starts over on a new day, and again at the closing bell,
  // where the ticket's company is the one to look at.
  const selectionKey = `${String(day)}:${frame.clock.phase === 'debrief' ? 'bell' : 'day'}`;
  const [choice, setChoice] = useState<{
    key: string;
    companyId: number;
  } | null>(null);
  const byDefault =
    (frame.clock.phase === 'debrief' ? ticket?.companyId : undefined) ??
    (restoredIntent?.session === frame.session &&
    restoredIntent.day === day &&
    restoredIntent.command.t === 'buy'
      ? companyOf(frame, restoredIntent.command.contractId)
      : null) ??
    headlines[0]?.companyId ??
    0;
  const selected = choice !== null && choice.key === selectionKey ? choice.companyId : byDefault;
  const viewCompany = ticket?.companyId ?? selected;

  // The ticket being built: a side and a simple choice that follow the
  // player from company to company, or an exact row from the table. While
  // a buy or a cash-out is unanswered the pick is frozen, so what is on
  // screen is always the order that was pressed.
  const restoredBuy =
    restoredIntent?.session === frame.session &&
    restoredIntent.day === day &&
    restoredIntent.command.t === 'buy'
      ? restoredIntent.command
      : null;
  const [pickState, setPickState] = useState<{ day: number; pick: Pick }>(() => ({
    day,
    pick: restoredBuy === null ? NO_PICK : pickFromTable(frame, restoredBuy.contractId),
  }));
  const pick = pickState.day === day ? pickState.pick : NO_PICK;
  const orderInFlight = usePendingCommands().some(
    (pending) => pending.command.t === 'buy' || pending.command.t === 'cashOut',
  );
  const setPick = (next: Pick): void => {
    if (orderInFlight) return;
    setPickState({ day, pick: next });
  };
  const selectPosition = (id: string | null): void => {
    if (orderInFlight) return;
    setPositionChoice({ day, count: positions.length, id });
  };
  const select = (companyId: number): void => {
    if (orderInFlight) return;
    selectPosition(null);
    setChoice({ key: selectionKey, companyId });
    // An exact row from the table belongs to one company; on another, only the side and the choice carry over.
    if (pick.contractId !== null && companyOf(frame, pick.contractId) !== companyId)
      setPick({ ...pick, contractId: null });
  };
  const chooseSide = (side: Side): void => {
    setPick({ side, choice: pick.choice ?? 'close', contractId: null });
  };
  const chooseChoice = (simple: Pick['choice']): void => {
    setPick({ side: pick.side ?? 'up', choice: simple, contractId: null });
  };
  const pickContract = (contractId: number): void => {
    if (orderInFlight) return;
    selectPosition(null);
    const company = companyOf(frame, contractId);
    if (company !== null) setChoice({ key: selectionKey, companyId: company });
    setPick(pickFromTable(frame, contractId));
  };
  const draftContractId = contractIdFor(frame, selected, pick);
  const contract = contractFor(frame, draftContractId);

  // Comparison expands into the news rail and keeps a compact chart; the
  // ticket on the right stays put and a picked row lands on it.
  const [comparing, setComparing] = useState(frame.stress);
  const [opened, setOpened] = useState(frame.stress);
  const line = lineStateOf(useConnectionState().phase);
  const canCompare = frame.board !== null && frame.clock.phase !== 'debrief';
  const showBoard = comparing && canCompare;

  return (
    <main
      ref={desk}
      data-mobile-view={mobileView}
      className={cx(
        'desk-layout mx-auto flex w-full max-w-[1920px] flex-col gap-4 p-4 lg:min-h-0 lg:grow lg:flex-row',
        showBoard && 'desk-comparing',
      )}
    >
      <nav ref={navigation} className="mobile-sections" aria-label="Desk sections">
        {(['market', 'news', 'ticket'] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={mobileView === view}
            aria-controls={`desk-${view}`}
            onClick={() => {
              setMobileView(view);
            }}
          >
            {view === 'market'
              ? 'Market'
              : view === 'news'
                ? 'News'
                : `Tickets · ${String(positions.length)}/3`}
          </button>
        ))}
      </nav>
      <aside className={cx('desk-sidebar', line !== 'live' && 'opacity-60')}>
        <section className="market-lineup" aria-label="Companies">
          <div className="lineup-heading">
            <h2>Companies</h2>
            <span>Choose a chart</span>
          </div>
          <CompanyList>
            {frame.companies.map((company, companyId) => (
              <MarketCompany
                key={companyId}
                companyId={companyId}
                name={company.name}
                ticker={company.ticker}
                selected={viewCompany === companyId}
                mine={positions.some((position) => position.companyId === companyId)}
                picking={picking}
                disabled={orderInFlight}
                onSelect={() => {
                  select(companyId);
                }}
              />
            ))}
          </CompanyList>
        </section>
        <NewsWire
          frame={frame}
          selected={viewCompany}
          disabled={orderInFlight}
          onSelect={(companyId) => {
            select(companyId);
            setMobileView('market');
            setComparing(false);
          }}
        />
      </aside>

      <section
        id="desk-market"
        className={cx(
          'market-region flex min-w-0 flex-col gap-4 border border-line bg-panel transition-opacity lg:grow',
          line !== 'live' && 'opacity-60',
        )}
      >
        <div className="market-panel-heading">
          <CompanyHeader frame={frame} companyId={viewCompany} />
          <DeskClock />
        </div>

        {showBoard && (
          <div className="comparison-context flex flex-wrap items-center gap-3 text-sm text-muted">
            <p className="m-0 min-w-0 flex-1 text-xs">
              {headlineFor(frame, viewCompany)?.title ?? 'No news for this company today.'}
            </p>
            <GhostButton
              tone="line"
              className="h-9 shrink-0 px-3 text-xs"
              onClick={() => {
                setComparing(false);
              }}
            >
              Close comparison
            </GhostButton>
            <button
              type="button"
              className="ml-auto underline lg:hidden"
              onClick={() => {
                setMobileView('ticket');
              }}
            >
              Your ticket
            </button>
          </div>
        )}
        <ChartRegion
          companyId={viewCompany}
          contractId={draftContractId}
          positionId={selectedPositionId}
          compact={showBoard}
        />
        {opened && (
          <div className={cx('comparison-region min-h-0 flex-1', !showBoard && 'hidden')}>
            <LazyComparison
              companyId={selected}
              selectedContractId={draftContractId}
              onPick={pickContract}
              onChooseCompany={select}
              companyLocked={orderInFlight}
              stale={line !== 'live'}
            />
          </div>
        )}

        {!showBoard && (
          <div className="market-tip rounded-2xl bg-raised p-4">
            <Bulb className="size-[26px] shrink-0 text-sun" />
            <p className="m-0 grow text-[15px] leading-[1.45]">
              {headlineFor(frame, viewCompany)?.updateBody ? (
                <NewsUpdate news={headlineFor(frame, viewCompany)!} />
              ) : showBoard ? (
                'Every ticket on the board, repricing live. Click a column header to sort; pick a row to put it on your ticket.'
              ) : line === 'live' ? (
                tipFor(store.frame.get() ?? frame, viewCompany, null)
              ) : (
                LINE_TIPS[line]
              )}
            </p>
            {canCompare && (
              <GhostButton
                tone={showBoard ? 'line' : 'sun'}
                className="market-compare-action min-h-11 px-4"
                aria-pressed={showBoard}
                onClick={() => {
                  if (!showBoard)
                    trackEvent('comparison_opened', { day, pace: frame.clock.pace ?? 1 });
                  setOpened(true);
                  setComparing(!showBoard);
                }}
              >
                {showBoard ? 'Close comparison' : 'Compare contracts'}
              </GhostButton>
            )}
          </div>
        )}
        <button
          type="button"
          className="mobile-ticket-link"
          onClick={() => {
            setMobileView('ticket');
          }}
        >
          {frame.clock.phase === 'debrief'
            ? 'Review today'
            : `Your tickets · ${String(positions.length)}/3 purchases`}{' '}
          <span aria-hidden="true">→</span>
        </button>
      </section>

      <link
        rel="preload"
        as="image"
        href={new URL('../../assets/mascot/robopup-poses.png', import.meta.url).href}
      />
      <section
        id="desk-ticket"
        className="ticket-region flex min-w-0 flex-col border border-line bg-panel lg:w-[340px] lg:shrink-0"
        aria-label="Your ticket"
      >
        <TicketPanel
          companyId={selected}
          contract={contract}
          pick={pick}
          onPick={pickContract}
          onChooseSide={chooseSide}
          onChooseChoice={chooseChoice}
          selectedPositionId={selectedPositionId}
          onSelectPosition={selectPosition}
        />
      </section>
    </main>
  );
}

function DeskClock() {
  const value = useView(views.clock);
  if (value === null) return null;
  const seconds = secondsFor(value.stepsLeft, value.pace);
  return (
    <div className="desk-clock" role="timer">
      <Label className="desk-clock-label">
        <MarketBell phase={value.phase} />
        {PHASE_LABEL[value.phase]}
      </Label>
      <span
        className={cx(
          'w-[5ch] text-right font-display text-lg font-bold tabular-nums',
          seconds < 15 && 'text-coral',
        )}
      >
        {clock(seconds)}
      </span>
    </div>
  );
}
function ChartRegion({
  companyId,
  contractId,
  compact,
  positionId,
}: {
  companyId: number;
  contractId: number | null;
  compact: boolean;
  positionId: string | null;
}) {
  const frame = useScreenFrame('chart');
  const news = headlineFor(frame, companyId);
  return (
    <>
      <PriceChart
        key={companyId}
        frame={frame}
        companyId={companyId}
        compact={compact}
        target={targetFor(frame, companyId, contractId, positionId)}
        ticket={frame.positions.find((position) => position.id === positionId) ?? null}
        twist={twistShowing(frame, companyId)}
      />
      {compact && news?.updateBody && <NewsUpdate news={news} />}
    </>
  );
}
