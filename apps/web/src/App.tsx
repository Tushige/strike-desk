import { GameDesk } from './gameplay/GameDesk';
import { VERSION } from './generated/version';
import { comparisonStore, gameLoop, newsStore, store } from './boot';

/**
 * One screen: six share prices, the day's news and the contract table in a
 * panel filling the rest, with the build stamp small in the corner.
 *
 * The root subscribes to nothing. Each strip card takes its own price from
 * the store and the table takes its moving prices straight from it, so a
 * frame never redraws the page and never enters React state.
 */
export default function App() {
  return (
    <main>
      <GameDesk loop={gameLoop} game={store} comparison={comparisonStore} news={newsStore} />
      {/*
        The one element styled in utilities rather than in the stylesheet:
        small proof, on the live page, that the utility engine runs and that
        its colours are the same tokens everything else reads.

        The two offsets are the ones the layout already implies, not free
        choices: the right edge lines up with the panel above it, and the
        bottom sits inside the strip of ground the page keeps clear below
        the table, so the stamp never touches the panel's edge.
      */}
      <p className="fixed right-4 bottom-1.5 m-0 text-xs tabular-nums text-muted-foreground">
        build {VERSION.commit} · {VERSION.buildTime}
      </p>
    </main>
  );
}
