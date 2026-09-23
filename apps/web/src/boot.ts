import { WS_PATH } from '@strike-desk/shared/paths';
import { boardFromSearch } from './boardSize';
import { createStressMeasurements } from './board/stressMeasurements';
import { createConnection, resendWhileFresh } from './modules/connection/index';
import { createGameStore } from './store/gameStore';
import { createJournal, intentEligible } from './modules/connection/journal';
import type { BuyCommand, CashOutCommand } from '@strike-desk/shared/protocol';
import type { CommandOutcome, SessionStore } from './modules/connection/ports';
import type { SavedIntent } from './modules/connection/journal';

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
export const sessionKey = requestedBoard === null ? SESSION_KEY : `${SESSION_KEY}.b${String(requestedBoard)}`;
function safeStorage(): SessionStore | null {
  try { return window.sessionStorage; } catch { return null; }
}
const storage = safeStorage();
const journal = createJournal(storage, `${sessionKey}.journal`);
export const restoredIntent = journal.read();
let recoveryValue: { intent: SavedIntent; outcome: CommandOutcome | null } | null = restoredIntent === null ? null : { intent: restoredIntent, outcome: null };
const recoveryListeners = new Set<() => void>();
export const recovery = {
  get: () => recoveryValue,
  subscribe(listener: () => void) { recoveryListeners.add(listener); return () => { recoveryListeners.delete(listener); }; },
};
function publishRecovery(intent: SavedIntent, outcome: CommandOutcome | null): void {
  recoveryValue = { intent, outcome };
  for (const listener of recoveryListeners) listener();
}

export const connection = createConnection({
  seam: {
    url: socketUrl(),
    createSocket: (url) => new WebSocket(url),
    storage,
    schedule,
    random: Math.random,
    now,
  },
  // A stress game is kept under its own key, so a normal tab and a stress tab
  // never resume each other's game.
  sessionKey,
  ...(requestedBoard === null ? {} : { staleAfterMs: 3_000 }),
  ...(requestedBoard === null ? {} : { board: requestedBoard }),
  resendOnResume: resendWhileFresh({ maxAgeMs: RESEND_WITHIN_MS, now }),
});

const unsubscribe = connection.subscribe((event) => {
  if (event.type === 'message') {
    const result = store.ingest(event.message);
    stressMeasurements.observe(event.message, result, event.receivedAt);
  } else {
    store.setStatus(event.status);
  }
});

/** Every command carries an id made here, so a resend is the same command and never a second one. */
export const newCommandId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
};

function track(intent: SavedIntent, result: Promise<CommandOutcome>): Promise<CommandOutcome> {
  void result.then((outcome) => { if (!disposing) { journal.clear(); publishRecovery(intent, outcome); } });
  return result;
}
/** Persistence records the same intent before the existing transport sends it. */
export function submitTrade(command: BuyCommand | CashOutCommand): Promise<CommandOutcome> {
  if (recoveryValue !== null && recoveryValue.outcome === null) return Promise.resolve({ outcome: 'lost' });
  const frame = store.frame.get();
  if (frame === null) return Promise.resolve({ outcome: 'lost' });
  const intent: SavedIntent = { version: 1, session: frame.session, day: frame.clock.day, submittedAt: Date.now(), command };
  if (!intentEligible(intent, frame)) return Promise.resolve({ outcome: 'lost' });
  journal.write(intent);
  publishRecovery(intent, null);
  return track(intent, connection.submit(command, intent));
}

export const restoredOutcome = restoredIntent === null ? null : track(restoredIntent,
  connection.restore(restoredIntent, Date.now() - restoredIntent.submittedAt));

/** Leave this tab's run behind; a reload must never resume it or retry its trades. */
export function leaveGame(): void {
  connection.close();
  stressMeasurements.setActive(false);
  journal.clear();
  try { storage?.removeItem(sessionKey); } catch { /* optional storage */ }
}

export function playAgain(): void {
  leaveGame();
  window.location.reload();
}

let disposing = false;
if (import.meta.hot) import.meta.hot.dispose(() => {
  disposing = true;
  unsubscribe();
  connection.close();
  stressMeasurements.setActive(false);
});

connection.connect();
