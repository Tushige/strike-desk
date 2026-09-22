import { WS_PATH } from '@strike-desk/shared/paths';
import { boardFromSearch } from './boardSize';
import { createStressMeasurements } from './board/stressMeasurements';
import { createConnection, resendWhileFresh } from './modules/connection/index';
import { createGameStore } from './store/gameStore';

/**
 * Run once per page load, at module scope rather than inside an effect, so
 * React's development double-run cannot open a second socket or make a
 * second game. Three things live here: the store the screens read, the
 * connection that fills it, and the stress readout's measurements.
 *
 * The socket address comes from the page's own address, so the same build
 * works on localhost and on the public host. The session id is kept in
 * `sessionStorage`, which is per tab: a second tab is a second game, and a
 * reload resumes the one it had.
 */

const SESSION_KEY = 'strike-desk.session';

/**
 * After a reconnect, a buy or cash-out pressed this recently goes out again
 * by itself, with the same command id, so the player is not asked to press
 * twice for a line that dropped for a second. The server answers a repeated
 * id with the first receipt, so the resend can never buy or pay twice. An
 * older press waits for the player ("Retry safely").
 */
const RESEND_WITHIN_MS = 20_000;

function socketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${WS_PATH}`;
}

const now = (): number => performance.now();
const schedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** The stress board size, if the address asks for one. Nothing on screen says so; the service decides whether to grant it. */
export const requestedBoard = boardFromSearch(window.location.search);

/** `?dev` on the address shows the developer controls (drop the line). Never on for a player. */
export const devControls = new URLSearchParams(window.location.search).has('dev');

export const store = createGameStore();
export const stressMeasurements = createStressMeasurements({ now, schedule });

export const connection = createConnection({
  seam: {
    url: socketUrl(),
    createSocket: (url) => new WebSocket(url),
    storage: window.sessionStorage,
    schedule,
    random: Math.random,
    now,
  },
  // A stress game is kept under its own key, so a normal tab and a stress tab
  // never resume each other's game.
  sessionKey: requestedBoard === null ? SESSION_KEY : `${SESSION_KEY}.b${String(requestedBoard)}`,
  ...(requestedBoard === null ? {} : { board: requestedBoard }),
  resendOnResume: resendWhileFresh({ maxAgeMs: RESEND_WITHIN_MS, now }),
});

connection.subscribe((event) => {
  if (event.type === 'message') {
    const result = store.ingest(event.message);
    stressMeasurements.observe(event.message, result, event.receivedAt);
  } else {
    store.setStatus(event.status);
  }
});

/** Every command carries an id made here, so a resend is the same command and never a second one. */
export const newCommandId = (): string => crypto.randomUUID();

connection.connect();
