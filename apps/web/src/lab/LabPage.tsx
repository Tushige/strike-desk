import { Suspense, lazy, useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { LabEntry } from './types';

/**
 * The lab: a list of the game's building blocks on the left, the selected
 * one on the right. It talks to nothing — no socket, no store, no game — and
 * links nowhere but its own address fragments.
 */

/**
 * The selection is the address fragment, so a block can be linked to and a
 * reload lands back on it. Subscribing is a module-scope function, so its
 * identity never changes and React never tears the subscription down and
 * builds it again on a re-render.
 */
function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

function hashNow(): string {
  return window.location.hash;
}

/** There is no address off the browser; the first block is then the selected one. */
function hashOffTheBrowser(): string {
  return '';
}

/**
 * One lazy component per block, made once and kept. Making one inside a
 * render would hand React a new component type every time and remount the
 * demo underneath the owner as they looked at it.
 */
const demos = new Map<string, ComponentType>();

function demoOf(id: string, load: NonNullable<LabEntry['demo']>): ComponentType {
  const made = demos.get(id);
  if (made !== undefined) return made;
  const next = lazy(load);
  demos.set(id, next);
  return next;
}

function Demo({ id, load }: { id: string; load: NonNullable<LabEntry['demo']> }): ReactElement {
  const Shown = demoOf(id, load);
  return <Shown />;
}

function SelectedBlock({ entry }: { entry: LabEntry }): ReactElement {
  const load = entry.demo;

  return (
    <>
      <h2 className="lab-block-title">{entry.title}</h2>
      <p className="lab-block-summary">{entry.summary}</p>
      <dl className="lab-port">
        <dt className="lab-port-term">Built against</dt>
        <dd className="lab-port-value">{entry.builtAgainst}</dd>
      </dl>
      {load === undefined ? (
        <p className="lab-state">not built yet</p>
      ) : (
        <Suspense fallback={<p className="lab-state">Loading…</p>}>
          <Demo id={entry.id} load={load} />
        </Suspense>
      )}
    </>
  );
}

export function LabPage({ entries }: { entries: readonly LabEntry[] }): ReactElement {
  const hash = useSyncExternalStore(subscribeToHash, hashNow, hashOffTheBrowser);
  // An empty or unknown fragment selects the first block, so the page is
  // never blank and a stale link never strands the reader.
  const wanted = hash.startsWith('#') ? hash.slice(1) : '';
  const selected = entries.find((entry) => entry.id === wanted) ?? entries[0];

  return (
    <>
      <a className="lab-skip" href="#lab-main">
        Skip to the selected block
      </a>
      <header className="lab-header">
        <h1 className="lab-title">Module lab</h1>
        <p className="lab-lede">
          The building blocks of Strike Desk, each shown by itself against a stand-in data source. Nothing on this page
          talks to the game server.
        </p>
      </header>
      <nav className="lab-nav" aria-label="Building blocks">
        <ol className="lab-list">
          {entries.map((entry) => (
            <li className="lab-item" key={entry.id}>
              <a
                className="lab-link"
                href={`#${entry.id}`}
                aria-current={entry.id === selected?.id ? 'true' : undefined}
              >
                <span className="lab-link-title">{entry.title}</span>
                {entry.demo === undefined ? <span className="lab-state">not built yet</span> : null}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <main className="lab-main" id="lab-main" tabIndex={-1}>
        {selected === undefined ? (
          <p className="lab-state">No blocks are registered.</p>
        ) : (
          <SelectedBlock entry={selected} />
        )}
      </main>
    </>
  );
}
