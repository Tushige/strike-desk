import { VERSION } from './generated/version';
import { Desk } from './screens/desk/Desk';
import { FinalScreen } from './screens/FinalScreen';
import { StartScreen } from './screens/StartScreen';
import { TopBar } from './screens/TopBar';
import { startWords } from './screens/words';
import { useFrame } from './store/hooks';

/**
 * One page, three screens, chosen by the phase the server says the game is
 * in: the front door in the lobby, the desk while a day is on, the final
 * screen after the last bell. Before the first frame there is only the bar
 * and a word.
 */
export default function App() {
  const frame = useFrame();
  const phase = frame?.clock.phase ?? null;

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:min-h-[620px]">
      <TopBar />
      {frame === null || phase === 'lobby' ? (
        <StartScreen connected={frame !== null} />
      ) : phase === 'final' ? (
        <FinalScreen frame={frame} />
      ) : (
        <Desk frame={frame} />
      )}
      {frame === null && (
        <p className="m-0 px-5 pb-4 text-center text-sm text-muted sm:px-12 lg:px-24" role="status">
          {startWords.connecting}
        </p>
      )}
      <p className="fixed right-3 bottom-1.5 m-0 text-[11px] text-muted/70 tabular-nums">
        build {VERSION.commit} · {VERSION.buildTime}
      </p>
    </div>
  );
}
