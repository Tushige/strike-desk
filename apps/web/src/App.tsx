import { ContractBoard } from './board/ContractBoard';
import { Strip } from './board/Strip';
import { VERSION } from './generated/version';

/**
 * One screen: the six share prices in a strip on top, the contract table in
 * a panel filling the rest, the build stamp small in the corner.
 *
 * The root subscribes to nothing. Each strip card takes its own price from
 * the store and the table takes its moving prices straight from it, so a
 * frame never redraws the page and never enters React state.
 */
export default function App() {
  return (
    <main>
      <Strip />
      <div className="board">
        <ContractBoard />
      </div>
      <p className="build-stamp">
        build {VERSION.commit} · {VERSION.buildTime}
      </p>
    </main>
  );
}
