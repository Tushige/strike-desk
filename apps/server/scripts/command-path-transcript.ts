import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contractId,
  createSession,
  frameFor,
  sessionStep,
  CONTENT_VERSION,
  ENGINE_VERSION,
  FIRST_PLAYER_ID,
  PROTOCOL_VERSION,
  STEP_MS,
} from '@strike-desk/shared/engine';
import type { Command, Frame, Receipt, RejectReason, Session } from '@strike-desk/shared/engine';
import { handle } from '../src/modules/command-path/index';

/**
 * Writes down what the command path answers, one line per command, for the
 * lab page to show.
 *
 * It plays a short scripted game on a fixed market. Every line is one call of
 * `handle`, the same function the server calls for a command, and holds what
 * was sent, the receipt that came back, whether it was a repeat, and from the
 * reply's frame only the player's cash, revision and tickets. It starts no
 * server and opens no socket.
 *
 * Run it from anywhere in the repository:
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/command-path-transcript.ts
 *
 * It writes apps/web/src/lab/modules/command-path.transcript.json, one entry
 * per line. Nothing but the game goes into the file (no time, no path, no
 * machine detail), and nothing of the market but the prices the commands
 * themselves name, so two runs give the same bytes. Retake it after the rules
 * or the prices change.
 *
 * The market is a fixed one that no live game uses: live games draw theirs
 * from the operating system's random source.
 */

const SEED = 4242424242;
const SESSION_ID = 'command-path-transcript';
const T0 = 1_000_000;
const SPEND = 10_000_000;
const OUTPUT = fileURLToPath(new URL('../../web/src/lab/modules/command-path.transcript.json', import.meta.url));

/** A ticket as the transcript keeps it: what the player holds, and what it paid when it is closed. */
export interface TranscriptTicket {
  id: string;
  quantity: number;
  costCents: number;
  exit?: { kind: 'cashOut' | 'bell'; proceedsCents: number };
}

/** One command through the path, and what the player's account looked like in the reply. */
export interface TranscriptEntry {
  label: string;
  step: number;
  command: Command;
  receipt: Receipt;
  repeat: boolean;
  cashCents: number;
  rev: number;
  tickets: TranscriptTicket[];
}

export interface Transcript {
  recordedWith: { protocol: number; engine: string };
  entries: TranscriptEntry[];
}

/** What the script expects of an answer: accepted, or refused with this reason. */
type Expected = 'accepted' | RejectReason;

/** The scripted game, played through `handle`. Throws when an answer is not the one the script is about. */
export function buildTranscript(): Transcript {
  let session: Session = createSession(SESSION_ID, { seed: SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  // The server's clock reading. The script moves it forward by whole steps;
  // which step of the game that is, is the session's business: a skipped wait
  // moves the game's step without moving this clock.
  let nowMs = T0;
  const entries: TranscriptEntry[] = [];

  /** Let this many steps of wall-clock time go by. */
  function wait(steps: number): void {
    nowMs += steps * STEP_MS;
  }

  /** What the player's page is showing right now. A look changes nothing: the session is not carried on. */
  function look(): Frame {
    return frameFor(session, FIRST_PLAYER_ID, nowMs, { history: false, sections: 'full' }).frame;
  }

  /** Close UP of company 0 on a frame's board, with the price that frame shows for it. */
  function closeUp(label: string, frame: Frame): { id: number; priceCents: number } {
    const board = frame.board;
    const targetIndex = board?.companies[0]?.simpleUp[0];
    if (board === null || targetIndex === undefined) throw new Error(`${label}: the frame has no board`);
    const id = contractId(board.targetsPerCompany, { companyId: 0, targetIndex, side: 'up' });
    const priceCents = frame.quotes[id];
    if (priceCents === undefined || priceCents <= 0) throw new Error(`${label}: ticket ${id} has no price`);
    return { id, priceCents };
  }

  /** One command through the path, written down with the step it arrived at. */
  function send(label: string, command: Command, expected: Expected, repeat = false): TranscriptEntry {
    const step = sessionStep(session, nowMs);
    const handled = handle({ session, playerId: FIRST_PLAYER_ID, command, nowMs, draft: null });
    session = handled.session;

    const { receipt, frame } = handled.reply;
    const found = receipt.outcome === 'accepted' ? 'accepted' : (receipt.reason ?? 'no reason');
    if (found !== expected) throw new Error(`${label}: expected ${expected}, found ${found}`);
    if (handled.repeat !== repeat) throw new Error(`${label}: expected repeat to be ${String(repeat)}`);

    const entry: TranscriptEntry = {
      label,
      step,
      command,
      receipt,
      repeat: handled.repeat,
      cashCents: frame.account.cashCents,
      rev: frame.rev,
      tickets: frame.positions.map((position) => ({
        id: position.id,
        quantity: position.quantity,
        costCents: position.costCents,
        ...(position.exit === undefined ? {} : { exit: { kind: position.exit.kind, proceedsCents: position.exit.proceedsCents } }),
      })),
    };
    entries.push(entry);
    return entry;
  }

  send('start the game', { t: 'start', commandId: 'transcript-start-01', pace: 1 }, 'accepted');

  // Day 1, before the bell: one ticket, the same press again three seconds
  // later, and a second ticket the same day.
  wait(10);
  const first = closeUp('a buy before the bell', look());
  const firstBuy: Command = { t: 'buy', commandId: 'transcript-buy-d1-01', day: 1, contractId: first.id, spendCents: SPEND, seenPriceCents: first.priceCents };
  send('a buy before the bell', firstBuy, 'accepted');
  wait(15);
  send('the same buy, sent again', firstBuy, 'accepted', true);
  wait(15);
  const second = closeUp('a second buy the same day', look());
  send(
    'a second buy the same day',
    { t: 'buy', commandId: 'transcript-buy-d1-02', day: 1, contractId: second.id, spendCents: SPEND, seenPriceCents: second.priceCents },
    'alreadyBought',
  );

  return { recordedWith: { protocol: PROTOCOL_VERSION, engine: ENGINE_VERSION }, entries };
}

/** The file's text: the head, then one entry per line, so a later transcript can be reviewed line by line. */
export function transcriptText(transcript: Transcript): string {
  const head = JSON.stringify({ recordedWith: transcript.recordedWith, entries: [] });
  const lines = transcript.entries.map((entry) => JSON.stringify(entry));
  return `${head.slice(0, -2)}\n${lines.join(',\n')}\n]}\n`;
}

const startedAs = process.argv[1];
if (startedAs !== undefined && path.resolve(startedAs) === fileURLToPath(import.meta.url)) {
  const transcript = buildTranscript();
  writeFileSync(OUTPUT, transcriptText(transcript));
  for (const entry of transcript.entries) {
    const answer = entry.receipt.outcome === 'accepted' ? 'accepted' : `rejected ${entry.receipt.reason ?? ''}`;
    process.stdout.write(`step ${entry.step} ${entry.label}: ${answer}${entry.repeat ? ' (repeat)' : ''}\n`);
  }
  process.stdout.write(`wrote ${transcript.entries.length} entries\n`);
}
