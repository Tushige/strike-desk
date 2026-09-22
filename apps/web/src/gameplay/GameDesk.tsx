import { memo, useCallback, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { CompanyView } from '@strike-desk/shared/protocol';
import { formatCents } from '@strike-desk/shared/money';
import { OPEN_STEPS, PACES } from '@strike-desk/shared/time';
import { PriceChart } from '../modules/price-chart/index';
import type { ChartLine, ChartMarker } from '../modules/price-chart/index';
import { buyFlow, chartStore } from '../boot';
import { CompanyChip, CompanyStrip, PhaseScreen, TopBar, controlWords, stripWords } from '../modules/desk/index';
import { REJECT_WORDS } from '../modules/order-ticket/index';
import { ComparisonDesk } from '../comparison/ComparisonDesk';
import type { ComparisonStore } from '../comparison/comparisonStore';
import { NewsPanel } from '../news/NewsPanel';
import type { NewsStore } from '../news/newsStore';
import type { GameStore } from '../store/gameStore';
import type { GameLoop } from './gameLoop';

interface GameDeskProps {
  loop: GameLoop;
  game: GameStore;
  comparison: ComparisonStore;
  news: NewsStore;
}

function GameTopBar({ loop }: { loop: GameLoop }) {
  const bar = useSyncExternalStore(loop.topBar.subscribe, loop.topBar.get);
  return bar === null ? null : <TopBar {...bar} />;
}

function playAgain(): void { window.location.reload(); }

const FINAL_BUY_WORDS = {
  accepted: (day: number) => `Your Day ${String(day)} buy was accepted. That ticket has settled at the closing bell.`,
  rejected: (day: number) => `Your Day ${String(day)} buy was rejected.`,
  noReason: 'The game said no to that one. Check your ticket and press again.',
  gameGone: 'The previous game is no longer available. That buy cannot be checked.',
  lost: 'No answer came back for that one. Check your cash and your ticket, then press again if you still want it.',
  paid: 'Paid at the bell',
  profit: 'Profit or loss',
};

function FinalBuyOutcome() {
  const transaction = useSyncExternalStore(buyFlow.transaction.subscribe, buyFlow.transaction.get);
  const retryHintId = useId();
  if (transaction === null || (transaction.outcome !== undefined && !transaction.afterBell && !transaction.gameGone)) return null;
  const { outcome, command, purchase } = transaction;
  if (command.t !== 'buy') return null;
  let status: string = controlWords.checking;
  if (outcome?.outcome === 'accepted') status = FINAL_BUY_WORDS.accepted(command.day);
  else if (outcome?.outcome === 'rejected') {
    status = `${FINAL_BUY_WORDS.rejected(command.day)} ${outcome.receipt.reason === undefined ? FINAL_BUY_WORDS.noReason : REJECT_WORDS[outcome.receipt.reason]}`;
  } else if (outcome?.outcome === 'lost') status = transaction.gameGone ? FINAL_BUY_WORDS.gameGone : FINAL_BUY_WORDS.lost;
  const position = outcome?.outcome === 'accepted' ? purchase?.position : undefined;
  return <div className="grid shrink-0 gap-2 rounded-md border border-border bg-card p-3 text-sm">
    <p role="status" aria-live="polite" className="m-0">{status}</p>
    {position?.status === 'settled' && position.exit?.kind === 'bell' ? <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2">
      <div><dt className="text-xs text-muted-foreground">{FINAL_BUY_WORDS.paid}</dt>
        <dd className="m-0 tabular-nums">{formatCents(position.exit.proceedsCents)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">{FINAL_BUY_WORDS.profit}</dt>
        <dd className="m-0 tabular-nums">{position.profitCents > 0 ? '+' : ''}{formatCents(position.profitCents)}</dd></div>
    </dl> : null}
    {transaction.retryAllowed ? <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => { buyFlow.retry(); }} aria-describedby={retryHintId}
        className="rounded-md border border-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {controlWords.retry}
      </button>
      <p id={retryHintId} className="m-0 text-xs text-muted-foreground">{controlWords.retryHint}</p>
    </div> : null}
  </div>;
}

const NO_LINES: readonly ChartLine[] = [];
const NO_MARKERS: readonly ChartMarker[] = [];

export function GameChart({ loop, companyId = 0 }: { loop: GameLoop; companyId?: number }) {
  const view = useSyncExternalStore(chartStore.subscribe, chartStore.get);
  const controls = useSyncExternalStore(loop.controls.subscribe, loop.controls.get);
  const company = view.companies[companyId];
  return company === undefined ? null : <PriceChart
    key={`${view.session}:${String(view.day)}:${String(companyId)}`}
    source={chartStore.source(companyId)} xMin={company.xMin} xMax={OPEN_STEPS}
    yMinCents={company.yMinCents} yMaxCents={company.yMaxCents}
    lines={NO_LINES} markers={NO_MARKERS} stale={!controls.ready} label={company.name}
  />;
}

const CompanyPriceChip = memo(function CompanyPriceChip({ game, companyId, company, hasNews, selected, onSelect }: {
  game: GameStore; companyId: number; company: CompanyView; hasNews: boolean;
  selected: boolean; onSelect: (companyId: number) => void;
}) {
  const priceSlice = useMemo(() => ({
    get: () => game.price(companyId).get(),
    subscribe: (listener: () => void) => game.price(companyId).subscribe(listener),
  }), [game, companyId]);
  const price = useSyncExternalStore(priceSlice.subscribe, priceSlice.get);
  const series = chartStore.source(companyId).series();
  const opening = series.values[-series.startIndex];
  const select = useCallback(() => onSelect(companyId), [onSelect, companyId]);
  const trend = price === null || opening === undefined || price === opening ? 'flat' : price > opening ? 'up' : 'down';
  return <CompanyChip companyId={companyId} ticker={company.ticker} name={company.name}
    priceCents={price} trend={trend} hasNews={hasNews} selected={selected} onSelect={select} />;
});

const GameCompanies = memo(function GameCompanies({ game, news, companyId, onSelect }: {
  game: GameStore; news: NewsStore; companyId: number; onSelect: (companyId: number) => void;
}) {
  const read = useCallback(() => game.companies.get(), [game]);
  const subscribe = useCallback((listener: () => void) => game.companies.subscribe(listener), [game]);
  const companies = useSyncExternalStore(subscribe, read);
  const snapshot = useSyncExternalStore(news.subscribe, news.getSnapshot);
  const children = useMemo(() => companies.map((company, id) => <CompanyPriceChip
    key={id} game={game} companyId={id} company={company} selected={id === companyId}
    hasNews={snapshot.news.some((item) => item.companyId === id)} onSelect={onSelect}
  />), [companies, game, snapshot.news, companyId, onSelect]);
  return <div className="relative shrink-0 overflow-x-auto overscroll-contain">
    <div className="min-w-[36rem]"><CompanyStrip label={stripWords.label}>{children}</CompanyStrip></div>
  </div>;
});

function DayDesk({ loop, game, comparison, news }: GameDeskProps) {
  const [companyId, setCompanyId] = useState(0);
  const [companyFocus, setCompanyFocus] = useState<{ companyId: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const comparisonId = useId();
  const selectCompany = useCallback((id: number) => {
    setCompanyId(id);
    setCompanyFocus({ companyId: id });
  }, []);
  return <div className="h-full min-h-0 overflow-auto overscroll-contain">
    <div className="flex h-full min-h-[32rem] min-w-0 flex-col gap-2">
      <GameCompanies game={game} news={news} companyId={companyId} onSelect={selectCompany} />
      <div className="grid h-40 shrink-0 grid-cols-[minmax(16rem,1fr)_minmax(30rem,2fr)] gap-3 overflow-x-auto overscroll-contain">
        <GameChart loop={loop} companyId={companyId} />
        <div className="min-h-0 overflow-auto"><NewsPanel store={news} companyId={companyId} onCompanySelect={selectCompany} /></div>
      </div>
      <button type="button" aria-expanded={expanded} aria-controls={comparisonId} onClick={() => { setExpanded(!expanded); }}
        className="shrink-0 self-start rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Compare options
      </button>
      <div className="min-h-0 flex-1">
        <ComparisonDesk comparison={comparison} game={game} companyFocus={companyFocus} onContractCompany={setCompanyId}
          viewedCompanyId={companyId} comparisonExpanded={expanded} comparisonId={comparisonId} buy={buyFlow} />
      </div>
    </div>
  </div>;
}

export function GameDesk({ loop, game, comparison, news }: GameDeskProps) {
  const screen = useSyncExternalStore(loop.screen.subscribe, loop.screen.get);
  const controls = useSyncExternalStore(loop.controls.subscribe, loop.controls.get);
  const availability = useSyncExternalStore(buyFlow.availability.subscribe, buyFlow.availability.get);
  const purchase = useSyncExternalStore(buyFlow.purchase.subscribe, buyFlow.purchase.get);
  const stress = availability.session === screen?.session && availability.stress;
  const bought = purchase !== null && purchase.session === screen?.session && purchase.position.day === screen.day;
  const instruction = stress ? REJECT_WORDS.stressMode : bought ? controlWords.bought : undefined;
  const instructionProps = instruction === undefined ? {} : { instruction };
  const canAct = controls.ready && !controls.checking;
  const content = useMemo(() => (
    <DayDesk key={`${screen?.session ?? ''}:${String(screen?.day ?? 0)}`} loop={loop} game={game} comparison={comparison} news={news} />
  ), [comparison, game, news, loop, screen?.session, screen?.day]);
  let phase;
  if (screen === null) phase = <p>{controlWords.checking}</p>;
  else switch (screen.phase) {
    case 'lobby': phase = <PhaseScreen phase="lobby" {...instructionProps} paces={PACES} canStart={canAct} onStart={loop.start} />; break;
    case 'preBell': phase = <PhaseScreen phase="preBell" {...instructionProps} day={screen.day} canAct={canAct} onOpenBell={loop.openBell}>{content}</PhaseScreen>; break;
    case 'open': phase = <PhaseScreen phase="open" {...instructionProps} day={screen.day} canAct={canAct} onSkipToBell={loop.skipToBell}>{content}</PhaseScreen>; break;
    case 'debrief': phase = <PhaseScreen phase="debrief" day={screen.day} result={screen.days.find((day) => day.day === screen.day) ?? null} canAct={canAct} onNextDay={loop.nextDay}>{content}</PhaseScreen>; break;
    case 'final': phase = screen.final === null ? <p>{controlWords.checking}</p> : <PhaseScreen phase="final" finalCents={screen.final.finalCents} changeCents={screen.final.changeCents} marketCode={screen.final.marketCode} days={screen.days} onPlayAgain={playAgain} />; break;
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <GameTopBar loop={loop} />
      <div className="min-h-0 flex-1">{phase}</div>
      {screen?.phase === 'final' ? <FinalBuyOutcome /> : null}
      <p className="m-0 text-xs text-muted-foreground">{stress ? REJECT_WORDS.stressMode : controlWords.preview}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {controls.checking ? controlWords.checking : controls.reason === null ? null : REJECT_WORDS[controls.reason]}
        </div>
        {controls.retryAllowed ? <>
          <span className="text-xs text-muted-foreground">{controlWords.retryHint}</span>
          <button type="button" onClick={loop.retry} className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {controlWords.retry}
          </button>
        </> : null}
      </div>
    </div>
  );
}
