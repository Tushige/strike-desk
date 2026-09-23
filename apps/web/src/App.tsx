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

/**
 * One page, three screens, chosen by the phase the server says the game is
 * in: the front door in the lobby, the desk while a day is on, the final
 * screen after the last bell. The landing is available before connection;
 * the original composition remains available at ?landing=original.
 */
export default function App() {
  const route = useView(views.routing);
  const phase = route?.phase ?? null;

  if ((route === null || phase === 'lobby') && new URLSearchParams(window.location.search).get('landing') !== 'original') {
    return <>
      <RecoveryNotice />
      <StartScreenV2 connected={route !== null} />
    </>;
  }

  return (
    <div className={`app-shell flex min-h-dvh flex-col ${phase !== null && phase !== 'lobby' && phase !== 'final' ? 'app-shell-desk' : ''}`}>
      <TopBar />
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
        <div className="flex gap-4"><GameHelp /><GameHelp engineering /></div>
        <span className="text-[11px] tabular-nums">build {VERSION.commit} · {VERSION.buildTime}</span>
      </footer>
    </div>
  );
}
