import { VERSION } from './generated/version';
import { Desk } from './screens/desk/Desk';
import { FinalScreen } from './screens/FinalScreen';
import { StartScreen } from './screens/StartScreen';
import { TopBar } from './screens/TopBar';
import { startWords } from './screens/words';
import { useView, views } from './store/hooks';
import { GameHelp } from './screens/GameHelp';
import { RecoveryNotice } from './screens/RecoveryNotice';
import StartScreenV2 from './screens/landing/StartScreenV2';
import { useState } from 'react';
import { connection, leaveGame, store } from './boot';
import { lineStateOf } from './modules/connection';
import { EarlyExitScreen } from './screens/EarlyExitScreen';
import type { EarlyExit } from './screens/EarlyExitScreen';
import { trackEvent } from './analytics/umami';

/**
 * One page, three screens, chosen by the phase the server says the game is
 * in: the front door in the lobby, the desk while a day is on, the final
 * screen after the last bell. The landing is available before connection;
 * the original composition remains available at ?landing=original.
 */
export default function App() {
  const route = useView(views.routing);
  const phase = route?.phase ?? null;
  const [exit, setExit] = useState<EarlyExit | null>(null);
  function endGame() {
    const frame = store.frame.get();
    if (frame === null || frame.clock.phase === 'lobby' || frame.clock.phase === 'final') return;
    const snapshot = { frame, pending: connection.pending.get().length > 0, stale: lineStateOf(connection.state.get().phase) !== 'live' };
    trackEvent('game_ended_early', { day: frame.clock.day, purchases: frame.positions.length, pace: frame.clock.pace ?? 1 });
    leaveGame();
    setExit(snapshot);
  }

  if (exit !== null) return <EarlyExitScreen exit={exit} />;

  if ((route === null || phase === 'lobby') && new URLSearchParams(window.location.search).get('landing') !== 'original') {
    return <>
      <RecoveryNotice />
      <StartScreenV2 connected={route !== null} />
    </>;
  }

  return (
    <div className={`app-shell flex min-h-dvh flex-col ${phase !== null && phase !== 'lobby' && phase !== 'final' ? 'app-shell-desk' : ''}`}>
      <TopBar {...(phase !== null && phase !== 'lobby' && phase !== 'final' ? { onEnd: endGame } : {})} />
      <RecoveryNotice />
      {route === null || phase === 'lobby' ? (
        <StartScreen connected={route !== null} />
      ) : phase === 'final' ? (
        <FinalScreen />
      ) : (
        <Desk key={route.session} />
      )}
      {route === null && (
        <p className="m-0 px-5 pb-4 text-center text-sm text-muted sm:px-12 lg:px-24" role="status">
          {startWords.connecting}
        </p>
      )}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-4"><GameHelp /><GameHelp engineering /></div>
        <span className="text-[11px] tabular-nums">build {VERSION.commit} · {VERSION.buildTime}</span>
      </footer>
    </div>
  );
}
