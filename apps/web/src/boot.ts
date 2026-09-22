import { WS_PATH } from '@strike-desk/shared/paths';
import { boardFromSearch } from './boardSize';
import { createWsFeed } from './feed/wsFeed';
import { createGameStore } from './store/gameStore';
import { createGameLoop } from './gameplay/gameLoop';
import { createChartStore } from './gameplay/chartStore';
import { createNewsStore } from './news/newsStore';
import { createComparisonStore } from './comparison/comparisonStore';
import { createDeskFreshness } from './comparison/freshness';

/**
 * Run once per page load, at module scope rather than inside an effect, so
 * React's development double-run cannot open a second socket or make a
 * second game. The socket address comes from the page's own address, so the
 * same build works on localhost and on the public host.
 *
 * The session id is kept in `sessionStorage`, which is per tab: a second
 * tab is a second game, and a reload resumes the one it had.
 */

function socketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${WS_PATH}`;
}

export const store = createGameStore();
export const newsStore = createNewsStore();
export const chartStore = createChartStore();
export const deskFreshness = createDeskFreshness({
  now: () => performance.now(),
  schedule: (run, ms) => { const timer = setTimeout(run, ms); return () => { clearTimeout(timer); }; },
});

const feed = createWsFeed({
  url: socketUrl(),
  storage: window.sessionStorage,
  // The stress board size, if the address asks for one. Nothing on screen
  // says so, and the service decides whether to grant it.
  board: boardFromSearch(window.location.search),
});

export const comparisonStore = createComparisonStore((message) => feed.send(message));
comparisonStore.requested.subscribe(() => { store.setRequestedDraft(comparisonStore.requested.get()); });

feed.subscribe((event) => {
  if (event.type === 'message') {
    comparisonStore.ingest(event.message);
    const result = store.ingest(event.message);
    newsStore.ingest(event.message);
    chartStore.ingest(event.message);
    deskFreshness.ingest(result, event.receivedAt);
  }
  else {
    store.setStatus(event.status);
    comparisonStore.setStatus(event.status);
    deskFreshness.setStatus(event.status);
  }
});

export const gameLoop = createGameLoop(feed, () => crypto.randomUUID());

feed.connect();
