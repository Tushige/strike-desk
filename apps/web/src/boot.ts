import { WS_PATH } from '@strike-desk/shared/paths';
import { boardFromSearch } from './boardSize';
import { createWsFeed } from './feed/wsFeed';
import { createGameStore } from './store/gameStore';
import { autoStart } from './autoStart';
import { createNewsStore } from './news/newsStore';
import { createComparisonStore } from './comparison/comparisonStore';

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

const feed = createWsFeed({
  url: socketUrl(),
  storage: window.sessionStorage,
  // The stress board size, if the address asks for one. Nothing on screen
  // says so, and the service decides whether to grant it.
  board: boardFromSearch(window.location.search),
});

export const comparisonStore = createComparisonStore((message) => feed.send(message));

feed.subscribe((event) => {
  if (event.type === 'message') {
    store.ingest(event.message);
    newsStore.ingest(event.message);
    comparisonStore.ingest(event.message);
  }
  else {
    store.setStatus(event.status);
    comparisonStore.setStatus(event.status);
  }
});

// Saying hello leaves the clock stopped, so the page starts the game
// itself. The pace is this one number: 1 makes day 1 stand still for a
// minute before the opening bell, 7.5 finishes the whole game in two.
autoStart(feed, { pace: 3, makeId: () => crypto.randomUUID() });

feed.connect();
