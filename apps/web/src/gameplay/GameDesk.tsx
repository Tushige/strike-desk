import { useMemo, useSyncExternalStore } from 'react';
import { PACES } from '@strike-desk/shared/time';
import { PhaseScreen, TopBar, controlWords } from '../modules/desk/index';
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

export function GameDesk({ loop, game, comparison, news }: GameDeskProps) {
  const screen = useSyncExternalStore(loop.screen.subscribe, loop.screen.get);
  const controls = useSyncExternalStore(loop.controls.subscribe, loop.controls.get);
  const canAct = controls.ready && !controls.checking;
  const content = useMemo(() => (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Strip />
      <NewsPanel store={news} />
      <div className="min-h-0 flex-1"><ComparisonDesk comparison={comparison} game={game} /></div>
    </div>
  ), [comparison, game, news]);
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
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">{controls.checking ? controlWords.checking : null}</div>
    </div>
  );
}
