import { useMemo, useSyncExternalStore } from 'react';
import { OPEN_STEPS, PACES } from '@strike-desk/shared/time';
import { PriceChart } from '../modules/price-chart/index';
import type { ChartLine, ChartMarker } from '../modules/price-chart/index';
import { chartStore } from '../boot';
import { PhaseScreen, TopBar, controlWords } from '../modules/desk/index';
import { REJECT_WORDS } from '../modules/order-ticket/index';
import { ComparisonDesk } from '../comparison/ComparisonDesk';
import type { ComparisonStore } from '../comparison/comparisonStore';
import { Strip } from '../board/Strip';
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

export function GameDesk({ loop, game, comparison, news }: GameDeskProps) {
  const screen = useSyncExternalStore(loop.screen.subscribe, loop.screen.get);
  const controls = useSyncExternalStore(loop.controls.subscribe, loop.controls.get);
  const canAct = controls.ready && !controls.checking;
  const content = useMemo(() => (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Strip />
      <div className="h-40 shrink-0"><GameChart loop={loop} /></div>
      <NewsPanel store={news} />
      <div className="min-h-0 flex-1"><ComparisonDesk comparison={comparison} game={game} /></div>
    </div>
  ), [comparison, game, news, loop]);
  let phase;
  if (screen === null) phase = <p>{controlWords.checking}</p>;
  else switch (screen.phase) {
    case 'lobby': phase = <PhaseScreen phase="lobby" paces={PACES} canStart={canAct} onStart={loop.start} />; break;
    case 'preBell': phase = <PhaseScreen phase="preBell" day={screen.day} canAct={canAct} onOpenBell={loop.openBell}>{content}</PhaseScreen>; break;
    case 'open': phase = <PhaseScreen phase="open" day={screen.day} canAct={canAct} onSkipToBell={loop.skipToBell}>{content}</PhaseScreen>; break;
    case 'debrief': phase = <PhaseScreen phase="debrief" day={screen.day} result={screen.days.find((day) => day.day === screen.day) ?? null} canAct={canAct} onNextDay={loop.nextDay}>{content}</PhaseScreen>; break;
    case 'final': phase = screen.final === null ? <p>{controlWords.checking}</p> : <PhaseScreen phase="final" finalCents={screen.final.finalCents} changeCents={screen.final.changeCents} marketCode={screen.final.marketCode} days={screen.days} onPlayAgain={playAgain} />; break;
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <GameTopBar loop={loop} />
      <p className="m-0 text-xs text-muted-foreground">{controlWords.preview}</p>
      <div className="min-h-0 flex-1">{phase}</div>
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
